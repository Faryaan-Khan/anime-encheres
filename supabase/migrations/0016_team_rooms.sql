-- Enchères Animés — 2v2 rooms.
--
-- A teams room is still an auction between two sides (seats 0 and 1): each
-- side has one budget and one roster. What changes is who plays: each side
-- has two members, and each round one member of each side faces the other.
-- The face-offs go through every pairing (A–A, A–B, B–A, B–B) in an order
-- shuffled again every four rounds. Both members of the drawing side see the
-- card; only the members facing off this round may draw, bid or pass.
--
-- The first member of each side is the side's row in room_players, as in any
-- room; the second sits in room_members. seat_of() knows both, so every
-- function that works per seat works for teams unchanged.
--
-- Also: non-hosts can leave a lobby (their place opens again), which public
-- rooms need so that a room is not kept full by people who left.
--
-- Safe to run twice.

alter table encheres.rooms add column if not exists format text not null default 'duel';
alter table encheres.rooms drop constraint if exists rooms_format_check;
alter table encheres.rooms add constraint rooms_format_check check (format in ('duel', 'teams', 'trio'));
-- Teams: the member of each side who plays each round, as [[m0, m1], ...];
-- round n uses entry (n - 1) modulo the length.
alter table encheres.rooms add column if not exists lineup jsonb;

create table if not exists encheres.room_members (
  room_code  text not null references encheres.rooms (code) on delete cascade,
  seat       smallint not null check (seat in (0, 1, 2)),
  member     smallint not null check (member between 1 and 3),
  token_hash text not null,
  name       text not null,
  seen_at    timestamptz not null default now(),
  primary key (room_code, seat, member),
  unique (room_code, token_hash)
);
alter table encheres.room_members enable row level security;
revoke all on encheres.room_members from public;

-- How many members a side has in a room of this format.
create or replace function encheres.side_size(p_format text)
returns smallint language sql immutable set search_path = '' as $$
  select case when p_format = 'teams' then 2 else 1 end::smallint;
$$;

-- How many sides a room of this format has.
create or replace function encheres.side_count(p_format text)
returns smallint language sql immutable set search_path = '' as $$
  select case when p_format = 'trio' then 3 else 2 end::smallint;
$$;

-- Players seated in a room, every member counted.
create or replace function encheres.headcount(p_code text)
returns integer language sql stable set search_path = '' as $$
  select (select count(*) from encheres.room_players where room_code = p_code)::integer
       + (select count(*) from encheres.room_members where room_code = p_code)::integer;
$$;

-- The side of a token in a room: as a side's first member or as a teammate.
create or replace function encheres.seat_of(p_code text, p_token text)
returns smallint
language sql
stable
set search_path = ''
as $$
  select seat from (
    select p.seat from encheres.room_players p
     where p.room_code = p_code and p.token_hash = encheres.token_hash(p_token)
    union all
    select m.seat from encheres.room_members m
     where m.room_code = p_code and m.token_hash = encheres.token_hash(p_token)
  ) as x
  limit 1;
$$;

-- 0 for a side's first member, 1.. for a teammate, null when not seated.
create or replace function encheres.member_of(p_code text, p_token text)
returns smallint
language sql
stable
set search_path = ''
as $$
  select member from (
    select 0::smallint as member from encheres.room_players p
     where p.room_code = p_code and p.token_hash = encheres.token_hash(p_token)
    union all
    select m.member from encheres.room_members m
     where m.room_code = p_code and m.token_hash = encheres.token_hash(p_token)
  ) as x
  limit 1;
$$;

-- The member of a side who plays the current round (always 0 outside teams).
create or replace function encheres.active_member(p_code text, p_seat smallint)
returns smallint
language sql
stable
set search_path = ''
as $$
  select coalesce(
           (select (r.lineup -> ((r.round - 1) % jsonb_array_length(r.lineup))::integer ->> p_seat::integer)::smallint
              from encheres.rooms r
             where r.code = p_code and r.format = 'teams'
               and r.lineup is not null and jsonb_array_length(r.lineup) > 0 and r.round >= 1),
           0::smallint);
$$;

-- Every face-off of two sides of p_size members, shuffled anew for each block,
-- enough blocks for p_rounds rounds.
create or replace function encheres.new_lineup(p_size integer, p_rounds integer)
returns jsonb
language sql
volatile
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_array(a, b) order by block, rnd), '[]'::jsonb)
    from (
      select block, a, b, random() as rnd
        from generate_series(0, greatest(0, ceil(p_rounds::numeric / (p_size * p_size))::integer - 1)) as block,
             generate_series(0, p_size - 1) as a,
             generate_series(0, p_size - 1) as b
    ) as x;
