-- Enchères Animés — ranking, match records and feedback
--
-- Adds to 0001 and 0002:
--   * profiles      one per device token: name, country, avatar, trophies, stats
--   * matches       a record of every finished online game, with its action log
--   * characters    power ratings, so the server can judge ranked games itself
--   * feedback      messages from players
--   * rate_limits   per-client counters that slow down abuse
--
-- Quick matches are ranked. When one finishes, the server computes both team
-- powers, decides the winner and moves trophies; clients are never trusted
-- with a result. Run after 0002, then run 0004_character_powers.sql.
-- Idempotent.

create table if not exists encheres.characters (
  id    text primary key,
  power integer not null check (power between 0 and 100)
);

create table if not exists encheres.profiles (
  id             uuid primary key default gen_random_uuid(),
  token_hash     text not null unique,
  name           text not null,
  country        text check (country ~ '^[A-Z]{2}$'),
  avatar         smallint not null default 0 check (avatar between 0 and 11),
  trophies       integer not null default 0 check (trophies >= 0),
  best_trophies  integer not null default 0,
  games          integer not null default 0,
  wins           integer not null default 0,
  losses         integer not null default 0,
  ties           integer not null default 0,
  forfeits       integer not null default 0,
  streak         integer not null default 0,
  best_streak    integer not null default 0,
  -- Monday of the week `week_gain` belongs to.
  week           date not null default (date_trunc('week', now() at time zone 'utc'))::date,
  week_gain      integer not null default 0,
  practice_day   date,
  practice_count integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists profiles_trophies_idx on encheres.profiles (trophies desc, updated_at);
create index if not exists profiles_week_idx on encheres.profiles (week, week_gain desc);
create index if not exists profiles_country_idx on encheres.profiles (country, trophies desc);

create table if not exists encheres.matches (
  id          bigint generated always as identity primary key,
  finished_at timestamptz not null default now(),
  kind        text not null check (kind in ('ranked', 'private', 'practice')),
  room_code   text,
  profile0    uuid references encheres.profiles (id) on delete set null,
  profile1    uuid references encheres.profiles (id) on delete set null,
  names       text[] not null,
  teams       jsonb not null,
  powers      numeric[] not null,
  winner      smallint check (winner in (0, 1)),
  forfeit     smallint check (forfeit in (0, 1)),
  deltas      integer[] not null default '{0,0}',
  settings    jsonb not null default '{}'::jsonb,
  history     jsonb not null default '[]'::jsonb,
  log         jsonb not null default '[]'::jsonb
);

create index if not exists matches_profile0_idx on encheres.matches (profile0, finished_at desc);
create index if not exists matches_profile1_idx on encheres.matches (profile1, finished_at desc);

create table if not exists encheres.feedback (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  profile    uuid references encheres.profiles (id) on delete set null,
  category   text not null check (category in ('idea', 'bug', 'ratings', 'other')),
  message    text not null,
  contact    text,
  lang       text
);

create table if not exists encheres.rate_limits (
  key    text not null,
  bucket timestamptz not null,
  count  integer not null default 0,
  primary key (key, bucket)
);

alter table encheres.rooms add column if not exists log jsonb not null default '[]'::jsonb;
alter table encheres.rooms add column if not exists settled boolean not null default false;
alter table encheres.rooms add column if not exists result jsonb;

alter table encheres.characters enable row level security;
alter table encheres.profiles enable row level security;
alter table encheres.matches enable row level security;
alter table encheres.feedback enable row level security;
alter table encheres.rate_limits enable row level security;
revoke all on all tables in schema encheres from public;

-- ---------------------------------------------------------------------------
-- Constants
-- ---------------------------------------------------------------------------

-- Below this many trophies a quick match may be played against the computer.
create or replace function encheres.practice_below()
returns integer language sql immutable set search_path = '' as $$ select 300; $$;

-- Practice results that count per day.
create or replace function encheres.practice_per_day()
returns integer language sql immutable set search_path = '' as $$ select 10; $$;

create or replace function encheres.current_week()
returns date language sql stable set search_path = '' as $$
  select (date_trunc('week', now() at time zone 'utc'))::date;
$$;

-- ---------------------------------------------------------------------------
-- Rate limiting
-- ---------------------------------------------------------------------------

-- A stable, anonymous identifier for the caller's network address: a hash,
-- never the address itself. Null when the address is unknown (tests).
create or replace function encheres.client_key()
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_headers json;
  v_ip text;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    return null;
  end;
  if v_headers is null then
    return null;
  end if;
  v_ip := coalesce(v_headers ->> 'cf-connecting-ip', split_part(v_headers ->> 'x-forwarded-for', ',', 1));
  if v_ip is null or btrim(v_ip) = '' then
    return null;
  end if;
  return encode(sha256(convert_to('encheres:' || btrim(v_ip), 'UTF8')), 'hex');
end;
$$;

-- Counts one call for `p_key` and refuses once more than `p_max` were made in
-- the current window. A null key (caller unknown) is not limited.
create or replace function encheres.hit(p_key text, p_max integer, p_window interval)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_seconds numeric := extract(epoch from p_window);
  v_bucket timestamptz;
  v_count integer;
begin
  if p_key is null then
    return;
  end if;
  v_bucket := to_timestamp(floor(extract(epoch from now()) / v_seconds) * v_seconds);
  insert into encheres.rate_limits as l (key, bucket, count)
  values (p_key, v_bucket, 1)
  on conflict (key, bucket) do update set count = l.count + 1
  returning l.count into v_count;
  if v_count > p_max then
    raise exception 'RATE_LIMITED';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles and trophies
-- ---------------------------------------------------------------------------

-- The profile of a device token, created on first use. A non-null name
-- replaces the stored one.
create or replace function encheres.profile_for(p_hash text, p_name text)
returns encheres.profiles
language plpgsql
set search_path = ''
as $$
declare
  p encheres.profiles;
begin
  insert into encheres.profiles as existing (token_hash, name)
  values (p_hash, coalesce(p_name, 'Player'))
  on conflict (token_hash) do update
    set name = coalesce(p_name, existing.name)
  returning * into p;
  return p;
end;
$$;

-- Trophies won for beating an opponent: more against a higher-ranked one.
create or replace function encheres.win_gain(p_me integer, p_opponent integer)
returns integer language sql immutable set search_path = '' as $$
  select greatest(10, least(50, 30 + round((p_opponent - p_me) / 20.0)::integer));
$$;

-- Trophies lost to an opponent: fewer against a higher-ranked one.
create or replace function encheres.loss_cost(p_me integer, p_opponent integer)
returns integer language sql immutable set search_path = '' as $$
  select greatest(8, least(44, 26 - round((p_opponent - p_me) / 20.0)::integer));
$$;

-- Applies one result to a profile and returns its new trophy count.
create or replace function encheres.apply_result(
  p_profile uuid,
  p_outcome text,       -- 'win', 'loss' or 'tie'
  p_delta integer,      -- signed trophy change
  p_forfeited boolean   -- this player gave up or timed out
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_week date := encheres.current_week();
  v_trophies integer;
begin
  update encheres.profiles
     set trophies = greatest(0, trophies + p_delta),
         best_trophies = greatest(best_trophies, trophies + p_delta),
         games = games + 1,
         wins = wins + (p_outcome = 'win')::integer,
         losses = losses + (p_outcome = 'loss')::integer,
         ties = ties + (p_outcome = 'tie')::integer,
         forfeits = forfeits + coalesce(p_forfeited, false)::integer,
         streak = case when p_outcome = 'win' then streak + 1 else 0 end,
         best_streak = greatest(best_streak, case when p_outcome = 'win' then streak + 1 else 0 end),
         week_gain = case when week = v_week then week_gain else 0 end + p_delta,
         week = v_week,
         updated_at = now()
   where id = p_profile
  returning trophies into v_trophies;
  return v_trophies;
end;
$$;

-- Team power: strength doubles every 2.5 points and a team's strength is the
-- sum of its members'. Mirrors src/game/verdict.ts.
create or replace function encheres.team_power(p_team text[])
returns double precision
language sql
stable
set search_path = ''
as $$
  select case
           when coalesce(sum(power(2::double precision, c.power / 2.5::double precision)), 0) > 0
             then 2.5 * ln(sum(power(2::double precision, c.power / 2.5::double precision))) / ln(2::double precision)
           else 0
         end
    from unnest(p_team) as t (id)
    join encheres.characters c on c.id = t.id
   where c.power > 0;
$$;

-- Judges a finished room once: decides the winner, moves trophies if the
-- room is ranked, and files the match. The caller holds the room lock.
create or replace function encheres.settle_match(p_code text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  r encheres.rooms;
  s0 encheres.room_players;
  s1 encheres.room_players;
  f0 encheres.profiles;
  f1 encheres.profiles;
  v_power0 double precision;
  v_power1 double precision;
  v_winner smallint;
  v_delta0 integer := 0;
  v_delta1 integer := 0;
  v_total0 integer;
  v_total1 integer;
  v_id0 uuid;
  v_id1 uuid;
begin
  select * into r from encheres.rooms where code = p_code;
  if not found or r.settled or r.status <> 'finished' then
    return;
  end if;
  select * into s0 from encheres.room_players where room_code = p_code and seat = 0;
  select * into s1 from encheres.room_players where room_code = p_code and seat = 1;
  if s0.room_code is null or s1.room_code is null then
    return;
  end if;

  v_power0 := encheres.team_power(s0.team);
  v_power1 := encheres.team_power(s1.team);
  v_winner := case
                when r.forfeit is not null then 1 - r.forfeit
                when abs(v_power0 - v_power1) < 0.4 then null
                when v_power0 > v_power1 then 0
                else 1
              end;

  if r.matched then
    f0 := encheres.profile_for(s0.token_hash, null);
    f1 := encheres.profile_for(s1.token_hash, null);
    v_id0 := f0.id;
    v_id1 := f1.id;
    if v_winner = 0 then
      v_delta0 := encheres.win_gain(f0.trophies, f1.trophies);
      v_delta1 := -least(f1.trophies, encheres.loss_cost(f1.trophies, f0.trophies));
    elsif v_winner = 1 then
      v_delta1 := encheres.win_gain(f1.trophies, f0.trophies);
      v_delta0 := -least(f0.trophies, encheres.loss_cost(f0.trophies, f1.trophies));
    end if;
    v_total0 := encheres.apply_result(
      f0.id, case when v_winner is null then 'tie' when v_winner = 0 then 'win' else 'loss' end,
      v_delta0, r.forfeit = 0);
    v_total1 := encheres.apply_result(
      f1.id, case when v_winner is null then 'tie' when v_winner = 1 then 'win' else 'loss' end,
      v_delta1, r.forfeit = 1);
  else
    -- Private rooms are recorded but never move trophies.
    select id into v_id0 from encheres.profiles where token_hash = s0.token_hash;
    select id into v_id1 from encheres.profiles where token_hash = s1.token_hash;
  end if;

  insert into encheres.matches
    (kind, room_code, profile0, profile1, names, teams, powers, winner, forfeit, deltas, settings, history, log)
  values (
    case when r.matched then 'ranked' else 'private' end,
    r.code, v_id0, v_id1,
    array[s0.name, s1.name],
    jsonb_build_array(to_jsonb(s0.team), to_jsonb(s1.team)),
    array[round(v_power0::numeric, 2), round(v_power1::numeric, 2)],
    v_winner, r.forfeit,
    array[v_delta0, v_delta1],
    jsonb_build_object('budget', r.budget, 'teamSize', r.team_size, 'minBid', r.min_bid,
                       'increment', r.increment, 'poolSize', coalesce(array_length(r.pool, 1), 0)),
    r.history, r.log
  );

  update encheres.rooms
     set settled = true,
         result = jsonb_build_object(
           'winner', v_winner,
           'power', jsonb_build_array(round(v_power0::numeric, 1), round(v_power1::numeric, 1)),
           'deltas', case when r.matched then jsonb_build_array(v_delta0, v_delta1) else null end,
           'trophies', case when r.matched then jsonb_build_array(v_total0, v_total1) else null end
         )
   where code = p_code;
end;
$$;

-- Ends a matched game: `p_loser` forfeits and the other player wins.
create or replace function encheres.end_by_forfeit(p_code text, p_loser smallint)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update encheres.rooms
     set status = 'finished',
         phase = 'finished',
         forfeit = p_loser,
         card = null,
         version = version + 1,
         updated_at = now()
   where code = p_code;
  perform encheres.settle_match(p_code);
end;
$$;

-- What a player sees of their own profile.
create or replace function encheres.profile_json(p encheres.profiles)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_recent jsonb;
  v_rank integer;
  v_players integer;
begin
  select coalesce(jsonb_agg(item order by finished_at desc), '[]'::jsonb) into v_recent
    from (
      select m.finished_at,
             jsonb_build_object(
               'at', m.finished_at,
               'kind', m.kind,
               'opponent', m.names[case when m.profile0 = p.id then 2 else 1 end],
               'outcome', case
                            when m.winner is null then 'tie'
                            when (m.winner = 0) = (m.profile0 = p.id) then 'win'
                            else 'loss'
                          end,
               'delta', m.deltas[case when m.profile0 = p.id then 1 else 2 end],
               'forfeit', m.forfeit is not null,
               'power', m.powers[case when m.profile0 = p.id then 1 else 2 end],
               'opponentPower', m.powers[case when m.profile0 = p.id then 2 else 1 end]
             ) as item
        from encheres.matches m
       where (m.profile0 = p.id or m.profile1 = p.id) and m.kind <> 'private'
       order by m.finished_at desc
       limit 10
    ) recent;

  select count(*) into v_players from encheres.profiles where games > 0;
  if p.games > 0 then
    select count(*) + 1 into v_rank
      from encheres.profiles o
     where o.games > 0
       and (o.trophies > p.trophies or (o.trophies = p.trophies and o.updated_at < p.updated_at));
  end if;

  return jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'country', p.country,
    'avatar', p.avatar,
    'trophies', p.trophies,
    'best', p.best_trophies,
    'games', p.games,
    'wins', p.wins,
    'losses', p.losses,
    'ties', p.ties,
    'forfeits', p.forfeits,
    'streak', p.streak,
    'bestStreak', p.best_streak,
    'weekGain', case when p.week = encheres.current_week() then p.week_gain else 0 end,
    'rank', v_rank,
    'players', v_players,
    'practiceBelow', encheres.practice_below(),
    'recent', v_recent
  );
end;
$$;

-- Same as before, plus `result`: the server's verdict once the room is settled.
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
    'result', r.result
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Existing API, extended
-- ---------------------------------------------------------------------------

-- As in 0001, with a limit on how many rooms one client can open.
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

  perform encheres.hit('room:' || encheres.client_key(), 40, interval '1 hour');

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

-- As in 0001, keeping a log of every action and settling the room when it ends.
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

  return encheres.room_view(v_code, v_seat);
end;
$$;

-- As in 0002, with profiles, a check that the server knows every card, and
-- pairing by trophies.
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
  v_me encheres.profiles;
  v_waited numeric := 0;
begin
  if p_token is null or char_length(p_token) < 16 or char_length(p_token) > 128 then
    raise exception 'INVALID_INPUT';
  end if;
  v_hash := encheres.token_hash(p_token);

  -- One pairing at a time, so two callers can never both take the same seat.
  perform pg_advisory_xact_lock(hashtext('encheres.find_match'));

  -- Quick matches are ranked: every player has a profile.
  v_me := encheres.profile_for(v_hash, v_name);

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
    v_waited := extract(epoch from (now() - v_mine.created_at));
  end if;

  -- The waiting player closest in trophies who is still polling. The gap that
  -- is acceptable grows with the time either player has waited, so a close
  -- match is preferred but nobody waits forever.
  select r.code into v_other
    from encheres.rooms r
    join encheres.room_players p on p.room_code = r.code and p.seat = 0
    left join encheres.profiles hp on hp.token_hash = p.token_hash
   where r.matched
     and abs(coalesce(hp.trophies, 0) - v_me.trophies)
         <= 150 + 40 * greatest(v_waited, extract(epoch from (now() - r.created_at)))
     and r.status = 'lobby'
     and r.seen_at > now() - interval '12 seconds'
     and p.token_hash <> v_hash
     and (v_mine.code is null or (r.created_at, r.code) < (v_mine.created_at, v_mine.code))
     and (select count(*) from encheres.room_players q where q.room_code = r.code) = 1
   order by abs(coalesce(hp.trophies, 0) - v_me.trophies), r.created_at, r.code
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
  -- Ranked games are judged by the server, so it must know every card.
  if exists (select 1 from encheres.characters)
     and exists (select 1 from unnest(p_pool) as x
                  where not exists (select 1 from encheres.characters c where c.id = x))
  then
    raise exception 'INVALID_INPUT';
  end if;

  perform encheres.hit('match:' || encheres.client_key(), 120, interval '1 hour');

  delete from encheres.rooms where updated_at < now() - interval '24 hours';
  delete from encheres.rate_limits where bucket < now() - interval '2 days';

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

-- ---------------------------------------------------------------------------
-- Public API: profile, leaderboard, feedback, practice results
-- ---------------------------------------------------------------------------

create or replace function public.get_profile(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_token is null or char_length(p_token) < 16 or char_length(p_token) > 128 then
    raise exception 'INVALID_INPUT';
  end if;
  perform encheres.hit('profile-ip:' || encheres.client_key(), 600, interval '1 hour');
  return encheres.profile_json(encheres.profile_for(encheres.token_hash(p_token), null));
end;
$$;

create or replace function public.update_profile(
  p_token text,
  p_name text,
  p_country text,
  p_avatar integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_name text := encheres.clean_name(p_name);
  v_country text := nullif(upper(btrim(coalesce(p_country, ''))), '');
  p encheres.profiles;
begin
  if p_token is null or char_length(p_token) < 16 or char_length(p_token) > 128
     or (v_country is not null and v_country !~ '^[A-Z]{2}$')
     or p_avatar is null or p_avatar < 0 or p_avatar > 11
  then
    raise exception 'INVALID_INPUT';
  end if;
  v_hash := encheres.token_hash(p_token);
  perform encheres.hit('profile:' || v_hash, 60, interval '1 day');
  perform encheres.profile_for(v_hash, v_name);
  update encheres.profiles
     set country = v_country, avatar = p_avatar
   where token_hash = v_hash
  returning * into p;
  return encheres.profile_json(p);
end;
$$;

-- Top 50 by trophies (`all`) or by trophies gained this week (`week`),
-- optionally for one country, plus the caller's own position.
create or replace function public.leaderboard(
  p_token text,
  p_scope text default 'all',
  p_country text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_country text := nullif(upper(btrim(coalesce(p_country, ''))), '');
  v_week date := encheres.current_week();
  v_me encheres.profiles;
  v_rows jsonb;
  v_total integer;
  v_mine jsonb;
begin
  if p_scope not in ('all', 'week') or (v_country is not null and v_country !~ '^[A-Z]{2}$') then
    raise exception 'INVALID_INPUT';
  end if;
  if p_token is not null and char_length(p_token) between 16 and 128 then
    select * into v_me from encheres.profiles where token_hash = encheres.token_hash(p_token);
  end if;

  with ranked as (
    select p.id, p.name, p.country, p.avatar,
           case when p_scope = 'week' then p.week_gain else p.trophies end as value,
           row_number() over (
             order by case when p_scope = 'week' then p.week_gain else p.trophies end desc, p.updated_at
           ) as rank
      from encheres.profiles p
     where p.games > 0
       and (v_country is null or p.country = v_country)
       and (p_scope = 'all' or (p.week = v_week and p.week_gain > 0))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'rank', rank, 'name', name, 'country', country, 'avatar', avatar, 'value', value,
           'you', id = v_me.id) order by rank) filter (where rank <= 50), '[]'::jsonb),
         count(*),
         (jsonb_agg(jsonb_build_object('rank', rank, 'value', value)) filter (where id = v_me.id)) -> 0
    into v_rows, v_total, v_mine
    from ranked;

  return jsonb_build_object('rows', v_rows, 'total', v_total, 'me', v_mine);
end;
$$;

create or replace function public.send_feedback(
  p_token text,
  p_category text,
  p_message text,
  p_contact text default null,
  p_lang text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_message text := btrim(coalesce(p_message, ''));
  v_contact text := nullif(btrim(coalesce(p_contact, '')), '');
begin
  if p_token is null or char_length(p_token) < 16 or char_length(p_token) > 128
     or p_category is null or p_category not in ('idea', 'bug', 'ratings', 'other')
     or char_length(v_message) < 5 or char_length(v_message) > 1000
     or char_length(coalesce(v_contact, '')) > 120
  then
    raise exception 'INVALID_INPUT';
  end if;
  v_hash := encheres.token_hash(p_token);
  perform encheres.hit('feedback:' || v_hash, 5, interval '1 day');
  perform encheres.hit('feedback-ip:' || encheres.client_key(), 20, interval '1 day');

  insert into encheres.feedback (profile, category, message, contact, lang)
  values ((select id from encheres.profiles where token_hash = v_hash),
          p_category, v_message, v_contact, left(coalesce(p_lang, ''), 5));
  return true;
end;
$$;

-- Result of a quick match played against the computer. The game ran in the
-- browser, so the result cannot be verified: it only counts below a low
-- trophy ceiling, for small amounts, a few times a day.
create or replace function public.report_practice(
  p_token text,
  p_outcome text,
  p_names text[],
  p_teams jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  p encheres.profiles;
  v_today date := (now() at time zone 'utc')::date;
  v_delta integer := 0;
  v_total integer;
  v_counts boolean;
  v_team0 text[];
  v_team1 text[];
begin
  if p_token is null or char_length(p_token) < 16 or char_length(p_token) > 128
     or p_outcome is null or p_outcome not in ('win', 'loss', 'tie')
     or coalesce(array_length(p_names, 1), 0) <> 2
     or char_length(p_names[1]) > 20 or char_length(p_names[2]) > 20
     or jsonb_typeof(p_teams) <> 'array' or jsonb_array_length(p_teams) <> 2
     or jsonb_typeof(p_teams -> 0) <> 'array' or jsonb_typeof(p_teams -> 1) <> 'array'
     or jsonb_array_length(p_teams -> 0) > 10 or jsonb_array_length(p_teams -> 1) > 10
  then
    raise exception 'INVALID_INPUT';
  end if;
  v_hash := encheres.token_hash(p_token);
  perform encheres.hit('practice:' || v_hash, 60, interval '1 day');

  p := encheres.profile_for(v_hash, null);
  v_counts := p.trophies < encheres.practice_below()
              and (p.practice_day is distinct from v_today or p.practice_count < encheres.practice_per_day());
  if not v_counts then
    return jsonb_build_object('delta', 0, 'trophies', p.trophies, 'counted', false);
  end if;

  if p_outcome = 'win' then
    v_delta := least(20, encheres.practice_below() - p.trophies);
  elsif p_outcome = 'loss' then
    v_delta := -least(10, p.trophies);
  end if;
  v_total := encheres.apply_result(p.id, p_outcome, v_delta, false);
  update encheres.profiles
     set practice_count = case when practice_day = v_today then practice_count + 1 else 1 end,
         practice_day = v_today
   where id = p.id;

  select array_agg(x) into v_team0 from jsonb_array_elements_text(p_teams -> 0) as x where char_length(x) <= 64;
  select array_agg(x) into v_team1 from jsonb_array_elements_text(p_teams -> 1) as x where char_length(x) <= 64;
  insert into encheres.matches (kind, profile0, names, teams, powers, winner, deltas)
  values (
    'practice', p.id, p_names, p_teams,
    array[round(encheres.team_power(coalesce(v_team0, '{}'))::numeric, 2),
          round(encheres.team_power(coalesce(v_team1, '{}'))::numeric, 2)],
    case p_outcome when 'win' then 0 when 'loss' then 1 else null end,
    array[v_delta, 0]
  );

  return jsonb_build_object('delta', v_delta, 'trophies', v_total, 'counted', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

revoke all on all functions in schema encheres from public;

revoke all on function public.get_profile(text) from public;
revoke all on function public.update_profile(text, text, text, integer) from public;
revoke all on function public.leaderboard(text, text, text) from public;
revoke all on function public.send_feedback(text, text, text, text, text) from public;
revoke all on function public.report_practice(text, text, text[], jsonb) from public;
revoke all on function public.play(text, text, text, integer) from public;
revoke all on function public.create_room(text, text, integer, integer, integer, integer, text[]) from public;
revoke all on function public.find_match(text, text, integer, integer, integer, integer, text[], text) from public;

grant execute on function public.get_profile(text) to anon, authenticated;
grant execute on function public.update_profile(text, text, text, integer) to anon, authenticated;
grant execute on function public.leaderboard(text, text, text) to anon, authenticated;
grant execute on function public.send_feedback(text, text, text, text, text) to anon, authenticated;
grant execute on function public.report_practice(text, text, text[], jsonb) to anon, authenticated;
grant execute on function public.play(text, text, text, integer) to anon, authenticated;
grant execute on function public.create_room(text, text, integer, integer, integer, integer, text[]) to anon, authenticated;
grant execute on function public.find_match(text, text, integer, integer, integer, integer, text[], text) to anon, authenticated;

notify pgrst, 'reload schema';
