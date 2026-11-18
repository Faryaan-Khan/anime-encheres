-- Enchères Animés — season brackets, name rules, character avatars, 8 s auto-bid
--
-- Run after 0013. Idempotent.
--
-- 1. Seasons no longer start from zero. On the first of the month every mode's
--    trophies drop to the floor of their bracket, so players stay with players
--    of their level and an idle account keeps sliding down month after month:
--      below 500 kept | 500-999 -> 500 | 1000-1499 -> 999 | 1500-1999 -> 1499 |
--      2000 and up -> 1999
--
-- 2. Names. Below 500 trophies (highest current mode) a name can change any
--    time; from 500, once every 30 days. The moment any mode reaches the Legend
--    league (2200) the name is locked for good, and the date is kept on the
--    profile (profiles.legend_at). Quick-match searches never fail over it: a
--    locked name is simply kept.
--
-- 3. Avatars are a character id (the card's picture, cropped to the face), or
--    '' for none. profiles.avatar becomes text; old numbers ('0'-'11', the
--    retired symbols) stay valid for clients that still send them.
--
-- 4. A player out of passes gets the minimum bid after 8 seconds (was 5).

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table encheres.profiles add column if not exists name_changed_at timestamptz;
alter table encheres.profiles add column if not exists legend_at timestamptz;

alter table encheres.profiles drop constraint if exists profiles_avatar_check;
alter table encheres.profiles alter column avatar drop default;
alter table encheres.profiles alter column avatar type text using avatar::text;
alter table encheres.profiles alter column avatar set default '';

-- ---------------------------------------------------------------------------
-- Limits
-- ---------------------------------------------------------------------------

create or replace function encheres.auto_bid_seconds()
returns integer language sql immutable set search_path = '' as $$ select 8; $$;

create or replace function encheres.legend_from()
returns integer language sql immutable set search_path = '' as $$ select 2200; $$;

create or replace function encheres.name_cooldown()
returns interval language sql immutable set search_path = '' as $$ select interval '30 days'; $$;

-- Same brackets as seasonFloor in src/ranking.ts.
create or replace function encheres.season_floor(p_trophies integer)
returns integer language sql immutable set search_path = '' as $$
  select case
           when p_trophies < 500 then p_trophies
           when p_trophies < 1000 then 500
           when p_trophies < 1500 then 999
           when p_trophies < 2000 then 1499
           else 1999
         end;
$$;

-- ---------------------------------------------------------------------------
-- Legend league: recorded once, for good
-- ---------------------------------------------------------------------------

create or replace function encheres.note_legend()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.trophies >= encheres.legend_from() then
    update encheres.profiles set legend_at = now() where id = new.profile and legend_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists ratings_legend on encheres.ratings;
create trigger ratings_legend after insert or update of trophies on encheres.ratings
for each row execute function encheres.note_legend();

-- Players who already got there.
update encheres.profiles p
   set legend_at = now()
 where p.legend_at is null
   and exists (select 1 from encheres.ratings r where r.profile = p.id and r.best >= encheres.legend_from());

-- ---------------------------------------------------------------------------
-- Names
-- ---------------------------------------------------------------------------

-- 'free', 'cooldown' (changed less than 30 days ago, from 500 trophies) or
-- 'locked' (reached the Legend league).
create or replace function encheres.name_state(p encheres.profiles)
returns text language sql stable set search_path = '' as $$
  select case
           when p.legend_at is not null then 'locked'
           when coalesce((select max(r.trophies) from encheres.ratings r where r.profile = p.id), 0) >= 500
                and p.name_changed_at > now() - encheres.name_cooldown() then 'cooldown'
           else 'free'
         end;
$$;

-- As in 0006, but a new name is only taken when the name rules allow it;
-- otherwise the profile keeps its name.
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
  if v_id is null then
    insert into encheres.profiles (token_hash, name)
    values (p_hash, coalesce(p_name, 'Player'))
    on conflict (token_hash) do nothing;
    select id into v_id from encheres.profiles where token_hash = p_hash;
  end if;
  select * into p from encheres.profiles where id = v_id for update;
  if p_name is not null and p_name <> p.name and encheres.name_state(p) = 'free' then
    update encheres.profiles set name = p_name, name_changed_at = now() where id = p.id returning * into p;
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
  v_history jsonb;
  v_best_rank integer;
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

  select count(*) into v_players from encheres.profiles where season_games > 0;
  if p.season_games > 0 then
    select count(*) + 1 into v_rank
      from encheres.profiles o
     where o.season_games > 0
       and (o.trophies > p.trophies or (o.trophies = p.trophies and o.updated_at < p.updated_at));
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'mode', r.mode, 'trophies', r.trophies, 'best', r.best, 'games', r.games, 'wins', r.wins,
           'seasonBest', r.season_best, 'seasonGames', r.season_games,
           'bestRank', (select min(h.rank) from encheres.season_results h
                         where h.profile = p.id and h.mode = r.mode))
           order by r.mode), '[]'::jsonb),
         coalesce(max(r.best), 0)
    into v_modes, v_peak
    from encheres.ratings r
   where r.profile = p.id;

  -- Finished seasons, newest first: the overall result and the best mode.
  select coalesce(jsonb_agg(item order by season desc), '[]'::jsonb) into v_history
    from (
      select h.season,
             jsonb_build_object(
               'season', h.season,
               'trophies', h.trophies,
               'best', h.best,
               'rank', h.rank,
               'players', h.players,
               'modes', (select coalesce(jsonb_agg(jsonb_build_object(
                                   'mode', m.mode, 'trophies', m.trophies, 'best', m.best, 'rank', m.rank)
                                   order by m.best desc), '[]'::jsonb)
                           from encheres.season_results m
                          where m.profile = p.id and m.season = h.season and m.mode <> 'overall')
             ) as item
        from encheres.season_results h
       where h.profile = p.id and h.mode = 'overall'
       order by h.season desc
       limit 12
    ) seasons;
  select min(h.rank) into v_best_rank from encheres.season_results h where h.profile = p.id;

  return jsonb_build_object(
    'id', p.id,
    'season', encheres.setting('season') #>> '{}',
    'seasonBest', p.season_best,
    'bestRank', v_best_rank,
    'history', v_history,
    'tag', p.tag,
    'modes', v_modes,
    'peak', v_peak,
    'name', p.name,
    'nameRule', encheres.name_state(p),
    'nameFreeAt', case when encheres.name_state(p) = 'cooldown'
                       then p.name_changed_at + encheres.name_cooldown() end,
    'legendAt', p.legend_at,
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

create or replace function encheres.roll_season()
returns void language plpgsql set search_path = '' as $$
declare
  v_now jsonb := to_jsonb(to_char(now() at time zone 'utc', 'YYYY-MM'));
  v_stored jsonb;
  v_season text;
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
    v_season := v_stored #>> '{}';

    insert into encheres.season_results (profile, season, mode, trophies, best, rank, players)
    select r.profile, v_season, r.mode, r.trophies, greatest(r.season_best, r.trophies),
           row_number() over (partition by r.mode order by r.trophies desc, r.season_best desc, r.profile),
           count(*) over (partition by r.mode)
      from encheres.ratings r
     where r.season_games > 0
    on conflict (profile, season, mode) do nothing;

    insert into encheres.season_results (profile, season, mode, trophies, best, rank, players)
    select p.id, v_season, 'overall', p.trophies, greatest(p.season_best, p.trophies),
           row_number() over (order by p.trophies desc, p.season_best desc, p.id),
           count(*) over ()
      from encheres.profiles p
     where p.season_games > 0
    on conflict (profile, season, mode) do nothing;

    -- Every mode drops to the floor of its bracket (see season_floor), then the
    -- overall score is worked out again from the new ratings. Two statements:
    -- a statement does not see its own writes.
    update encheres.ratings
       set trophies = encheres.season_floor(trophies),
           season_best = encheres.season_floor(trophies),
           season_games = 0
     where trophies <> encheres.season_floor(trophies) or season_best <> encheres.season_floor(trophies)
        or season_games <> 0;
    update encheres.profiles p
       set trophies = encheres.overall(p.id), season_best = encheres.overall(p.id), season_games = 0
     where p.trophies <> encheres.overall(p.id) or p.season_best <> encheres.overall(p.id) or p.season_games <> 0;
  end if;

  insert into encheres.config (key, value) values ('season', v_now)
  on conflict (key) do update set value = excluded.value;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profile edits: name rules and character avatars
-- ---------------------------------------------------------------------------

drop function if exists public.update_profile(text, text, text, integer);

create or replace function public.update_profile(
  p_token text,
  p_name text,
  p_country text,
  p_avatar text default null
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
  v_avatar text := btrim(coalesce(p_avatar, ''));
  p encheres.profiles;
begin
  if p_token is null or char_length(p_token) < 16 or char_length(p_token) > 128
     or (v_country is not null and v_country !~ '^[A-Z]{2}$')
     or not (v_avatar = ''
             or v_avatar ~ '^([0-9]|1[01])$'
             or exists (select 1 from encheres.characters c where c.id = v_avatar))
  then
    raise exception 'INVALID_INPUT';
  end if;
  v_hash := encheres.token_hash(p_token);
  perform encheres.hit('profile:' || v_hash, 60, interval '1 day');
  p := encheres.profile_for(v_hash, null);
  if v_name is not null and v_name <> p.name then
    if encheres.name_state(p) = 'locked' then
      raise exception 'NAME_LOCKED';
    elsif encheres.name_state(p) = 'cooldown' then
      raise exception 'NAME_COOLDOWN';
    end if;
    p := encheres.profile_for(v_hash, v_name);
  end if;
  update encheres.profiles
     set country = v_country, avatar = v_avatar
   where id = p.id
  returning * into p;
  return encheres.profile_json(p);
end;
$$;

revoke all on function public.update_profile(text, text, text, text) from public;
grant execute on function public.update_profile(text, text, text, text) to anon, authenticated;

revoke all on all functions in schema encheres from public;

notify pgrst, 'reload schema';