$$;

-- room_view as in 0015, plus 'format'; in teams rooms each side's members, the
-- members facing off this round ('active') and a side name of both members.
create or replace function encheres.room_view(p_code text, p_seat smallint)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  r encheres.rooms;
  v_players jsonb;
  v_members jsonb;
  v_teams jsonb := '{}'::jsonb;
begin
  select * into r from encheres.rooms where code = p_code;
  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'seat', p.seat,
               -- A side of two shows both names.
               'name', p.name || coalesce(
                 (select string_agg(' & ' || m.name, '' order by m.member)
                    from encheres.room_members m where m.room_code = p.room_code and m.seat = p.seat), ''),
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

  if r.format = 'teams' then
    -- Every member of each side, first members first.
    select coalesce(jsonb_agg(side order by seat), '[]'::jsonb)
      into v_members
      from (
        select x.seat, jsonb_agg(
                 jsonb_build_object('member', x.member, 'name', x.name)
                 || case when r.public then jsonb_build_object('tag', pr.tag, 'avatar', pr.avatar) else '{}'::jsonb end
                 order by x.member) as side
          from (
            select p.seat, 0::smallint as member, p.name, p.token_hash
              from encheres.room_players p where p.room_code = p_code
            union all
            select m.seat, m.member, m.name, m.token_hash
              from encheres.room_members m where m.room_code = p_code
          ) as x
          left join lateral (
            select y.tag, y.avatar
              from encheres.profiles y
             where y.id = coalesce((select d.profile from encheres.devices d where d.token_hash = x.token_hash),
                                   (select z.id from encheres.profiles z where z.token_hash = x.token_hash))
          ) pr on true
         group by x.seat
      ) as sides;
    v_teams := jsonb_build_object(
      'members', v_members,
      'active', case when r.status = 'playing' or r.status = 'finished'
                     then jsonb_build_array(encheres.active_member(p_code, 0::smallint),
                                            encheres.active_member(p_code, 1::smallint))
                end);
  end if;

  return v_teams || jsonb_build_object(
    'code', r.code,
    'format', r.format,
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


-- Old signature replaced by one with p_format (see 0015 for why).

drop function if exists public.create_room(text, text, integer, integer, integer, integer, text[], boolean, text);

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
     or v_pool_size < p_team_size * 2 or v_pool_size > 400
     or exists (select 1 from unnest(p_pool) as x where x is null or char_length(x) not between 1 and 64)
     or (select count(distinct x) from unnest(p_pool) as x) <> v_pool_size
     or (v_verse is not null and v_verse !~ '^[a-z0-9-]{1,32}$')
     or v_format not in ('duel', 'teams')
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

-- As in 0015, counting every member.
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
               'players', encheres.headcount(r.code),
               'seats', encheres.side_count(r.format) * encheres.side_size(r.format),
               'format', r.format,
               'mine', h.token_hash = v_hash
             ) as room
        from encheres.rooms r
        join encheres.room_players h on h.room_code = r.code and h.seat = 0
       where r.public
         and r.status = 'lobby'
         and not r.matched
         and h.seen_at > now() - interval '1 minute'
         and encheres.headcount(r.code) < encheres.side_count(r.format) * encheres.side_size(r.format)
       order by r.updated_at desc
       limit 50
    ) as x;

  return v_rooms;
end;
$$;


-- As in 0002. Joining takes the next free place. In a teams room the second player opens the
-- other side, then each side gets its second member.
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
  v_slot record;
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
    return encheres.room_view(v_code, v_seat)
           || jsonb_build_object('youMember', encheres.member_of(v_code, p_token));
  end if;

  -- Matched rooms are filled by find_match only, never by code.
  if r.matched then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  if r.status <> 'lobby' then
    raise exception 'GAME_ALREADY_STARTED';
  end if;

  select s.seat, s.member into v_slot
    from encheres.free_slots(v_code) as s
   order by s.member, s.seat
   limit 1;
  if not found then
    raise exception 'ROOM_FULL';
  end if;

  v_name := encheres.clean_name(p_name);
  perform encheres.take_slot(v_code, v_slot.seat, v_slot.member, encheres.token_hash(p_token), v_name);

  update encheres.rooms
     set version = version + 1, updated_at = now()
   where code = v_code;

  return encheres.room_view(v_code, v_slot.seat::smallint)
         || jsonb_build_object('youMember', v_slot.member);
