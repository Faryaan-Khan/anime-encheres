-- Enchères Animés — fair play: no waiting on a player who cannot play,
-- automatic wins over players who leave, and strikes for running out of time
--
-- Run after 0009. Idempotent.
--
-- 1. A player whose team is full, or who cannot afford the minimum bid, has
--    nothing left to decide. When it is their turn to draw, the card is drawn
--    for them and the other player bids straight away. (Same rule in
--    src/game/engine.ts, so offline games behave the same.)
--
-- 2. Quick matches only: each player's device is heard from every time it
--    asks for the room. A player not heard from for 40 seconds has left, and
--    the other player wins. Closing the page sends a "leaving" note that cuts
--    the wait to about 8 seconds; reloading the page comes back in time.
--
-- 3. Quick matches only: each move has 30 seconds. When time runs out the
--    server plays for the slow player (draws, or passes) and gives them a
--    strike. The third strike loses the match. Nobody has to claim the win.
--
-- Both are checked whenever either player's device asks for the room, so
-- they need no scheduler.

alter table encheres.room_players add column if not exists seen_at timestamptz not null default now();
alter table encheres.room_players add column if not exists strikes integer not null default 0;

-- ---------------------------------------------------------------------------
-- Limits
-- ---------------------------------------------------------------------------

create or replace function encheres.turn_seconds()
returns integer language sql immutable set search_path = '' as $$ select 30; $$;

create or replace function encheres.max_strikes()
returns integer language sql immutable set search_path = '' as $$ select 3; $$;

create or replace function encheres.away_seconds()
returns integer language sql immutable set search_path = '' as $$ select 40; $$;

-- ---------------------------------------------------------------------------
-- Presence and the clock
-- ---------------------------------------------------------------------------

create or replace function encheres.touch(p_code text, p_seat smallint)
returns void language sql set search_path = '' as $$
  update encheres.room_players set seen_at = now() where room_code = p_code and seat = p_seat;
$$;

-- Ends a quick match whose player has left, or plays for a player whose time
-- is up and counts a strike against them.
create or replace function encheres.enforce(p_code text)
returns void language plpgsql set search_path = '' as $$
declare
  r encheres.rooms;
  v_gone smallint;
  v_actor smallint;
  v_strikes integer;
begin
  select * into r from encheres.rooms where code = p_code for update;
  if not found or not r.matched or r.status <> 'playing' then
    return;
  end if;

  -- A player has left. The waiting room's last poll counts as being heard
  -- from, so the start of a game never counts against anyone.
  select p.seat into v_gone
    from encheres.room_players p
   where p.room_code = p_code
     and p.seat is distinct from r.bot_seat
     and greatest(p.seen_at, r.seen_at) < now() - make_interval(secs => encheres.away_seconds())
   order by p.seen_at
   limit 1;
  if v_gone is not null then
    perform encheres.end_by_forfeit(p_code, v_gone);
    return;
  end if;

  -- The player to move ran out of time. Nobody is on the clock during a reveal.
  v_actor := case r.phase when 'draw' then r.drawer when 'bidding' then r.turn else null end;
  if v_actor is null or v_actor is not distinct from r.bot_seat
     or now() - r.updated_at < make_interval(secs => encheres.turn_seconds())
  then
    return;
  end if;
  update encheres.room_players set strikes = strikes + 1
   where room_code = p_code and seat = v_actor
  returning strikes into v_strikes;
  if v_strikes >= encheres.max_strikes() then
    perform encheres.end_by_forfeit(p_code, v_actor);
  else
    perform encheres.play_as(p_code, v_actor, case r.phase when 'draw' then 'draw' else 'pass' end, null);
  end if;
end;
$$;

create or replace function encheres.play_as(
  p_code text,
  p_seat smallint,
  p_action text,
  p_amount integer default null
)
returns jsonb
language plpgsql
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
  v_seat := p_seat;
  if v_seat is null or v_seat not in (0, 1) then
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
      -- A drawer who can no longer buy anything would only hold the other
      -- player up: draw for them and open the bidding at once.
      if not (v_count[r.drawer + 1] < r.team_size and v_budget[r.drawer + 1] >= r.min_bid) then
        r.log := r.log || jsonb_build_object('r', r.round - 1, 's', v_seat, 'a', 'next', 'v', null);
        p_action := 'draw';
        v_seat := r.drawer;
        r.card := r.deck[1];
        r.deck := r.deck[2:];
        r.phase := 'bidding';
        r.turn := r.drawer;
        v_settle := true;
      end if;
    end if;

  else
    raise exception 'UNKNOWN_ACTION';
  end if;

  -- Keep every action: this is the record a learning opponent would train on.
  r.log := r.log || jsonb_build_object('r', r.round, 's', v_seat, 'a', p_action, 'v', p_amount);

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
         log = r.log,
         version = r.version + 1,
         updated_at = now()
   where code = v_code;

  if r.status = 'finished' then
    perform encheres.settle_match(v_code);
  end if;

  return encheres.room_view(v_code, p_seat);
