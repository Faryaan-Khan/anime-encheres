-- Enchères Animés — three players (1 vs 1 vs 1) in rooms.
--
-- The auction itself takes two players or three: the drawer speaks first,
-- then each player in seat order (0, 1, 2, 0, ...) bids or passes; a card is
-- sold once everyone but the high bidder has passed, and discarded if all
-- pass. With two players this is exactly the rule as before (the parity test
-- plays the TypeScript engine against it). Each of the three has their own
-- budget and team. Trio rooms are never ranked; ranked 1v1v1 comes later.
--
-- Safe to run twice.

-- Seats 0 to 2.
alter table encheres.room_players drop constraint if exists room_players_seat_check;
alter table encheres.room_players add constraint room_players_seat_check check (seat in (0, 1, 2));
alter table encheres.rooms drop constraint if exists rooms_drawer_check;
alter table encheres.rooms add constraint rooms_drawer_check check (drawer in (0, 1, 2));
alter table encheres.rooms drop constraint if exists rooms_turn_check;
alter table encheres.rooms add constraint rooms_turn_check check (turn in (0, 1, 2));
alter table encheres.rooms drop constraint if exists rooms_high_bidder_check;
alter table encheres.rooms add constraint rooms_high_bidder_check check (high_bidder in (0, 1, 2));
alter table encheres.matches drop constraint if exists matches_winner_check;
alter table encheres.matches add constraint matches_winner_check check (winner in (0, 1, 2));
alter table encheres.matches add column if not exists profile2 uuid references encheres.profiles (id) on delete set null;
-- Three-player games: each player's place, 1 first (ties share a place).
alter table encheres.matches add column if not exists places smallint[];

-- As in 0012, for two or three players.
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
  -- Every card of the pool: the whole universe, or every universe when mixed.
  select array_agg(x order by random()) into v_deck from unnest(r.pool) as x;
  v_drawer := floor(random() * encheres.side_count(r.format))::smallint;

  update encheres.room_players
     set budget = r.budget, team = '{}', passes = 0, strikes = 0
   where room_code = p_code;

  update encheres.rooms
     set status = 'playing',
         phase = 'draw',
         round = 1,
         deck = v_deck,
         scale = encheres.scale_of(r.pool),
         drawer = v_drawer,
         turn = v_drawer,
         card = null,
         high_bid = 0,
         high_bidder = null,
         passed = array_fill(false, array[encheres.side_count(r.format)]),
         history = '[]'::jsonb,
         forfeit = null,
         version = version + 1,
         updated_at = now()
   where code = p_code;
end;
$$;

-- As in 0013, for two or three players.
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
  v_n smallint;        -- players: 2, or 3
begin
  select * into r from encheres.rooms where code = v_code for update;
  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  v_n := encheres.side_count(r.format);
  v_seat := p_seat;
  if v_seat is null or v_seat < 0 or v_seat >= v_n then
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
    r.passed := array_fill(false, array[v_n]);
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
    r.turn := (v_seat + 1) % v_n;
    v_settle := true;

  elsif p_action = 'pass' then
    if r.phase <> 'bidding' then raise exception 'WRONG_PHASE'; end if;
    if v_seat <> r.turn then raise exception 'NOT_YOUR_TURN'; end if;
    -- Skipping a card nobody has bid on costs one of the player's passes;
    -- letting the other player have a card they bid on is free.
    if r.high_bidder is null then
      if not encheres.can_pass(v_code, v_seat) and not encheres.old_client() then
        raise exception 'NO_PASSES_LEFT';
      end if;
      update encheres.room_players set passes = passes + 1 where room_code = v_code and seat = v_seat;
    end if;
    r.passed[v_seat + 1] := true;
    r.turn := (v_seat + 1) % v_n;
    v_settle := true;

  elsif p_action = 'next' then
    if r.phase <> 'reveal' then raise exception 'WRONG_PHASE'; end if;
    r.card := null;
    r.high_bid := 0;
    r.high_bidder := null;
    r.passed := array_fill(false, array[v_n]);
    if coalesce(array_length(r.deck, 1), 0) = 0
       or not exists (select 1 from generate_series(1, v_n) as i
                       where v_count[i] < r.team_size and v_budget[i] >= r.min_bid)
    then
      r.phase := 'finished';
      r.status := 'finished';
    else
      r.round := r.round + 1;
      r.drawer := (r.drawer + 1) % v_n;
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
      -- Everyone but the high bidder has passed: sold. (The high bidder
      -- cannot have passed: a pass is final.)
      if r.high_bidder is not null
         and (select count(*) from unnest(r.passed) as x where not x) <= 1 then
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

      if (select bool_and(x) from unnest(r.passed) as x) then
        r.history := r.history || jsonb_build_object(
          'round', r.round, 'card', r.card, 'winner', null, 'price', 0);
        r.phase := 'reveal';
        exit;
      end if;

      if r.passed[r.turn + 1] then
        r.turn := (r.turn + 1) % v_n;
        continue;
      end if;

      v_required := case when r.high_bidder is null then r.min_bid else r.high_bid + r.increment end;
      if v_count[r.turn + 1] >= r.team_size or v_budget[r.turn + 1] < v_required then
        r.passed[r.turn + 1] := true;
        r.turn := (r.turn + 1) % v_n;
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
    if v_n = 3 then
      perform encheres.settle_trio(v_code);
    else
      perform encheres.settle_match(v_code);
    end if;
  end if;

  return encheres.room_view(v_code, p_seat);
