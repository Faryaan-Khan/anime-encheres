-- Enchères Animés — public rooms.
--
-- A public room is a private room that anyone online can see in a list and
-- join, with the settings its host chose (universe, budget, team size). Like
-- every room it is played for fun: no trophies move.
--
-- Safe to run twice.

alter table encheres.rooms add column if not exists public boolean not null default false;
-- The universe a room deals from (a universe id or 'mix'), shown in the list.
alter table encheres.rooms add column if not exists verse text;

create index if not exists rooms_public_lobby on encheres.rooms (updated_at desc)
  where public and status = 'lobby';

-- Old signature: replaced by one with two optional parameters, so that clients
-- still open in browsers keep working (PostgREST must see a single function).
drop function if exists public.create_room(text, text, integer, integer, integer, integer, text[]);

create or replace function public.create_room(
  p_token text,
  p_name text,
  p_budget integer,
  p_team_size integer,
  p_min_bid integer,
  p_increment integer,
  p_pool text[],
  p_public boolean default false,
  p_verse text default null
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
     or (v_verse is not null and v_verse !~ '^[a-z0-9-]{1,32}$')
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

  insert into encheres.rooms (code, budget, team_size, min_bid, increment, pool, public, verse)
  values (v_code, p_budget, p_team_size, p_min_bid, p_increment, p_pool,
          coalesce(p_public, false), v_verse);

  insert into encheres.room_players (room_code, seat, token_hash, name, budget)
  values (v_code, 0, encheres.token_hash(p_token), v_name, p_budget);

  return encheres.room_view(v_code, 0::smallint);
end;
$$;

-- The public rooms waiting for players: open (in the lobby, not full) and with
-- a host heard from in the last minute, newest first. Each room's waiting
-- screen polls get_room, which keeps the host's presence fresh.
create or replace function public.public_rooms(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_rooms jsonb;
begin
  if p_token is null or char_length(p_token) < 16 or char_length(p_token) > 128 then
    raise exception 'INVALID_INPUT';
  end if;
  perform encheres.hit('public:' || encheres.client_key(), 600, interval '1 hour');
  v_hash := encheres.token_hash(p_token);

  select coalesce(jsonb_agg(x.room order by x.at desc), '[]'::jsonb)
    into v_rooms
    from (
      select r.updated_at as at,
             jsonb_build_object(
               'code', r.code,
               'host', h.name,
               'verse', coalesce(r.verse, encheres.scale_of(r.pool)),
               'budget', r.budget,
               'teamSize', r.team_size,
               'players', (select count(*) from encheres.room_players p where p.room_code = r.code),
               'seats', 2,
               'mine', h.token_hash = v_hash
             ) as room
        from encheres.rooms r
        join encheres.room_players h on h.room_code = r.code and h.seat = 0
       where r.public
         and r.status = 'lobby'
         and not r.matched
         and h.seen_at > now() - interval '1 minute'
         and (select count(*) from encheres.room_players p where p.room_code = r.code) < 2
       order by r.updated_at desc
       limit 50
    ) as x;

  return v_rooms;
end;
$$;

-- room_view, as in 0012, plus 'public' and 'verse', and each player's tag and
-- picture in public rooms.
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
               'team', to_jsonb(p.team),
               'passes', p.passes
             )
             -- Public rooms are a way to meet players: each one's friend tag
             -- and picture, so others can add them. Never in other rooms.
             || case when r.public then jsonb_build_object('tag', pr.tag, 'avatar', pr.avatar)
                     else '{}'::jsonb end
             order by p.seat
           ),
           '[]'::jsonb
         )
    into v_players
    from encheres.room_players p
    -- A profile is reached through a linked device, or is the device's own.
    left join lateral (
      select x.tag, x.avatar
        from encheres.profiles x
       where r.public
         and x.id = coalesce((select d.profile from encheres.devices d where d.token_hash = p.token_hash),
                             (select y.id from encheres.profiles y where y.token_hash = p.token_hash))
    ) pr on true
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
      'passLimit', r.pass_limit,
      'poolSize', coalesce(array_length(r.pool, 1), 0)
    ),
    'scale', coalesce(r.scale, encheres.scale_of(r.pool)),
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
    'public', r.public,
    'verse', coalesce(r.verse, encheres.scale_of(r.pool)),
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

revoke all on function public.create_room(text, text, integer, integer, integer, integer, text[], boolean, text) from public;
grant execute on function public.create_room(text, text, integer, integer, integer, integer, text[], boolean, text) to anon, authenticated;
revoke all on function public.public_rooms(text) from public;
grant execute on function public.public_rooms(text) to anon, authenticated;

revoke all on all functions in schema encheres from public;

notify pgrst, 'reload schema';