end;
$$;

-- The empty places of a room: (side, member).
create or replace function encheres.free_slots(p_code text)
returns table (seat smallint, member smallint)
language sql
stable
set search_path = ''
as $$
  select s::smallint, m::smallint
    from encheres.rooms r,
         generate_series(0, encheres.side_count(r.format) - 1) as s,
         generate_series(0, encheres.side_size(r.format) - 1) as m
   where r.code = p_code
     and not exists (select 1 from encheres.room_players p where p.room_code = p_code and p.seat = s and m = 0)
     and not exists (select 1 from encheres.room_members x where x.room_code = p_code and x.seat = s and x.member = m)
     -- A side's second place opens once its first is taken.
     and (m = 0 or exists (select 1 from encheres.room_players p where p.room_code = p_code and p.seat = s));
$$;

create or replace function encheres.take_slot(p_code text, p_seat smallint, p_member smallint, p_hash text, p_name text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_member = 0 then
    insert into encheres.room_players (room_code, seat, token_hash, name, budget)
    select p_code, p_seat, p_hash, p_name, r.budget from encheres.rooms r where r.code = p_code;
  else
    insert into encheres.room_members (room_code, seat, member, token_hash, name)
    values (p_code, p_seat, p_member, p_hash, p_name);
  end if;
end;
$$;

-- Removes a player from their place in a lobby. A side's first member who
-- leaves is replaced by its second, so a side never has a hole at the front.
create or replace function encheres.free_place(p_code text, p_seat smallint, p_member smallint)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_next record;
begin
  if p_member > 0 then
    delete from encheres.room_members where room_code = p_code and seat = p_seat and member = p_member;
    return;
  end if;
  delete from encheres.room_players where room_code = p_code and seat = p_seat;
  select * into v_next from encheres.room_members
   where room_code = p_code and seat = p_seat order by member limit 1;
  if found then
    delete from encheres.room_members where room_code = p_code and seat = p_seat and member = v_next.member;
    perform encheres.take_slot(p_code, p_seat, 0::smallint, v_next.token_hash, v_next.name);
  end if;
end;
$$;

-- Teams lobby: moves the caller to the other side, if it has room.
create or replace function public.switch_side(p_code text, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r encheres.rooms;
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_seat smallint;
  v_member smallint;
  v_hash text := encheres.token_hash(p_token);
  v_name text;
  v_to smallint;
  v_slot smallint;
begin
  select * into r from encheres.rooms where code = v_code for update;
  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  v_seat := encheres.seat_of(v_code, p_token);
  v_member := encheres.member_of(v_code, p_token);
  if v_seat is null then
    raise exception 'NOT_IN_ROOM';
  end if;
  if r.status <> 'lobby' or r.format <> 'teams' then
    raise exception 'NOT_ALLOWED';
  end if;
  -- The host keeps their place: they start the game.
  if v_seat = 0 and v_member = 0 then
    raise exception 'HOST_ONLY';
  end if;
  v_to := 1 - v_seat;
  select case when not exists (select 1 from encheres.room_players where room_code = v_code and seat = v_to) then 0
              else (select min(m)::smallint from generate_series(1, encheres.side_size(r.format) - 1) as m
                     where not exists (select 1 from encheres.room_members
                                        where room_code = v_code and seat = v_to and member = m))
         end
    into v_slot;
  if v_slot is null then
    raise exception 'ROOM_FULL';
  end if;

  select name into v_name from (
    select name from encheres.room_players where room_code = v_code and token_hash = v_hash
    union all
    select name from encheres.room_members where room_code = v_code and token_hash = v_hash
  ) as x limit 1;
  perform encheres.free_place(v_code, v_seat, v_member);
  perform encheres.take_slot(v_code, v_to, v_slot, v_hash, v_name);

  update encheres.rooms set version = version + 1, updated_at = now() where code = v_code;
  return encheres.room_view(v_code, v_to) || jsonb_build_object('youMember', v_slot);
end;
$$;

-- Leaving a lobby. The host's room stays open (it drops out of the public list
-- once they are gone); anyone else gives up their place.
create or replace function public.leave_room(p_code text, p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r encheres.rooms;
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_seat smallint;
  v_member smallint;
begin
  select * into r from encheres.rooms where code = v_code for update;
  if not found or r.status <> 'lobby' or r.matched then
    return;
  end if;
  v_seat := encheres.seat_of(v_code, p_token);
  v_member := encheres.member_of(v_code, p_token);
  if v_seat is null or (v_seat = 0 and v_member = 0) then
    return;
  end if;
  perform encheres.free_place(v_code, v_seat, v_member);
  update encheres.rooms set version = version + 1, updated_at = now() where code = v_code;
end;
$$;

-- As in 0002, with teams: only the host starts, every place must be taken,
-- and the face-offs are drawn up.
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
  if v_seat <> 0 or encheres.member_of(v_code, p_token) <> 0 then
    raise exception 'HOST_ONLY';
  end if;
  if r.status = 'playing' then
    raise exception 'ALREADY_PLAYING';
  end if;
  if (select count(*) from encheres.room_players where room_code = v_code) < 2 then
    raise exception 'NEED_TWO_PLAYERS';
  end if;
  if exists (select 1 from encheres.free_slots(v_code)) then
    raise exception 'ROOM_NOT_READY';
  end if;

  perform encheres.begin_game(v_code);
  if r.format = 'teams' then
    update encheres.rooms
       set lineup = encheres.new_lineup(encheres.side_size(r.format),
                                        coalesce(array_length(pool, 1), 0) + 1)
     where code = v_code;
  end if;
  return encheres.room_view(v_code, v_seat) || jsonb_build_object('youMember', 0);
end;
$$;

-- As in 0012; in a teams room only the members facing off this round may
-- draw, bid or pass (anyone may move on from a result).
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
  v_member smallint;
begin
  if not exists (select 1 from encheres.rooms where code = v_code) then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  v_seat := encheres.seat_of(v_code, p_token);
  if v_seat is null then
    raise exception 'NOT_IN_ROOM';
  end if;
  v_member := encheres.member_of(v_code, p_token);
  if v_member > 0 then
    update encheres.room_members set seen_at = now()
     where room_code = v_code and token_hash = encheres.token_hash(p_token);
  else
    perform encheres.touch(v_code, v_seat);
  end if;
  if p_action in ('draw', 'bid', 'pass') and v_member <> encheres.active_member(v_code, v_seat) then
    raise exception 'NOT_YOUR_TURN';
  end if;
  update encheres.room_players set strikes = 0
   where room_code = v_code and seat = v_seat and strikes <> 0;
  return encheres.play_as(v_code, v_seat, p_action, p_amount)
         || jsonb_build_object('youMember', v_member);
end;
$$;

-- As in 0010; a teammate's presence is kept on their own row.
create or replace function public.get_room(p_code text, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_seat smallint;
  v_member smallint;
begin
  if not exists (select 1 from encheres.rooms where code = v_code) then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  v_seat := encheres.seat_of(v_code, p_token);
  if v_seat is null then
    raise exception 'NOT_IN_ROOM';
  end if;
  v_member := encheres.member_of(v_code, p_token);
  if v_member > 0 then
    update encheres.room_members set seen_at = now()
     where room_code = v_code and token_hash = encheres.token_hash(p_token);
  else
    perform encheres.touch(v_code, v_seat);
  end if;
  perform encheres.enforce(v_code);
  perform encheres.bot_step(v_code);
  return encheres.room_view(v_code, v_seat) || jsonb_build_object('youMember', v_member);
end;
$$;

-- As in 0010; only a side's first member speaks for the side's presence.
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
  if v_seat is null or encheres.member_of(v_code, p_token) <> 0 then
    return;
  end if;
  update encheres.room_players
     set seen_at = least(seen_at, now() - make_interval(secs => encheres.away_seconds() - 8))
   where room_code = v_code and seat = v_seat;
end;
$$;

revoke all on function public.create_room(text, text, integer, integer, integer, integer, text[], boolean, text, text) from public;
grant execute on function public.create_room(text, text, integer, integer, integer, integer, text[], boolean, text, text) to anon, authenticated;
revoke all on function public.switch_side(text, text) from public;
grant execute on function public.switch_side(text, text) to anon, authenticated;
revoke all on function public.leave_room(text, text) from public;
grant execute on function public.leave_room(text, text) to anon, authenticated;

revoke all on all functions in schema encheres from public;

notify pgrst, 'reload schema';