end;
$$;

-- The result of a three-player game: each team's power, places (teams within
-- the tie gap of each other share a place) and the winner, if one team is
-- clear of the next. Recorded like any match; trio rooms move no trophies.
create or replace function encheres.settle_trio(p_code text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  r encheres.rooms;
  v_names text[];
  v_teams jsonb;
  v_hashes text[];
  v_power double precision[];
  v_places smallint[];
  v_best double precision;
  v_second double precision;
  v_winner smallint;
begin
  select * into r from encheres.rooms where code = p_code;
  if not found or r.settled or r.status <> 'finished' then
    return;
  end if;
  select array_agg(p.name order by p.seat),
         jsonb_agg(to_jsonb(p.team) order by p.seat),
         array_agg(p.token_hash order by p.seat),
         array_agg(encheres.team_power(p.team) order by p.seat)
    into v_names, v_teams, v_hashes, v_power
    from encheres.room_players p
   where p.room_code = p_code;
  if coalesce(array_length(v_power, 1), 0) <> 3 then
    return;
  end if;

  select array_agg((1 + (select count(*) from unnest(v_power) as o where o - v_power[i] >= 0.4))::smallint order by i)
    into v_places
    from generate_series(1, 3) as i;
  select max(x) into v_best from unnest(v_power) as x;
  select max(x) into v_second
    from (select x, row_number() over (order by x desc) as n from unnest(v_power) as x) as y
   where n = 2;
  v_winner := case when v_best - v_second < 0.4 then null
                   else (select (i - 1)::smallint from generate_series(1, 3) as i where v_power[i] = v_best limit 1)
              end;

  insert into encheres.matches
    (kind, room_code, profile0, profile1, profile2, names, teams, powers, winner, places, deltas, settings,
     history, log)
  values (
    'private', r.code,
    encheres.profile_id_of(v_hashes[1]), encheres.profile_id_of(v_hashes[2]), encheres.profile_id_of(v_hashes[3]),
    v_names, v_teams,
    array[round(v_power[1]::numeric, 2), round(v_power[2]::numeric, 2), round(v_power[3]::numeric, 2)],
    v_winner, v_places, array[0, 0, 0],
    jsonb_build_object('budget', r.budget, 'teamSize', r.team_size, 'minBid', r.min_bid,
                       'increment', r.increment, 'poolSize', coalesce(array_length(r.pool, 1), 0)),
    r.history, r.log
  );

  update encheres.rooms
     set settled = true,
         result = jsonb_build_object(
           'winner', v_winner,
           'mode', null,
           'power', jsonb_build_array(round(v_power[1]::numeric, 1), round(v_power[2]::numeric, 1),
                                      round(v_power[3]::numeric, 1)),
           'places', to_jsonb(v_places),
           'deltas', null,
           'trophies', null
         )
   where code = p_code;
end;
$$;

-- As in 0016, also opening trio rooms (enough cards for three teams).
create or replace function public.create_room(
  p_token text,
  p_name text,
  p_budget integer,
  p_team_size integer,
  p_min_bid integer,
  p_increment integer,
  p_pool text[],
  p_public boolean default false,
  p_verse text default null,
  p_format text default 'duel'
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
  v_verse text := nullif(lower(btrim(coalesce(p_verse, ''))), '');
  v_format text := coalesce(nullif(btrim(p_format), ''), 'duel');
begin
  if p_token is null or char_length(p_token) < 16 or char_length(p_token) > 128 then
    raise exception 'INVALID_INPUT';
  end if;
  if p_budget is null or p_team_size is null or p_min_bid is null or p_increment is null
     or p_team_size < 1 or p_team_size > 10
     or p_min_bid < 1 or p_increment < 1
     or p_budget < p_min_bid or p_budget > 100000
     or v_pool_size > 400
     or exists (select 1 from unnest(p_pool) as x where x is null or char_length(x) not between 1 and 64)
     or (select count(distinct x) from unnest(p_pool) as x) <> v_pool_size
     or (v_verse is not null and v_verse !~ '^[a-z0-9-]{1,32}$')
     or v_format not in ('duel', 'teams', 'trio')
     -- Enough cards for every team.
     or v_pool_size < p_team_size * encheres.side_count(v_format)
  then
    raise exception 'INVALID_INPUT';
  end if;

  perform encheres.hit('room:' || encheres.client_key(), 40, interval '1 hour');

  -- Housekeeping: forget rooms nobody has touched for a day.
  delete from encheres.rooms where updated_at < now() - interval '24 hours';

  loop
    select string_agg(substr(v_alphabet, 1 + floor(random() * 32)::integer, 1), '')
      into v_code
      from generate_series(1, 5);
    exit when not exists (select 1 from encheres.rooms where code = v_code);
  end loop;

  insert into encheres.rooms (code, budget, team_size, min_bid, increment, pool, public, verse, format)
  values (v_code, p_budget, p_team_size, p_min_bid, p_increment, p_pool,
          coalesce(p_public, false), v_verse, v_format);

  insert into encheres.room_players (room_code, seat, token_hash, name, budget)
  values (v_code, 0, encheres.token_hash(p_token), v_name, p_budget);

  return encheres.room_view(v_code, 0::smallint);
end;
$$;

revoke all on all functions in schema encheres from public;

notify pgrst, 'reload schema';
