-- Enchères Animés — autopilot for finished players, and a longer leaderboard
--
-- Run after 0010. Idempotent.
--
-- 1. A player who cannot buy anything more (team full, or less money than the
--    minimum bid) has finished: whatever happens next cannot change their
--    team. From then on:
--    - they never count as having left, and "Forfeit" from them is not a
--      forfeit: the match is played out and settled, trophies included, with
--      or without them;
--    - against the computer, the computer finishes its own team at once and
--      the game ends.
--
-- 2. Results move on by themselves: in a quick match between two people, the
--    room moves on from a result nobody moved on from after 12 seconds. (The
--    client moves on after a short countdown; this is the backstop.)
--
-- 3. Games nobody is watching any more are moved along by
--    encheres.sweep_games(), run every minute by pg_cron where it is
--    available (Supabase), so they end and are settled even if both players
--    are gone.
--
-- 4. Leaderboards show the top 1000, and a player further down sees their own
--    place with the player above and the player below.

-- ---------------------------------------------------------------------------
-- Limits and helpers
-- ---------------------------------------------------------------------------

create or replace function encheres.reveal_seconds()
returns integer language sql immutable set search_path = '' as $$ select 12; $$;

create or replace function encheres.leaderboard_size()
returns integer language sql immutable set search_path = '' as $$ select 1000; $$;

-- True while this seat has room in its team and money for the minimum bid.
-- Same rule as canStillBuy in src/game/engine.ts.
create or replace function encheres.can_buy(p_code text, p_seat smallint)
returns boolean language sql stable set search_path = '' as $$
  select coalesce(bool_or(coalesce(array_length(p.team, 1), 0) < r.team_size and p.budget >= r.min_bid), false)
    from encheres.rooms r
    join encheres.room_players p on p.room_code = r.code and p.seat = p_seat
   where r.code = p_code;
$$;

-- Against the computer, once the player cannot buy any more: the computer
-- plays its remaining rounds straight away, without pauses.
create or replace function encheres.finish_for_bot(p_code text)
returns void language plpgsql set search_path = '' as $$
declare
  r encheres.rooms;
  v_choice jsonb;
  v_steps integer := 0;
begin
  loop
    select * into r from encheres.rooms where code = p_code for update;
    exit when not found or r.status <> 'playing' or r.bot_seat is null or v_steps >= 400;
    v_steps := v_steps + 1;
    if r.phase = 'reveal' then
      perform encheres.play_as(p_code, r.bot_seat, 'next', null);
    elsif r.phase = 'draw' then
      perform encheres.play_as(p_code, r.drawer, 'draw', null);
    elsif r.turn = r.bot_seat then
      begin
        v_choice := encheres.bot_choice(
          p_code,
          encheres.unit('noise:' || r.bot_token || ':' || r.round),
          encheres.unit('bluff:' || r.bot_token || ':' || r.round),
          encheres.unit('jump:' || r.bot_token || ':' || r.version));
        perform encheres.play_as(p_code, r.bot_seat, v_choice ->> 'a', (v_choice ->> 'v')::integer);
      exception when others then
        perform encheres.play_as(p_code, r.bot_seat, 'pass', null);
      end;
    else
      perform encheres.play_as(p_code, r.turn, 'pass', null);
    end if;
  end loop;
end;
$$;

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
     -- A player who cannot buy anything more has nothing left to do: their
     -- result stands whether they watch the rest or not.
     and encheres.can_buy(p_code, p.seat)
     and greatest(p.seen_at, r.seen_at) < now() - make_interval(secs => encheres.away_seconds())
   order by p.seen_at
   limit 1;
  if v_gone is not null then
    perform encheres.end_by_forfeit(p_code, v_gone);
    return;
  end if;

  -- Nobody moved on from a result: the room does it. Against the computer,
  -- bot_step already does.
  if r.phase = 'reveal' and r.bot_seat is null
     and now() - r.updated_at >= make_interval(secs => encheres.reveal_seconds())
  then
    perform encheres.play_as(p_code, r.drawer, 'next', null);
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
  -- The player cannot buy anything more: nothing the computer does can change
  -- their result, so it finishes its own team at once and the game ends. The
  -- result of the player's last purchase stays on screen first.
  if r.phase <> 'reveal' and not encheres.can_buy(p_code, (1 - r.bot_seat)::smallint) then
    perform encheres.finish_for_bot(p_code);
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

-- As in 0005: a player who walked away from the computer loses. A player who
-- had already finished their team has not walked away: the game is finished
-- for them instead.
create or replace function encheres.sweep_abandoned(p_hash text)
returns void language plpgsql set search_path = '' as $$
declare
  v_room record;
begin
  for v_room in
    select r.code, p.seat
      from encheres.rooms r
      join encheres.room_players p on p.room_code = r.code and p.seat = 1 - r.bot_seat
     where r.bot_seat is not null and r.status = 'playing'
       and p.token_hash = p_hash
       and r.updated_at < now() - interval '90 seconds'
     for update of r
  loop
    if encheres.can_buy(v_room.code, v_room.seat) then
      perform encheres.end_by_forfeit(v_room.code, v_room.seat);
    else
      perform encheres.finish_for_bot(v_room.code);
    end if;
  end loop;
