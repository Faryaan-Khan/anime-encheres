-- Enchères Animés — ranked modes, seasons and friends
--
-- Run after 0005 (and after re-running 0004, which now records each card's
-- universe). Idempotent.
--
-- Modes. A quick match is played in one mode: one universe, or `mix` for all
-- of them together. Each mode has its own queue, its own trophies and its own
-- leaderboard. The server deals from its own list of the mode's cards.
--
-- Overall score. A weighted average of a player's trophies in every mode, with
-- `mix` counting double because it asks for knowledge of every series. It is
-- kept in profiles.trophies, so the world ranking is the ranking of that score.
--
-- Seasons. On the first of each month, every rating above the Legend league
-- entrance is brought back to it.
--
-- Friends. Players add each other with a tag, see a leaderboard of their
-- friends, and invite them to private rooms. The weekly leaderboard is gone.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

alter table encheres.characters add column if not exists universe text;
create index if not exists characters_universe_idx on encheres.characters (universe);

-- Trophies of one player in one mode.
create table if not exists encheres.ratings (
  profile  uuid not null references encheres.profiles (id) on delete cascade,
  mode     text not null,
  trophies integer not null default 0 check (trophies >= 0),
  best     integer not null default 0,
  games    integer not null default 0,
  wins     integer not null default 0,
  primary key (profile, mode)
);
create index if not exists ratings_mode_idx on encheres.ratings (mode, trophies desc);

alter table encheres.rooms add column if not exists mode text;
alter table encheres.matches add column if not exists mode text;

-- A short public name for adding a player as a friend.
alter table encheres.profiles add column if not exists tag text;
create unique index if not exists profiles_tag_idx on encheres.profiles (tag) where tag is not null;

-- `requester` asked `addressee`; they are friends once it is accepted.
create table if not exists encheres.friends (
  requester  uuid not null references encheres.profiles (id) on delete cascade,
  addressee  uuid not null references encheres.profiles (id) on delete cascade,
  accepted   boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (requester, addressee),
  check (requester <> addressee)
);
create index if not exists friends_addressee_idx on encheres.friends (addressee);