end;
$$;

-- The public entry point: who is calling decides the seat. Also records that
-- this player is still here.
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
  perform encheres.touch(v_code, v_seat);
  return encheres.play_as(v_code, v_seat, p_action, p_amount);
end;
$$;

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
    'idle', greatest(0, floor(extract(epoch from (now() - r.updated_at)))::integer),
    'result', r.result,
    'turnSeconds', encheres.turn_seconds(),
    'strikes', (select coalesce(jsonb_agg(p.strikes order by p.seat), '[]'::jsonb)
                  from encheres.room_players p where p.room_code = p_code),
    'maxStrikes', encheres.max_strikes(),
    -- Seconds since each seat was last heard from; the computer is always there.
    'absent', (select coalesce(jsonb_agg(
                        case when p.seat = r.bot_seat then 0
                             else greatest(0, floor(extract(epoch from (now() - p.seen_at)))::integer) end
                        order by p.seat), '[]'::jsonb)
                 from encheres.room_players p where p.room_code = p_code),
    'awaySeconds', encheres.away_seconds()
  );
end;
$$;

create or replace function encheres.bot_step(p_code text)
returns void language plpgsql set search_path = '' as $$
declare
  r encheres.rooms;
  v_actor smallint;
  v_idle double precision;
  v_pace double precision;
  v_pause double precision;
  v_roll double precision;
  v_choice jsonb;
  v_nonce text;
begin
  select * into r from encheres.rooms where code = p_code for update;
  if not found or r.bot_seat is null or r.status <> 'playing' then
    return;
  end if;
  v_actor := case r.phase when 'draw' then r.drawer when 'bidding' then r.turn else null end;
  v_idle := extract(epoch from (now() - r.updated_at));

  -- The player's move: their clock is enforced by encheres.enforce.
  if v_actor is not null and v_actor <> r.bot_seat then
    return;
  end if;

  -- Think for a moment, like a person: longer over a bid than over a draw,
  -- and leave the result on screen before moving on.
  v_pace := coalesce((encheres.setting('opponent_pace') #>> '{}')::double precision, 1);
  v_roll := encheres.unit('pause:' || r.bot_token || ':' || r.version);
  v_pause := v_pace * case r.phase
                        when 'draw' then 1.0 + 1.6 * v_roll
                        when 'bidding' then 1.5 + 3.0 * v_roll
                        else 6.0 + 3.0 * v_roll
                      end;
  if v_idle < v_pause then
    return;
  end if;

  -- Strong opponents think in the Edge Function. Ask it once per position;
  -- if it has not moved after a few seconds, move here instead.
  if r.phase = 'bidding' and encheres.lookahead_available() and r.bot_skill >= encheres.lookahead_from() then
    if r.bot_request_version is distinct from r.version then
      v_nonce := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
      update encheres.rooms
         set bot_nonce = v_nonce, bot_request_version = r.version, bot_requested_at = now()
       where code = p_code;
      perform encheres.call_opponent(p_code, v_nonce);
      return;
    elsif now() - r.bot_requested_at < interval '6 seconds' then
      return;
    end if;
  end if;

  begin
    v_choice := encheres.bot_choice(
      p_code,
      encheres.unit('noise:' || r.bot_token || ':' || r.round),
      encheres.unit('bluff:' || r.bot_token || ':' || r.round),
      encheres.unit('jump:' || r.bot_token || ':' || r.version));
    perform encheres.play_as(p_code, r.bot_seat, v_choice ->> 'a', (v_choice ->> 'v')::integer);
  exception when others then
    -- Never leave the player stuck: fall back to the simplest legal move.
    perform encheres.play_as(p_code, r.bot_seat,
                             case r.phase when 'draw' then 'draw' when 'reveal' then 'next' else 'pass' end, null);
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Public API
-- ---------------------------------------------------------------------------

-- As in 0005, and records the caller as present and applies the clock.
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
  perform encheres.touch(v_code, v_seat);
  perform encheres.enforce(v_code);
  perform encheres.bot_step(v_code);
  return encheres.room_view(v_code, v_seat);
end;
$$;

-- Sent by a page that is closing. Leaves a few seconds to come back (a
-- reload), then counts as having left.
create or replace function public.leaving(p_code text, p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_seat smallint;
begin
  v_seat := encheres.seat_of(v_code, p_token);
  if v_seat is null then
    return;
  end if;
  update encheres.room_players
     set seen_at = least(seen_at, now() - make_interval(secs => encheres.away_seconds() - 8))
   where room_code = v_code and seat = v_seat;
end;
$$;

revoke all on all functions in schema encheres from public;
revoke all on function public.leaving(text, text) from public;
grant execute on function public.leaving(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