end;
$$;

-- Moves along every quick match: time-outs, players who left, results nobody
-- moved on from, and the computer's moves. Run by pg_cron every minute, so a
-- game ends and is settled even when nobody is looking at it.
create or replace function encheres.sweep_games()
returns integer language plpgsql set search_path = '' as $$
declare
  v_code text;
  v_count integer := 0;
begin
  for v_code in
    select code from encheres.rooms
     where matched and status = 'playing' and updated_at < now() - interval '5 seconds'
     order by updated_at
     limit 500
  loop
    begin
      perform encheres.enforce(v_code);
      perform encheres.bot_step(v_code);
      v_count := v_count + 1;
    exception when others then
      raise warning 'sweep_games %: %', v_code, sqlerrm;
    end;
  end loop;
  return v_count;
end;
$$;

create or replace function public.leaderboard(
  p_token text,
  p_scope text default 'overall',
  p_country text default null,
  p_friends boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope text := lower(btrim(coalesce(p_scope, 'overall')));
  v_country text := nullif(upper(btrim(coalesce(p_country, ''))), '');
  v_me uuid;
  v_rows jsonb;
  v_total integer;
  v_mine jsonb;
  v_around jsonb;
begin
  if v_scope = 'all' then
    v_scope := 'overall';
  end if;
  if (v_scope not in ('overall', 'week') and not encheres.is_mode(v_scope))
     or (v_country is not null and v_country !~ '^[A-Z]{2}$')
  then
    raise exception 'INVALID_INPUT';
  end if;
  if p_token is not null and char_length(p_token) between 16 and 128 then
    v_me := encheres.profile_id_of(encheres.token_hash(p_token));
  end if;
  -- The weekly table was replaced by the friends table; old clients get an empty one.
  if v_scope = 'week' then
    return jsonb_build_object('rows', '[]'::jsonb, 'total', 0, 'me', null);
  end if;
  perform encheres.roll_season();

  with entries as (
    select p.id, p.name, p.country, p.avatar, p.updated_at,
           case when v_scope = 'overall' then p.trophies else r.trophies end as value
      from encheres.profiles p
      left join encheres.ratings r on r.profile = p.id and r.mode = v_scope
     where case when v_scope = 'overall' then p.season_games > 0 else coalesce(r.season_games, 0) > 0 end
       and (v_country is null or p.country = v_country)
       and (not coalesce(p_friends, false) or p.id = v_me or encheres.are_friends(v_me, p.id))
  ),
  ranked as (
    select e.*, row_number() over (order by e.value desc, e.updated_at) as rank from entries e
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'rank', rank, 'name', name, 'country', country, 'avatar', avatar, 'value', value,
           'you', id = v_me) order by rank) filter (where rank <= encheres.leaderboard_size()), '[]'::jsonb),
         count(*),
         (jsonb_agg(jsonb_build_object('rank', rank, 'value', value)) filter (where id = v_me)) -> 0
    into v_rows, v_total, v_mine
    from ranked;

  -- Further down than the table goes: the player, with the one above and the
  -- one below.
  if (v_mine ->> 'rank')::integer > encheres.leaderboard_size() then
    with entries as (
      select p.id, p.name, p.country, p.avatar, p.updated_at,
             case when v_scope = 'overall' then p.trophies else r.trophies end as value
        from encheres.profiles p
        left join encheres.ratings r on r.profile = p.id and r.mode = v_scope
       where case when v_scope = 'overall' then p.season_games > 0 else coalesce(r.season_games, 0) > 0 end
         and (v_country is null or p.country = v_country)
         and (not coalesce(p_friends, false) or p.id = v_me or encheres.are_friends(v_me, p.id))
    ),
    ranked as (
      select e.*, row_number() over (order by e.value desc, e.updated_at) as rank from entries e
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'rank', rank, 'name', name, 'country', country, 'avatar', avatar, 'value', value,
             'you', id = v_me) order by rank), '[]'::jsonb)
      into v_around
      from ranked
     where rank between (v_mine ->> 'rank')::integer - 1 and (v_mine ->> 'rank')::integer + 1;
  end if;

  return jsonb_build_object('rows', v_rows, 'total', v_total, 'me', v_mine,
                            'around', coalesce(v_around, '[]'::jsonb));
end;
$$;

-- As in 0002. A player who cannot buy any more has finished: leaving is not
-- giving up, and the match is played out without them.
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
    if encheres.can_buy(v_code, v_seat) then
      perform encheres.end_by_forfeit(v_code, v_seat);
    else
      perform encheres.bot_step(v_code);
    end if;
  end if;
  return encheres.room_view(v_code, v_seat);
end;
$$;

revoke all on all functions in schema encheres from public;

-- ---------------------------------------------------------------------------
-- The minute sweep (Supabase has pg_cron; local test databases do not)
-- ---------------------------------------------------------------------------

do $outer$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('encheres-sweep', '* * * * *', 'select encheres.sweep_games()');
  end if;
exception when others then
  raise notice 'pg_cron not scheduled: %', sqlerrm;
end;
$outer$;

notify pgrst, 'reload schema';
