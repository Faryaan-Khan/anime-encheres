-- Enchères Animés — online rooms
--
-- Design
--   * All tables live in the `encheres` schema, which the Supabase API does
--     not expose. Clients can never read a table, so they can never read the
--     deck or the hidden card.
--   * The only way in is through the SECURITY DEFINER functions in `public`
--     at the bottom of this file. Each one checks the caller's player token
--     and returns a view of the room with the card removed unless the caller
--     is allowed to see it.
--   * Players are identified by a random token generated on their device.
--     Only its SHA-256 hash is stored.
--
-- The rules implemented here mirror src/game/engine.ts exactly; the test
-- suite replays random games through both and compares them step by step.
--
-- This script is idempotent: it can be run again safely.

create schema if not exists encheres;

create table if not exists encheres.rooms (
  code        text primary key,
  status      text not null default 'lobby'
              check (status in ('lobby', 'playing', 'finished')),
  version     integer not null default 0,
  budget      integer not null,
  team_size   integer not null,
  min_bid     integer not null,
  increment   integer not null,
  pool        text[] not null,
  deck        text[] not null default '{}',
  phase       text not null default 'lobby'
              check (phase in ('lobby', 'draw', 'bidding', 'reveal', 'finished')),
  round       integer not null default 0,
  drawer      smallint not null default 0 check (drawer in (0, 1)),
  turn        smallint not null default 0 check (turn in (0, 1)),
  card        text,
  high_bid    integer not null default 0,
  high_bidder smallint check (high_bidder in (0, 1)),
  passed      boolean[] not null default '{false,false}',
  history     jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists encheres.room_players (
  room_code  text not null references encheres.rooms (code) on delete cascade,
  seat       smallint not null check (seat in (0, 1)),
  token_hash text not null,
  name       text not null,
  budget     integer not null default 0,
  team       text[] not null default '{}',
  primary key (room_code, seat)
);

-- Defence in depth: even if the schema were exposed one day, no policy
-- exists, so the API roles could still read nothing.
alter table encheres.rooms enable row level security;
alter table encheres.room_players enable row level security;

revoke all on schema encheres from public;
revoke all on all tables in schema encheres from public;

-- ---------------------------------------------------------------------------
-- Internal helpers (not reachable through the API)
-- ---------------------------------------------------------------------------

create or replace function encheres.token_hash(p_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
$$;

create or replace function encheres.seat_of(p_code text, p_token text)
returns smallint
language sql
stable
set search_path = ''
as $$
  select seat
  from encheres.room_players
  where room_code = p_code
    and token_hash = encheres.token_hash(p_token);
$$;

create or replace function encheres.clean_name(p_name text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
begin
  if char_length(v_name) < 1 or char_length(v_name) > 20 then
    raise exception 'INVALID_INPUT';
  end if;
  return v_name;
end;
$$;

-- What one seat is allowed to see. The card is included only when the game
-- rules say this seat may know it.
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
    'history', r.history
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Public API
-- ---------------------------------------------------------------------------

create or replace function public.create_room(
  p_token text,
  p_name text,
  p_budget integer,
  p_team_size integer,
  p_min_bid integer,
  p_increment integer,
  p_pool text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  v_name text := encheres.clean_name(p_name);
  v_pool_size integer := coalesce(array_length(p_pool, 1), 0);
begin
  if p_token is null or char_length(p_token) < 16 or char_length(p_token) > 128 then
    raise exception 'INVALID_INPUT';
  end if;
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

  -- Housekeeping: forget rooms nobody has touched for a day.
  delete from encheres.rooms where updated_at < now() - interval '24 hours';

  loop
    select string_agg(substr(v_alphabet, 1 + floor(random() * 32)::integer, 1), '')
      into v_code
      from generate_series(1, 5);
    exit when not exists (select 1 from encheres.rooms where code = v_code);
  end loop;

  insert into encheres.rooms (code, budget, team_size, min_bid, increment, pool)
  values (v_code, p_budget, p_team_size, p_min_bid, p_increment, p_pool);

  insert into encheres.room_players (room_code, seat, token_hash, name, budget)
  values (v_code, 0, encheres.token_hash(p_token), v_name, p_budget);

  return encheres.room_view(v_code, 0::smallint);
end;
$$;

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

create or replace function public.get_room(p_code text, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_seat smallint;
begin
  if not exists (select 1 from encheres.rooms where code = v_code) then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  v_seat := encheres.seat_of(v_code, p_token);
  if v_seat is null then
    raise exception 'NOT_IN_ROOM';
  end if;
  return encheres.room_view(v_code, v_seat);
end;
$$;

-- Starts the first game, or a rematch once a game is finished. Host only.
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
  v_deck text[];
  v_drawer smallint;
begin
  select * into r from encheres.rooms where code = v_code for update;
  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  v_seat := encheres.seat_of(v_code, p_token);
  if v_seat is null then
    raise exception 'NOT_IN_ROOM';
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

  -- Shuffle on the server so no client ever knows the order of the deck.
  select array_agg(x order by random()) into v_deck from unnest(r.pool) as x;
  v_deck := v_deck[1 : r.team_size * 4];
  v_drawer := floor(random() * 2)::smallint;

  update encheres.room_players
     set budget = r.budget, team = '{}'
   where room_code = v_code;

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
         version = version + 1,
         updated_at = now()
   where code = v_code;

  return encheres.room_view(v_code, v_seat);
end;
$$;

-- One player action: 'draw', 'bid' (with p_amount), 'pass' or 'next'.
create or replace function public.play(
  p_code text,
  p_token text,
  p_action text,
  p_amount integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r encheres.rooms;
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_seat smallint;
  v_budget integer[];  -- index = seat + 1
  v_count integer[];   -- team sizes, index = seat + 1
  v_required integer;
  v_winner smallint;
  v_settle boolean := false;
begin
  select * into r from encheres.rooms where code = v_code for update;
  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  v_seat := encheres.seat_of(v_code, p_token);
  if v_seat is null then
    raise exception 'NOT_IN_ROOM';
  end if;
  if r.status <> 'playing' then
    raise exception 'NOT_PLAYING';
  end if;

  select array_agg(p.budget order by p.seat),
         array_agg(coalesce(array_length(p.team, 1), 0) order by p.seat)
    into v_budget, v_count
    from encheres.room_players p
   where p.room_code = v_code;

  if p_action = 'draw' then
    if r.phase <> 'draw' then raise exception 'WRONG_PHASE'; end if;
    if v_seat <> r.drawer then raise exception 'NOT_YOUR_TURN'; end if;
    r.card := r.deck[1];
    r.deck := r.deck[2:];
    r.phase := 'bidding';
    r.turn := r.drawer;
    r.high_bid := 0;
    r.high_bidder := null;
    r.passed := '{false,false}';
    v_settle := true;

  elsif p_action = 'bid' then
    if r.phase <> 'bidding' then raise exception 'WRONG_PHASE'; end if;
    if v_seat <> r.turn then raise exception 'NOT_YOUR_TURN'; end if;
    if v_count[v_seat + 1] >= r.team_size then raise exception 'TEAM_FULL'; end if;
    v_required := case when r.high_bidder is null then r.min_bid else r.high_bid + r.increment end;
    if p_amount is null or p_amount < v_required or p_amount > v_budget[v_seat + 1] then
      raise exception 'INVALID_BID';
    end if;
    r.high_bid := p_amount;
    r.high_bidder := v_seat;
    r.turn := 1 - v_seat;
    v_settle := true;

  elsif p_action = 'pass' then
    if r.phase <> 'bidding' then raise exception 'WRONG_PHASE'; end if;
    if v_seat <> r.turn then raise exception 'NOT_YOUR_TURN'; end if;
    r.passed[v_seat + 1] := true;
    r.turn := 1 - v_seat;
    v_settle := true;

  elsif p_action = 'next' then
    if r.phase <> 'reveal' then raise exception 'WRONG_PHASE'; end if;
    r.card := null;
    r.high_bid := 0;
    r.high_bidder := null;
    r.passed := '{false,false}';
    if coalesce(array_length(r.deck, 1), 0) = 0
       or not ((v_count[1] < r.team_size and v_budget[1] >= r.min_bid)
            or (v_count[2] < r.team_size and v_budget[2] >= r.min_bid))
    then
      r.phase := 'finished';
      r.status := 'finished';
    else
      r.round := r.round + 1;
      r.drawer := 1 - r.drawer;
      r.turn := r.drawer;
      r.phase := 'draw';
    end if;

  else
    raise exception 'UNKNOWN_ACTION';
  end if;

  -- Advance the bidding as far as it goes without player input: skip players
  -- who passed or cannot afford the next bid, then resolve the card once a
  -- single bidder (or nobody) is left.
  if v_settle then
    loop
      if r.high_bidder is not null and r.passed[(1 - r.high_bidder) + 1] then
        v_winner := r.high_bidder;
        update encheres.room_players
           set budget = budget - r.high_bid,
               team = team || r.card
         where room_code = v_code and seat = v_winner;
        r.history := r.history || jsonb_build_object(
          'round', r.round, 'card', r.card, 'winner', v_winner, 'price', r.high_bid);
        r.phase := 'reveal';
        exit;
      end if;

      if r.passed[1] and r.passed[2] then
        r.history := r.history || jsonb_build_object(
          'round', r.round, 'card', r.card, 'winner', null, 'price', 0);
        r.phase := 'reveal';
        exit;
      end if;

      if r.passed[r.turn + 1] then
        r.turn := 1 - r.turn;
        continue;
      end if;

      v_required := case when r.high_bidder is null then r.min_bid else r.high_bid + r.increment end;
      if v_count[r.turn + 1] >= r.team_size or v_budget[r.turn + 1] < v_required then
        r.passed[r.turn + 1] := true;
        r.turn := 1 - r.turn;
        continue;
      end if;

      exit;
    end loop;
  end if;

  update encheres.rooms
     set status = r.status,
         phase = r.phase,
         round = r.round,
         deck = r.deck,
         drawer = r.drawer,
         turn = r.turn,
         card = r.card,
         high_bid = r.high_bid,
         high_bidder = r.high_bidder,
         passed = r.passed,
         history = r.history,
         version = r.version + 1,
         updated_at = now()
   where code = v_code;

  return encheres.room_view(v_code, v_seat);
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissions: the API roles may call the five public functions, nothing else.
-- ---------------------------------------------------------------------------

revoke all on function encheres.token_hash(text) from public;
revoke all on function encheres.seat_of(text, text) from public;
revoke all on function encheres.clean_name(text) from public;
revoke all on function encheres.room_view(text, smallint) from public;

revoke all on function public.create_room(text, text, integer, integer, integer, integer, text[]) from public;
revoke all on function public.join_room(text, text, text) from public;
revoke all on function public.get_room(text, text) from public;
revoke all on function public.start_game(text, text) from public;
revoke all on function public.play(text, text, text, integer) from public;

grant execute on function public.create_room(text, text, integer, integer, integer, integer, text[]) to anon, authenticated;
grant execute on function public.join_room(text, text, text) to anon, authenticated;
grant execute on function public.get_room(text, text) to anon, authenticated;
grant execute on function public.start_game(text, text) to anon, authenticated;
grant execute on function public.play(text, text, text, integer) to anon, authenticated;

-- Ask the API layer to pick up the new functions straight away.
notify pgrst, 'reload schema';
