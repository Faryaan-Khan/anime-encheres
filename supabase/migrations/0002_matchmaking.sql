-- Enchères Animés — quick matches between strangers
--
-- Adds to 0001_init.sql:
--   * find_match   pairs two waiting players, or leaves the caller waiting
--   * leave_queue  stops waiting
--   * resign       gives up a matched game
--   * claim_forfeit ends a matched game whose other player stopped playing
--
-- A waiting player is simply the host of a lobby room flagged `matched`.
-- Matched rooms have no host privileges, cannot be joined by code and cannot
-- be restarted. Run after 0001_init.sql. Idempotent.

alter table encheres.rooms add column if not exists matched boolean not null default false;
alter table encheres.rooms add column if not exists forfeit smallint check (forfeit in (0, 1));
-- Last time the waiting player polled; a room nobody polls is abandoned.
alter table encheres.rooms add column if not exists seen_at timestamptz not null default now();

-- Seconds a player may take for one action in a matched game.
create or replace function encheres.turn_seconds()
returns integer
language sql
immutable
set search_path = ''
as $$ select 60; $$;

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

-- Shuffles, deals and opens round 1. The caller holds the room lock.
create or replace function encheres.begin_game(p_code text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  r encheres.rooms;
  v_deck text[];
  v_drawer smallint;
begin
  select * into r from encheres.rooms where code = p_code;

  -- Shuffle on the server so no client ever knows the order of the deck.
  select array_agg(x order by random()) into v_deck from unnest(r.pool) as x;
  v_deck := v_deck[1 : r.team_size * 4];
  v_drawer := floor(random() * 2)::smallint;

  update encheres.room_players
     set budget = r.budget, team = '{}'
   where room_code = p_code;

  update encheres.rooms
     set status = 'playing',
         phase = 'draw',
         round = 1,
         deck = v_deck,
         drawer = v_drawer,
         turn = v_drawer,
         card = null,
         high_bid = 0,
         high_bidder = null,
         passed = '{false,false}',
         history = '[]'::jsonb,
         forfeit = null,
         version = version + 1,
         updated_at = now()
   where code = p_code;
end;
$$;

-- Same as before, plus `matched`, `forfeit` and `idle` (seconds since the
-- last change, which is how long the player to act has been thinking).
create or replace function encheres.room_view(p_code text, p_seat smallint)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  r encheres.rooms;
  v_players jsonb;
begin
  select * into r from encheres.rooms where code = p_code;
  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'seat', p.seat,
               'name', p.name,
               'budget', p.budget,
               'team', to_jsonb(p.team)
             )
             order by p.seat
           ),
           '[]'::jsonb
         )
    into v_players
    from encheres.room_players p
   where p.room_code = p_code;

  return jsonb_build_object(
    'code', r.code,
    'status', r.status,
    'version', r.version,
    'you', p_seat,
    'settings', jsonb_build_object(
      'budget', r.budget,
      'teamSize', r.team_size,
      'minBid', r.min_bid,
      'increment', r.increment,
      'poolSize', coalesce(array_length(r.pool, 1), 0)
    ),
    'players', v_players,
    'phase', r.phase,
    'round', r.round,
    'drawer', r.drawer,
    'turn', r.turn,
    'highBid', r.high_bid,
    'highBidder', r.high_bidder,
    'passed', to_jsonb(r.passed),
    'deckCount', coalesce(array_length(r.deck, 1), 0),
    'card', case
              when r.phase = 'reveal' then r.card
              when r.phase = 'bidding' and p_seat = r.drawer then r.card
              else null
            end,
    'history', r.history,
    'matched', r.matched,
    'forfeit', r.forfeit,
    'idle', greatest(0, floor(extract(epoch from (now() - r.updated_at)))::integer)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Existing API, adjusted for matched rooms
-- ---------------------------------------------------------------------------

create or replace function public.join_room(p_code text, p_token text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r encheres.rooms;
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_seat smallint;
  v_name text;
begin
  if p_token is null or char_length(p_token) < 16 or char_length(p_token) > 128 then
    raise exception 'INVALID_INPUT';
  end if;

  select * into r from encheres.rooms where code = v_code for update;
  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;

  -- Coming back to a room you already sit in is always allowed.
  v_seat := encheres.seat_of(v_code, p_token);
  if v_seat is not null then
    return encheres.room_view(v_code, v_seat);
  end if;

  -- Matched rooms are filled by find_match only, never by code.
  if r.matched then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  if r.status <> 'lobby' then
    raise exception 'GAME_ALREADY_STARTED';
  end if;
  if (select count(*) from encheres.room_players where room_code = v_code) >= 2 then
    raise exception 'ROOM_FULL';
  end if;

  v_name := encheres.clean_name(p_name);

  insert into encheres.room_players (room_code, seat, token_hash, name, budget)
  values (v_code, 1, encheres.token_hash(p_token), v_name, r.budget);

  update encheres.rooms
     set version = version + 1, updated_at = now()
   where code = v_code;

  return encheres.room_view(v_code, 1::smallint);
end;
$$;

create or replace function public.start_game(p_code text, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r encheres.rooms;
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_seat smallint;
begin
  select * into r from encheres.rooms where code = v_code for update;
  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  v_seat := encheres.seat_of(v_code, p_token);
  if v_seat is null then
    raise exception 'NOT_IN_ROOM';
  end if;
  -- Matched games start on their own and are not replayed.
  if r.matched then
    raise exception 'NOT_ALLOWED';
  end if;
  if v_seat <> 0 then
    raise exception 'HOST_ONLY';
  end if;
  if r.status = 'playing' then
    raise exception 'ALREADY_PLAYING';
  end if;
  if (select count(*) from encheres.room_players where room_code = v_code) < 2 then
    raise exception 'NEED_TWO_PLAYERS';
  end if;

  perform encheres.begin_game(v_code);
  return encheres.room_view(v_code, v_seat);
end;
$$;

-- ---------------------------------------------------------------------------
-- Matchmaking
-- ---------------------------------------------------------------------------

-- Call once to start looking, then again every few seconds with the code of
-- the room it returned, until the returned room is `playing`.
--
-- If another player is waiting, the caller joins them and the game starts.
-- Otherwise the caller waits as the host of a new room. Two players who start
-- waiting at the same moment find each other on their next call: the one in
-- the newer room moves into the older one.
create or replace function public.find_match(
  p_token text,
  p_name text,
  p_budget integer,
  p_team_size integer,
  p_min_bid integer,
  p_increment integer,
  p_pool text[],
  p_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_hash text;
  v_name text := encheres.clean_name(p_name);
  v_mine encheres.rooms;
  v_other text;
  v_code text;
  v_pool_size integer := coalesce(array_length(p_pool, 1), 0);
begin
  if p_token is null or char_length(p_token) < 16 or char_length(p_token) > 128 then
    raise exception 'INVALID_INPUT';
  end if;
  v_hash := encheres.token_hash(p_token);

  -- One pairing at a time, so two callers can never both take the same seat.
  perform pg_advisory_xact_lock(hashtext('encheres.find_match'));

  -- Forget waiting rooms whose player stopped polling.
  delete from encheres.rooms
   where matched and status = 'lobby' and seen_at < now() - interval '2 minutes';

  if p_code is not null then
    select r.* into v_mine
      from encheres.rooms r
      join encheres.room_players p on p.room_code = r.code and p.seat = 0
     where r.code = upper(btrim(p_code)) and r.matched and p.token_hash = v_hash;
    if found and v_mine.status <> 'lobby' then
      -- Someone joined while we were waiting.
      return encheres.room_view(v_mine.code, 0::smallint);
    end if;
  end if;

  if v_mine.code is null then
    -- A fresh search: drop any room this player left waiting earlier.
    delete from encheres.rooms r
     using encheres.room_players p
     where p.room_code = r.code and p.seat = 0 and p.token_hash = v_hash
       and r.matched and r.status = 'lobby';
  else
    update encheres.rooms set seen_at = now() where code = v_mine.code;
  end if;

  -- The longest-waiting other player who is still polling.
  select r.code into v_other
    from encheres.rooms r
    join encheres.room_players p on p.room_code = r.code and p.seat = 0
   where r.matched
     and r.status = 'lobby'
     and r.seen_at > now() - interval '12 seconds'
     and p.token_hash <> v_hash
     and (v_mine.code is null or (r.created_at, r.code) < (v_mine.created_at, v_mine.code))
     and (select count(*) from encheres.room_players q where q.room_code = r.code) = 1
   order by r.created_at, r.code
   limit 1
   for update of r;

  if v_other is not null then
    if v_mine.code is not null then
      delete from encheres.rooms where code = v_mine.code;
    end if;
    insert into encheres.room_players (room_code, seat, token_hash, name, budget)
    select v_other, 1, v_hash, v_name, r.budget from encheres.rooms r where r.code = v_other;
    perform encheres.begin_game(v_other);
    return encheres.room_view(v_other, 1::smallint);
  end if;

  if v_mine.code is not null then
    return encheres.room_view(v_mine.code, 0::smallint);
  end if;

  -- Nobody is waiting: wait as the host of a new room.
  if p_budget is null or p_team_size is null or p_min_bid is null or p_increment is null
     or p_team_size < 1 or p_team_size > 10
     or p_min_bid < 1 or p_increment < 1
     or p_budget < p_min_bid or p_budget > 100000
     or v_pool_size < p_team_size * 2 or v_pool_size > 400
     or exists (select 1 from unnest(p_pool) as x where x is null or char_length(x) not between 1 and 64)
     or (select count(distinct x) from unnest(p_pool) as x) <> v_pool_size
  then
    raise exception 'INVALID_INPUT';
  end if;

  delete from encheres.rooms where updated_at < now() - interval '24 hours';

  loop
    select string_agg(substr(v_alphabet, 1 + floor(random() * 32)::integer, 1), '')
      into v_code
      from generate_series(1, 5);
    exit when not exists (select 1 from encheres.rooms where code = v_code);
  end loop;

  insert into encheres.rooms (code, budget, team_size, min_bid, increment, pool, matched)
  values (v_code, p_budget, p_team_size, p_min_bid, p_increment, p_pool, true);

  insert into encheres.room_players (room_code, seat, token_hash, name, budget)
  values (v_code, 0, v_hash, v_name, p_budget);

  return encheres.room_view(v_code, 0::smallint);
end;
$$;

-- Stops waiting. If an opponent arrived in the meantime, returns the game
-- instead of leaving it; otherwise returns null.
create or replace function public.leave_queue(p_code text, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r encheres.rooms;
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_seat smallint;
begin
  perform pg_advisory_xact_lock(hashtext('encheres.find_match'));
  select * into r from encheres.rooms where code = v_code for update;
  if not found then
    return null;
  end if;
  v_seat := encheres.seat_of(v_code, p_token);
  if v_seat is null or not r.matched then
    raise exception 'NOT_IN_ROOM';
  end if;
  if r.status = 'lobby' then
    delete from encheres.rooms where code = v_code;
    return null;
  end if;
  return encheres.room_view(v_code, v_seat);
end;
$$;

-- Ends a matched game: `p_loser` forfeits and the other player wins.
create or replace function encheres.end_by_forfeit(p_code text, p_loser smallint)
returns void
language sql
set search_path = ''
as $$
  update encheres.rooms
     set status = 'finished',
         phase = 'finished',
         forfeit = p_loser,
         card = null,
         version = version + 1,
         updated_at = now()
   where code = p_code;
$$;

-- The caller gives up a matched game.
create or replace function public.resign(p_code text, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r encheres.rooms;
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_seat smallint;
begin
  select * into r from encheres.rooms where code = v_code for update;
  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  v_seat := encheres.seat_of(v_code, p_token);
  if v_seat is null then
    raise exception 'NOT_IN_ROOM';
  end if;
  if not r.matched then
    raise exception 'NOT_ALLOWED';
  end if;
  if r.status = 'playing' then
    perform encheres.end_by_forfeit(v_code, v_seat);
  end if;
  return encheres.room_view(v_code, v_seat);
end;
$$;

-- The caller wins a matched game because the other player, whose turn it is,
-- has not acted within the time limit.
create or replace function public.claim_forfeit(p_code text, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r encheres.rooms;
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_seat smallint;
  v_actor smallint;
begin
  select * into r from encheres.rooms where code = v_code for update;
  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  v_seat := encheres.seat_of(v_code, p_token);
  if v_seat is null then
    raise exception 'NOT_IN_ROOM';
  end if;
  if not r.matched then
    raise exception 'NOT_ALLOWED';
  end if;
  if r.status <> 'playing' then
    return encheres.room_view(v_code, v_seat);
  end if;

  v_actor := case r.phase when 'draw' then r.drawer when 'bidding' then r.turn else null end;
  if v_actor is null or v_actor = v_seat
     or now() - r.updated_at < make_interval(secs => encheres.turn_seconds())
  then
    raise exception 'TOO_EARLY';
  end if;

  perform encheres.end_by_forfeit(v_code, v_actor);
  return encheres.room_view(v_code, v_seat);
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

revoke all on function encheres.turn_seconds() from public;
revoke all on function encheres.begin_game(text) from public;
revoke all on function encheres.end_by_forfeit(text, smallint) from public;
revoke all on function encheres.room_view(text, smallint) from public;

revoke all on function public.find_match(text, text, integer, integer, integer, integer, text[], text) from public;
revoke all on function public.leave_queue(text, text) from public;
revoke all on function public.resign(text, text) from public;
revoke all on function public.claim_forfeit(text, text) from public;
revoke all on function public.join_room(text, text, text) from public;
revoke all on function public.start_game(text, text) from public;

grant execute on function public.find_match(text, text, integer, integer, integer, integer, text[], text) to anon, authenticated;
grant execute on function public.leave_queue(text, text) to anon, authenticated;
grant execute on function public.resign(text, text) to anon, authenticated;
grant execute on function public.claim_forfeit(text, text) to anon, authenticated;
grant execute on function public.join_room(text, text, text) to anon, authenticated;
grant execute on function public.start_game(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
