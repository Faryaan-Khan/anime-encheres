-- Enchères Animés — monthly seasons from zero, season history, rights requests
--
-- Run after 0006. Idempotent.
--
-- Seasons. On the first of each month every player's trophies go back to 0 in
-- every mode, and the overall score with them. Before that, each player's
-- result for the month (final trophies, best of the month and final rank) is
-- kept in season_results, per mode and overall, so that the profile can show
-- records and past seasons. All-time bests are never reset.
--
-- Leaderboards and world rank count the players of the current season only.
--
-- Feedback gains a "rights" category for rights holders.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

alter table encheres.ratings add column if not exists season_best integer not null default 0;
alter table encheres.ratings add column if not exists season_games integer not null default 0;
alter table encheres.profiles add column if not exists season_best integer not null default 0;
alter table encheres.profiles add column if not exists season_games integer not null default 0;

-- One row per player, season and mode; `mode` is 'overall' for the overall score.
create table if not exists encheres.season_results (
  profile  uuid not null references encheres.profiles (id) on delete cascade,
  season   text not null check (season ~ '^\d{4}-\d{2}$'),
  mode     text not null,
  trophies integer not null,   -- at the end of the season
  best     integer not null,   -- highest during the season
  rank     integer not null,   -- final rank among the season's players in that mode
  players  integer not null,   -- how many played that mode that season
  primary key (profile, season, mode)
);
create index if not exists season_results_profile_idx on encheres.season_results (profile, season desc);

alter table encheres.season_results enable row level security;
revoke all on all tables in schema encheres from public;

alter table encheres.feedback drop constraint if exists feedback_category_check;
alter table encheres.feedback add constraint feedback_category_check
  check (category in ('idea', 'bug', 'ratings', 'rights', 'other'));

-- ---------------------------------------------------------------------------
-- Seasons
-- ---------------------------------------------------------------------------

-- Files the results of the season that is ending and starts the next one from
-- zero. Runs once, whoever calls first in the new month.
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

    update encheres.ratings
       set trophies = 0, season_best = 0, season_games = 0
     where trophies <> 0 or season_best <> 0 or season_games <> 0;
    update encheres.profiles
       set trophies = 0, season_best = 0, season_games = 0
     where trophies <> 0 or season_best <> 0 or season_games <> 0;
  end if;

  insert into encheres.config (key, value) values ('season', v_now)
  on conflict (key) do update set value = excluded.value;
end;
$$;

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
  insert into encheres.ratings as existing
    (profile, mode, trophies, best, games, wins, season_best, season_games)
  values (p_profile, p_mode, greatest(0, p_delta), greatest(0, p_delta), 1, (p_outcome = 'win')::integer,
          greatest(0, p_delta), 1)
  on conflict (profile, mode) do update
    set trophies = greatest(0, existing.trophies + p_delta),
        best = greatest(existing.best, existing.trophies + p_delta),
        games = existing.games + 1,
        wins = existing.wins + (p_outcome = 'win')::integer,
        season_best = greatest(existing.season_best, existing.trophies + p_delta),
        season_games = existing.season_games + 1
  returning trophies into v_trophies;

  v_overall := encheres.overall(p_profile);
  update encheres.profiles
     set trophies = v_overall,
         best_trophies = greatest(best_trophies, v_overall),
         season_best = greatest(season_best, v_overall),
         season_games = season_games + 1,
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
     where case when v_scope = 'overall' then p.season_games > 0 else coalesce(r.season_games, 0) > 0 end
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
     or p_category is null or p_category not in ('idea', 'bug', 'ratings', 'rights', 'other')
     or char_length(v_message) < 5 or char_length(v_message) > 1000
     or char_length(coalesce(v_contact, '')) > 120
  then
    raise exception 'INVALID_INPUT';
  end if;
  v_hash := encheres.token_hash(p_token);
  perform encheres.hit('feedback:' || v_hash, 5, interval '1 day');
  perform encheres.hit('feedback-ip:' || encheres.client_key(), 20, interval '1 day');

  insert into encheres.feedback (profile, category, message, contact, lang)
  values (encheres.profile_id_of(v_hash),
          p_category, v_message, v_contact, left(coalesce(p_lang, ''), 5));
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Players already in this season keep their place
-- ---------------------------------------------------------------------------

do $$
begin
  if encheres.setting('seasons_from_zero') is null then
    update encheres.ratings set season_games = games, season_best = trophies where season_games = 0;
    update encheres.profiles set season_games = games, season_best = trophies where season_games = 0;
    insert into encheres.config (key, value) values ('seasons_from_zero', 'true')
    on conflict (key) do nothing;
  end if;
end;
$$;

revoke all on all functions in schema encheres from public;

notify pgrst, 'reload schema';