-- An invitation to a private room that is still waiting for its second player.
create table if not exists encheres.invites (
  room_code    text not null references encheres.rooms (code) on delete cascade,
  to_profile   uuid not null references encheres.profiles (id) on delete cascade,
  from_profile uuid not null references encheres.profiles (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (room_code, to_profile)
);
create index if not exists invites_to_idx on encheres.invites (to_profile);

alter table encheres.ratings enable row level security;
alter table encheres.friends enable row level security;
alter table encheres.invites enable row level security;
revoke all on all tables in schema encheres from public;

-- ---------------------------------------------------------------------------
-- Modes
-- ---------------------------------------------------------------------------

create or replace function encheres.is_mode(p_mode text)
returns boolean language sql stable set search_path = '' as $$
  select p_mode = 'mix' or exists (select 1 from encheres.characters c where c.universe = p_mode);
$$;

-- `mix` counts double in the overall score: it is the hardest mode.
create or replace function encheres.mode_weight(p_mode text)
returns integer language sql immutable set search_path = '' as $$
  select case when p_mode = 'mix' then 2 else 1 end;
$$;

-- Sum of the weights of every mode: one per universe, plus `mix`.
create or replace function encheres.total_weight()
returns integer language sql stable set search_path = '' as $$
  select (select count(distinct c.universe) from encheres.characters c where c.universe is not null)::integer
         + encheres.mode_weight('mix');
$$;

-- The cards of a mode, or null if the server has no card list.
create or replace function encheres.mode_pool(p_mode text)
returns text[] language sql stable set search_path = '' as $$
  select array_agg(c.id order by c.id)
    from encheres.characters c
   where p_mode = 'mix' or c.universe = p_mode;
$$;

-- The mode a search is for. Clients from before modes existed send a pool
-- instead: one universe means that universe, anything else means `mix`.
create or replace function encheres.resolve_mode(p_mode text, p_pool text[])
returns text language plpgsql stable set search_path = '' as $$
declare
  v_mode text := nullif(lower(btrim(coalesce(p_mode, ''))), '');
begin
  if v_mode is null then
    select case when count(distinct c.universe) = 1 then min(c.universe) else 'mix' end
      into v_mode
      from unnest(p_pool) as x (id)
      join encheres.characters c on c.id = x.id;
    v_mode := coalesce(v_mode, 'mix');
  end if;
  if not encheres.is_mode(v_mode) then
    raise exception 'INVALID_INPUT';
  end if;
  return v_mode;
end;
$$;

create or replace function encheres.mode_trophies(p_profile uuid, p_mode text)
returns integer language sql stable set search_path = '' as $$
  select coalesce(
    (select r.trophies from encheres.ratings r where r.profile = p_profile and r.mode = p_mode), 0);
$$;

-- The overall score: weighted average of the trophies in every mode. A mode
-- never played counts as zero, so the score rewards playing all of them.
create or replace function encheres.overall(p_profile uuid)
returns integer language sql stable set search_path = '' as $$
  select coalesce(round(sum(r.trophies * encheres.mode_weight(r.mode))::numeric
                        / encheres.total_weight()), 0)::integer
    from encheres.ratings r
   where r.profile = p_profile and encheres.is_mode(r.mode);
$$;

-- Trophies needed to enter the Legend league; seasons reset down to this.
create or replace function encheres.legend_floor()
returns integer language sql immutable set search_path = '' as $$ select 2200; $$;

-- Starts a new season when the month has changed: every rating above the
-- Legend entrance goes back to it. Runs once, whoever calls first.
create or replace function encheres.roll_season()
returns void language plpgsql set search_path = '' as $$
declare
  v_now jsonb := to_jsonb(to_char(now() at time zone 'utc', 'YYYY-MM'));
  v_stored jsonb;
  v_players uuid[];
begin
  if encheres.setting('season') = v_now then
    return;
  end if;
  perform pg_advisory_xact_lock(hashtext('encheres.season'));
  v_stored := encheres.setting('season');
  if v_stored = v_now then
    return;
  end if;
  if v_stored is not null then
    -- Two statements: the overall score must be computed after the reset.
    with reset as (
      update encheres.ratings set trophies = encheres.legend_floor()
       where trophies > encheres.legend_floor()
      returning profile
    )
    select array_agg(distinct profile) into v_players from reset;
    update encheres.profiles p
       set trophies = encheres.overall(p.id)
     where p.id = any (v_players);
  end if;
  insert into encheres.config (key, value) values ('season', v_now)
  on conflict (key) do update set value = excluded.value;
end;
$$;

-- Applies one result to a player's rating in a mode and to their profile, and
-- returns their new trophies in that mode.
drop function if exists encheres.apply_result(uuid, text, integer, boolean);
create or replace function encheres.apply_result(
  p_profile uuid,
  p_mode text,
  p_outcome text,       -- 'win', 'loss' or 'tie'
  p_delta integer,      -- signed trophy change
  p_forfeited boolean   -- this player gave up or timed out
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_trophies integer;
  v_overall integer;
begin
  insert into encheres.ratings as existing (profile, mode, trophies, best, games, wins)
  values (p_profile, p_mode, greatest(0, p_delta), greatest(0, p_delta), 1, (p_outcome = 'win')::integer)
  on conflict (profile, mode) do update
    set trophies = greatest(0, existing.trophies + p_delta),
        best = greatest(existing.best, existing.trophies + p_delta),
        games = existing.games + 1,
        wins = existing.wins + (p_outcome = 'win')::integer
  returning trophies into v_trophies;

  v_overall := encheres.overall(p_profile);
  update encheres.profiles
     set trophies = v_overall,
         best_trophies = greatest(best_trophies, v_overall),
         games = games + 1,
         wins = wins + (p_outcome = 'win')::integer,
         losses = losses + (p_outcome = 'loss')::integer,
         ties = ties + (p_outcome = 'tie')::integer,
         forfeits = forfeits + coalesce(p_forfeited, false)::integer,
         streak = case when p_outcome = 'win' then streak + 1 else 0 end,
         best_streak = greatest(best_streak, case when p_outcome = 'win' then streak + 1 else 0 end),
         updated_at = now()
   where id = p_profile;
  return v_trophies;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------

create or replace function encheres.new_tag()
returns text language plpgsql volatile set search_path = '' as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_tag text;
begin
  loop
    select string_agg(substr(v_alphabet, 1 + floor(random() * 32)::integer, 1), '')
      into v_tag
      from generate_series(1, 7);
    exit when not exists (select 1 from encheres.profiles where tag = v_tag);
  end loop;
  return v_tag;
end;
$$;

-- As in 0005, and every profile gets a tag.
create or replace function encheres.profile_for(p_hash text, p_name text)
returns encheres.profiles
language plpgsql
set search_path = ''
as $$
declare
  p encheres.profiles;
  v_id uuid;
begin
  select d.profile into v_id from encheres.devices d where d.token_hash = p_hash;
  if v_id is not null then
    update encheres.profiles set name = coalesce(p_name, name) where id = v_id returning * into p;
  else
    insert into encheres.profiles as existing (token_hash, name)
    values (p_hash, coalesce(p_name, 'Player'))
    on conflict (token_hash) do update
      set name = coalesce(p_name, existing.name)
    returning * into p;
  end if;
  if p.tag is null then
    update encheres.profiles set tag = encheres.new_tag() where id = p.id returning * into p;
  end if;
  return p;
end;
$$;

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
  v_modes jsonb;
  v_peak integer;
begin
  select coalesce(jsonb_agg(item order by finished_at desc), '[]'::jsonb) into v_recent
    from (
      select m.finished_at,
             jsonb_build_object(
               'at', m.finished_at,
               'kind', m.kind,
               'mode', m.mode,
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

  select coalesce(jsonb_agg(jsonb_build_object(
           'mode', r.mode, 'trophies', r.trophies, 'best', r.best, 'games', r.games, 'wins', r.wins)
           order by r.mode), '[]'::jsonb),
         coalesce(max(r.best), 0)
    into v_modes, v_peak
    from encheres.ratings r
   where r.profile = p.id;

  return jsonb_build_object(
    'id', p.id,
    'tag', p.tag,
    'modes', v_modes,
    'peak', v_peak,
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
    'rank', v_rank,
    'players', v_players,
    'saved', p.user_id is not null,
    'hasCode', p.recovery_hash is not null,
    'recent', v_recent
  );
end;
$$;

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
  v_human smallint;
  fh encheres.profiles;
  v_delta integer;
  v_total integer;
  v_mode text;
begin
  select * into r from encheres.rooms where code = p_code;
  if not found or r.settled or r.status <> 'finished' then
    return;
  end if;
  v_mode := coalesce(r.mode, 'mix');
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

  if r.matched and r.bot_seat is not null then
    -- The computer has no profile and no trophies of its own: it counts as an
    -- opponent of the player's own rank.
    v_human := 1 - r.bot_seat;
    fh := encheres.profile_for(case when v_human = 0 then s0.token_hash else s1.token_hash end, null);
    -- Trophies are counted per mode: from here on, `trophies` is this mode's.
    fh.trophies := encheres.mode_trophies(fh.id, v_mode);
    v_delta := case
                 when v_winner is null then 0
                 when v_winner = v_human then encheres.win_gain(fh.trophies, fh.trophies)
                 else -least(fh.trophies, encheres.loss_cost(fh.trophies, fh.trophies))
               end;
    v_total := encheres.apply_result(
      fh.id, v_mode, case when v_winner is null then 'tie' when v_winner = v_human then 'win' else 'loss' end,
      v_delta, r.forfeit = v_human);
    if v_human = 0 then
      v_id0 := fh.id; v_delta0 := v_delta; v_total0 := v_total;
    else
      v_id1 := fh.id; v_delta1 := v_delta; v_total1 := v_total;
    end if;
  elsif r.matched then
    f0 := encheres.profile_for(s0.token_hash, null);
    f1 := encheres.profile_for(s1.token_hash, null);
    v_id0 := f0.id;
    v_id1 := f1.id;
    f0.trophies := encheres.mode_trophies(f0.id, v_mode);
    f1.trophies := encheres.mode_trophies(f1.id, v_mode);
    if v_winner = 0 then
      v_delta0 := encheres.win_gain(f0.trophies, f1.trophies);
      v_delta1 := -least(f1.trophies, encheres.loss_cost(f1.trophies, f0.trophies));
    elsif v_winner = 1 then
      v_delta1 := encheres.win_gain(f1.trophies, f0.trophies);
      v_delta0 := -least(f0.trophies, encheres.loss_cost(f0.trophies, f1.trophies));
    end if;
    v_total0 := encheres.apply_result(
      f0.id, v_mode, case when v_winner is null then 'tie' when v_winner = 0 then 'win' else 'loss' end,
      v_delta0, r.forfeit = 0);
    v_total1 := encheres.apply_result(
      f1.id, v_mode, case when v_winner is null then 'tie' when v_winner = 1 then 'win' else 'loss' end,
      v_delta1, r.forfeit = 1);
  else
    -- Private rooms are recorded but never move trophies.
    v_id0 := encheres.profile_id_of(s0.token_hash);
    v_id1 := encheres.profile_id_of(s1.token_hash);
  end if;

  insert into encheres.matches
    (kind, room_code, profile0, profile1, names, teams, powers, winner, forfeit, deltas, settings, history, log,
     opponent_skill, mode)
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
    r.history, r.log,
    r.bot_skill,
    case when r.matched then v_mode else null end
  );

  update encheres.rooms
     set settled = true,
         result = jsonb_build_object(
           'winner', v_winner,
           'mode', case when r.matched then v_mode else null end,
           'power', jsonb_build_array(round(v_power0::numeric, 1), round(v_power1::numeric, 1)),
           'deltas', case when r.matched then jsonb_build_array(v_delta0, v_delta1) else null end,
           'trophies', case when r.matched then jsonb_build_array(v_total0, v_total1) else null end
         )
   where code = p_code;
end;
$$;

-- ---------------------------------------------------------------------------
-- Friends
-- ---------------------------------------------------------------------------

create or replace function encheres.are_friends(p_a uuid, p_b uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1 from encheres.friends f
     where f.accepted
       and ((f.requester = p_a and f.addressee = p_b) or (f.requester = p_b and f.addressee = p_a))
  );
$$;

create or replace function encheres.person_json(p encheres.profiles)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'name', p.name, 'avatar', p.avatar, 'country', p.country,
                            'trophies', p.trophies, 'tag', p.tag);
$$;

-- Everything the friends screen shows for one player.
create or replace function encheres.friends_json(p_me uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'tag', (select tag from encheres.profiles where id = p_me),
    'friends', coalesce((
      select jsonb_agg(encheres.person_json(p) order by p.trophies desc, p.name)
        from encheres.friends f
        join encheres.profiles p
          on p.id = case when f.requester = p_me then f.addressee else f.requester end
       where f.accepted and (f.requester = p_me or f.addressee = p_me)), '[]'::jsonb),
    'incoming', coalesce((
      select jsonb_agg(encheres.person_json(p) order by f.created_at)
        from encheres.friends f
        join encheres.profiles p on p.id = f.requester
       where not f.accepted and f.addressee = p_me), '[]'::jsonb),
    'outgoing', coalesce((
      select jsonb_agg(encheres.person_json(p) order by f.created_at)
        from encheres.friends f
        join encheres.profiles p on p.id = f.addressee
       where not f.accepted and f.requester = p_me), '[]'::jsonb),
    'invites', coalesce((
      select jsonb_agg(jsonb_build_object('code', i.room_code, 'from', p.name, 'avatar', p.avatar)
                       order by i.created_at desc)
        from encheres.invites i
        join encheres.rooms r on r.code = i.room_code
        join encheres.profiles p on p.id = i.from_profile
       where i.to_profile = p_me
         and r.status = 'lobby' and not r.matched
         and i.created_at > now() - interval '30 minutes'
         and (select count(*) from encheres.room_players q where q.room_code = r.code) < 2), '[]'::jsonb)
  );
$$;

create or replace function public.get_friends(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p encheres.profiles;
begin
  if p_token is null or char_length(p_token) < 16 or char_length(p_token) > 128 then
    raise exception 'INVALID_INPUT';
  end if;
  perform encheres.hit('friends-ip:' || encheres.client_key(), 2000, interval '1 hour');
  p := encheres.profile_for(encheres.token_hash(p_token), null);
  return encheres.friends_json(p.id);
end;
$$;

-- Asks the player with this tag to be friends, or accepts if they asked first.
-- The outcome is in `status`: sent, accepted, already, unknown, self or full.
-- These are not errors on purpose, so that every attempt is counted.
create or replace function public.add_friend(p_token text, p_tag text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_tag text := upper(regexp_replace(coalesce(p_tag, ''), '[^A-Za-z0-9]', '', 'g'));
  me encheres.profiles;
  v_other uuid;
  v_status text;
begin
  if p_token is null or char_length(p_token) < 16 or char_length(p_token) > 128 then
    raise exception 'INVALID_INPUT';
  end if;
  v_hash := encheres.token_hash(p_token);
  perform encheres.hit('friend:' || v_hash, 40, interval '1 day');
  me := encheres.profile_for(v_hash, null);
  select id into v_other from encheres.profiles where tag = v_tag;

  if v_other is null then
    v_status := 'unknown';
  elsif v_other = me.id then
    v_status := 'self';
  elsif encheres.are_friends(me.id, v_other) then
    v_status := 'already';
  elsif exists (select 1 from encheres.friends where requester = v_other and addressee = me.id) then
    update encheres.friends set accepted = true where requester = v_other and addressee = me.id;
    v_status := 'accepted';
  elsif (select count(*) from encheres.friends where requester = me.id or addressee = me.id) >= 100 then
    v_status := 'full';
  else
    insert into encheres.friends (requester, addressee) values (me.id, v_other)
    on conflict do nothing;
    v_status := 'sent';
  end if;
  return encheres.friends_json(me.id) || jsonb_build_object('status', v_status);
end;
$$;

-- Accepts or declines a request received from `p_friend`.
create or replace function public.answer_friend(p_token text, p_friend uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me encheres.profiles;
begin
  if p_token is null or char_length(p_token) < 16 or char_length(p_token) > 128 or p_friend is null then
    raise exception 'INVALID_INPUT';
  end if;
  me := encheres.profile_for(encheres.token_hash(p_token), null);
  if coalesce(p_accept, false) then
    update encheres.friends set accepted = true where requester = p_friend and addressee = me.id;
  else
    delete from encheres.friends where requester = p_friend and addressee = me.id and not accepted;
  end if;
  return encheres.friends_json(me.id);
end;
$$;

-- Ends a friendship, or withdraws a request, in either direction.
create or replace function public.remove_friend(p_token text, p_friend uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me encheres.profiles;
begin
  if p_token is null or char_length(p_token) < 16 or char_length(p_token) > 128 or p_friend is null then
    raise exception 'INVALID_INPUT';
  end if;
  me := encheres.profile_for(encheres.token_hash(p_token), null);
  delete from encheres.friends
   where (requester = me.id and addressee = p_friend) or (requester = p_friend and addressee = me.id);
  delete from encheres.invites
   where (from_profile = me.id and to_profile = p_friend) or (from_profile = p_friend and to_profile = me.id);
  return encheres.friends_json(me.id);
end;
$$;

-- Invites a friend to the private room the caller is waiting in.
create or replace function public.invite_friend(p_token text, p_code text, p_friend uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_hash text;
  me encheres.profiles;
  r encheres.rooms;
begin
  if p_token is null or char_length(p_token) < 16 or char_length(p_token) > 128 or p_friend is null then
    raise exception 'INVALID_INPUT';
  end if;
  v_hash := encheres.token_hash(p_token);
  select * into r from encheres.rooms where code = v_code;
  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  if encheres.seat_of(v_code, p_token) is null then
    raise exception 'NOT_IN_ROOM';
  end if;
  me := encheres.profile_for(v_hash, null);
  if r.matched or r.status <> 'lobby' or not encheres.are_friends(me.id, p_friend) then
    raise exception 'NOT_ALLOWED';
  end if;
  perform encheres.hit('invite:' || v_hash, 60, interval '1 hour');
  insert into encheres.invites (room_code, to_profile, from_profile) values (v_code, p_friend, me.id)
  on conflict (room_code, to_profile) do update set created_at = now(), from_profile = excluded.from_profile;
  return true;
end;
$$;

-- Declines an invitation.
create or replace function public.dismiss_invite(p_token text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me encheres.profiles;
begin
  if p_token is null or char_length(p_token) < 16 or char_length(p_token) > 128 then
    raise exception 'INVALID_INPUT';
  end if;
  me := encheres.profile_for(encheres.token_hash(p_token), null);
  delete from encheres.invites where room_code = upper(btrim(coalesce(p_code, ''))) and to_profile = me.id;
  return encheres.friends_json(me.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Public API: matchmaking, profile, leaderboards
-- ---------------------------------------------------------------------------

drop function if exists public.find_match(text, text, integer, integer, integer, integer, text[], text);
create or replace function public.find_match(
  p_token text,
  p_name text,
  p_budget integer,
  p_team_size integer,
  p_min_bid integer,
  p_increment integer,
  p_pool text[],
  p_code text default null,
  p_mode text default null
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
  v_mode text;
  v_trophies integer;
begin
  if p_token is null or char_length(p_token) < 16 or char_length(p_token) > 128 then
    raise exception 'INVALID_INPUT';
  end if;
  v_hash := encheres.token_hash(p_token);

  -- One pairing at a time, so two callers can never both take the same seat.
  perform pg_advisory_xact_lock(hashtext('encheres.find_match'));

  -- Quick matches are ranked: every player has a profile.
  v_me := encheres.profile_for(v_hash, v_name);
  perform encheres.roll_season();

  -- A game against the computer that this player walked away from is lost.
  perform encheres.sweep_abandoned(v_hash);

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

  -- Each mode has its own queue and its own trophies. A player who is already
  -- waiting stays in the mode of their room.
  if v_mine.code is not null then
    v_mode := coalesce(v_mine.mode, 'mix');
  else
    v_mode := encheres.resolve_mode(p_mode, p_pool);
  end if;
  v_trophies := encheres.mode_trophies(v_me.id, v_mode);

  -- The waiting player closest in trophies who is still polling. The gap that
  -- is acceptable grows with the time either player has waited, so a close
  -- match is preferred but nobody waits forever.
  select r.code into v_other
    from encheres.rooms r
    join encheres.room_players p on p.room_code = r.code and p.seat = 0
    left join encheres.profiles hp on hp.id = encheres.profile_id_of(p.token_hash)
   where r.matched
     and coalesce(r.mode, 'mix') = v_mode
     and abs(encheres.mode_trophies(hp.id, v_mode) - v_trophies)
         <= 150 + 40 * greatest(v_waited, extract(epoch from (now() - r.created_at)))
     and r.status = 'lobby'
     and r.seen_at > now() - interval '12 seconds'
     and p.token_hash <> v_hash
     and hp.id is distinct from v_me.id
     and (v_mine.code is null or (r.created_at, r.code) < (v_mine.created_at, v_mine.code))
     and (select count(*) from encheres.room_players q where q.room_code = r.code) = 1
   order by abs(encheres.mode_trophies(hp.id, v_mode) - v_trophies), r.created_at, r.code
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
    -- Nobody turned up in time: the computer takes the other seat.
    if encheres.opponent_due(v_mine.code, v_waited) then
      perform encheres.seat_opponent(v_mine.code, v_trophies, v_name);
    end if;
    return encheres.room_view(v_mine.code, 0::smallint);
  end if;

  -- Nobody is waiting: wait as the host of a new room. The server deals from
  -- its own list of the mode's cards, whatever the client sent.
  p_pool := coalesce(encheres.mode_pool(v_mode), p_pool);
  v_pool_size := coalesce(array_length(p_pool, 1), 0);
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

  insert into encheres.rooms (code, budget, team_size, min_bid, increment, pool, matched, mode)
  values (v_code, p_budget, p_team_size, p_min_bid, p_increment, p_pool, true, v_mode);

  insert into encheres.room_players (room_code, seat, token_hash, name, budget)
  values (v_code, 0, v_hash, v_name, p_budget);

  return encheres.room_view(v_code, 0::smallint);
end;
$$;

create or replace function public.get_profile(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
begin
  if p_token is null or char_length(p_token) < 16 or char_length(p_token) > 128 then
    raise exception 'INVALID_INPUT';
  end if;
  perform encheres.hit('profile-ip:' || encheres.client_key(), 600, interval '1 hour');
  v_hash := encheres.token_hash(p_token);
  perform encheres.sweep_abandoned(v_hash);
  perform encheres.roll_season();
  return encheres.profile_json(encheres.profile_for(v_hash, null));
end;
$$;

-- Top 50 and the caller's own position. `p_scope` is `overall` for the overall
-- score or a mode for that mode's trophies. Optionally only one country, or
-- only the caller and their friends.
drop function if exists public.leaderboard(text, text, text);
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
     where case when v_scope = 'overall' then p.games > 0 else coalesce(r.games, 0) > 0 end
       and (v_country is null or p.country = v_country)
       and (not coalesce(p_friends, false) or p.id = v_me or encheres.are_friends(v_me, p.id))
  ),
  ranked as (
    select e.*, row_number() over (order by e.value desc, e.updated_at) as rank from entries e
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'rank', rank, 'name', name, 'country', country, 'avatar', avatar, 'value', value,
           'you', id = v_me) order by rank) filter (where rank <= 50), '[]'::jsonb),
         count(*),
         (jsonb_agg(jsonb_build_object('rank', rank, 'value', value)) filter (where id = v_me)) -> 0
    into v_rows, v_total, v_mine
    from ranked;

  return jsonb_build_object('rows', v_rows, 'total', v_total, 'me', v_mine);
end;
$$;

-- ---------------------------------------------------------------------------
-- Existing players: their trophies so far go to the mode they played last
-- ---------------------------------------------------------------------------

do $$
begin
  if encheres.setting('modes_migrated') is null then
    insert into encheres.ratings (profile, mode, trophies, best, games, wins)
    select p.id,
           coalesce((
             select c.universe
               from encheres.matches m
               cross join lateral jsonb_array_elements_text(m.teams -> 0) as card (id)
               join encheres.characters c on c.id = card.id
              where (m.profile0 = p.id or m.profile1 = p.id) and m.kind = 'ranked' and c.universe is not null
              order by m.finished_at desc
              limit 1), 'mix'),
           p.trophies, p.best_trophies, p.games, p.wins
      from encheres.profiles p
     where p.games > 0
       and not exists (select 1 from encheres.ratings r where r.profile = p.id);
    update encheres.profiles p
       set trophies = encheres.overall(p.id), best_trophies = encheres.overall(p.id)
     where exists (select 1 from encheres.ratings r where r.profile = p.id);
    update encheres.profiles set tag = encheres.new_tag() where tag is null;
    insert into encheres.config (key, value) values ('modes_migrated', 'true')
    on conflict (key) do nothing;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

revoke all on all functions in schema encheres from public;

revoke all on function public.find_match(text, text, integer, integer, integer, integer, text[], text, text) from public;
revoke all on function public.get_profile(text) from public;
revoke all on function public.leaderboard(text, text, text, boolean) from public;
revoke all on function public.get_friends(text) from public;
revoke all on function public.add_friend(text, text) from public;
revoke all on function public.answer_friend(text, uuid, boolean) from public;
revoke all on function public.remove_friend(text, uuid) from public;
revoke all on function public.invite_friend(text, text, uuid) from public;
revoke all on function public.dismiss_invite(text, text) from public;

grant execute on function public.find_match(text, text, integer, integer, integer, integer, text[], text, text) to anon, authenticated;
grant execute on function public.get_profile(text) to anon, authenticated;
grant execute on function public.leaderboard(text, text, text, boolean) to anon, authenticated;
grant execute on function public.get_friends(text) to anon, authenticated;
grant execute on function public.add_friend(text, text) to anon, authenticated;
grant execute on function public.answer_friend(text, uuid, boolean) to anon, authenticated;
grant execute on function public.remove_friend(text, uuid) to anon, authenticated;
grant execute on function public.invite_friend(text, text, uuid) to anon, authenticated;
grant execute on function public.dismiss_invite(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
