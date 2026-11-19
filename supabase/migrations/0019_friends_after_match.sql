-- Enchères Animés — friends after a match, and the computer plays on.
--
-- After any online game (quick match or room), each player can send a friend
-- request to the others from the results screen (add_friend_seat). A request
-- to a stand-in is accepted by the server as if it had gone out: it shows
-- under "requests sent" like any other (ghost_requests) and is never
-- answered. Requests received can be declined all at once.
--
-- Against the computer, a player who can no longer buy used to see the game
-- finish at once. Now the computer keeps playing at its usual pace while the
-- player is watching, as a person would; it finishes at once only after the
-- player has gone (not heard from for watching_seconds).
--
-- Safe to run twice.

create table if not exists encheres.ghost_requests (
  id         uuid primary key default gen_random_uuid(),
  requester  uuid not null references encheres.profiles (id) on delete cascade,
  room_code  text not null,
  seat       smallint not null,
  name       text not null,
  tag        text not null,
  trophies   integer not null default 0,
  created_at timestamptz not null default now(),
  unique (requester, room_code, seat)
);
alter table encheres.ghost_requests enable row level security;
revoke all on encheres.ghost_requests from public;

-- Seconds without a poll after which a player is no longer watching their game.
create or replace function encheres.watching_seconds()
returns integer language sql immutable set search_path = '' as $$ select 15; $$;

-- A tag that looks like any player's (seven characters of the tag alphabet).
create or replace function encheres.ghost_tag(p_seed text)
returns text language sql immutable set search_path = '' as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
                           1 + (get_byte(decode(md5(p_seed), 'hex'), i) % 32), 1), '' order by i)
    from generate_series(0, 6) as i;
$$;

-- A friend request from the results screen, to the player in a seat of the
-- room (and, in 2v2, a member of that side).
create or replace function public.add_friend_seat(p_code text, p_token text, p_seat smallint, p_member smallint default 0)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r encheres.rooms;
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_hash text;
  v_target text;
  v_name text;
  me encheres.profiles;
  them encheres.profiles;
  v_stand_in boolean;
  v_mine text;
begin
  if p_token is null or char_length(p_token) < 16 or char_length(p_token) > 128
     or p_seat is null or p_seat not in (0, 1, 2) or coalesce(p_member, 0) not between 0 and 3 then
    raise exception 'INVALID_INPUT';
  end if;
  select * into r from encheres.rooms where code = v_code;
  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  if encheres.seat_of(v_code, p_token) is null then
    raise exception 'NOT_IN_ROOM';
  end if;
  v_hash := encheres.token_hash(p_token);
  -- A player without a profile yet gets one, under the name they played with.
  select name into v_mine from (
    select name from encheres.room_players where room_code = v_code and token_hash = v_hash
    union all
    select name from encheres.room_members where room_code = v_code and token_hash = v_hash
  ) as x limit 1;
  if encheres.profile_id_of(v_hash) is null then
    perform encheres.profile_for(v_hash, v_mine);
  end if;

  if coalesce(p_member, 0) = 0 then
    select token_hash, name into v_target, v_name from encheres.room_players where room_code = v_code and seat = p_seat;
  else
    select token_hash, name into v_target, v_name from encheres.room_members
     where room_code = v_code and seat = p_seat and member = p_member;
  end if;
  if v_target is null then
    raise exception 'INVALID_INPUT';
  end if;

  v_stand_in := (p_seat = r.bot_seat)
                or (p_seat = any(coalesce(r.bot_seats, '{}')) and not (p_seat = any(coalesce(r.left_seats, '{}'))));
  if v_stand_in then
    -- The computer has no profile: the request goes nowhere, but looks sent.
    perform encheres.hit('friend:' || v_hash, 40, interval '1 day');
    me := encheres.profile_for(v_hash, null);
    insert into encheres.ghost_requests (requester, room_code, seat, name, tag, trophies)
    values (me.id, v_code, p_seat, v_name, encheres.ghost_tag(v_code || ':' || p_seat),
            greatest(0, encheres.mode_trophies(me.id, coalesce(r.mode, 'mix'))
                        + (floor(random() * 80) - 40)::integer))
    on conflict (requester, room_code, seat) do nothing;
    return encheres.friends_json(me.id) || jsonb_build_object('status', 'sent');
  end if;

  if v_target = v_hash then
    raise exception 'INVALID_INPUT';
  end if;
  -- The other player's profile, made under their room name if they have none.
  if encheres.profile_id_of(v_target) is null then
    them := encheres.profile_for(v_target, v_name);
  else
    them := encheres.profile_for(v_target, null);
  end if;
  return public.add_friend(p_token, them.tag);
end;
$$;

-- Declines every friend request waiting for this player.
create or replace function public.decline_all_friends(p_token text)
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
  delete from encheres.friends where addressee = me.id and not accepted;
  return encheres.friends_json(me.id);
end;
$$;

-- As in 0006, with requests to stand-ins among those sent.
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
      select jsonb_agg(x.person order by x.at)
        from (
          select encheres.person_json(p) as person, f.created_at as at
            from encheres.friends f
            join encheres.profiles p on p.id = f.addressee
           where not f.accepted and f.requester = p_me
          union all
          -- Requests to players who were stand-ins: they wait like any other.
          select jsonb_build_object('id', g.id, 'name', g.name, 'avatar', '', 'country', null,
                                    'trophies', g.trophies, 'tag', g.tag), g.created_at
            from encheres.ghost_requests g
           where g.requester = p_me
        ) as x), '[]'::jsonb),
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

-- As in 0006, also cancelling a request to a stand-in.
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
  delete from encheres.ghost_requests where requester = me.id and id = p_friend;
  delete from encheres.invites
   where (from_profile = me.id and to_profile = p_friend) or (from_profile = p_friend and to_profile = me.id);
  return encheres.friends_json(me.id);
end;
$$;

-- As in 0018: the computer plays on while the player watches.
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
  if found and r.format = 'trio' and r.matched then
    perform encheres.bot_step_trio(p_code);
    return;
  end if;
  if not found or r.bot_seat is null or r.status <> 'playing' then
    return;
  end if;
  -- The player cannot buy anything more: nothing the computer does can change
  -- their result, so it finishes its own team at once and the game ends. The
  -- result of the player's last purchase stays on screen first.
  -- (While the player is still watching, the computer plays on at its usual
  -- pace, as a person would: only once they have gone does it finish at once.)
  if r.phase <> 'reveal' and not encheres.can_buy(p_code, (1 - r.bot_seat)::smallint)
     and not exists (select 1 from encheres.room_players p
                      where p.room_code = p_code and p.seat = 1 - r.bot_seat
                        and p.seen_at > now() - make_interval(secs => encheres.watching_seconds()))
  then
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

-- As in 0018: the same for 1v1v1.
create or replace function encheres.bot_step_trio(p_code text)
returns void language plpgsql set search_path = '' as $$
declare
  r encheres.rooms;
  v_actor smallint;
  v_pause double precision;
begin
  select * into r from encheres.rooms where code = p_code for update;
  if not found or r.status <> 'playing' or coalesce(array_length(r.bot_seats, 1), 0) = 0 then
    return;
  end if;
  -- No player left can change their result: finish at once (after the last
  -- result has been on screen).
  -- While a player is still watching, the computer plays on at its usual pace.
  if r.phase <> 'reveal'
     and not exists (select 1 from encheres.room_players p
                      where p.room_code = p_code and not encheres.is_bot_seat(r, p.seat)
                        and encheres.can_buy(p_code, p.seat))
     and not exists (select 1 from encheres.room_players p
                      where p.room_code = p_code and not encheres.is_bot_seat(r, p.seat)
                        and p.seen_at > now() - make_interval(secs => encheres.watching_seconds())) then
    perform encheres.trio_finish(p_code);
    return;
  end if;
  v_actor := case r.phase when 'draw' then r.drawer when 'bidding' then r.turn else null end;
  if v_actor is not null and not encheres.is_bot_seat(r, v_actor) then
    return;
  end if;
  v_pause := coalesce((encheres.setting('opponent_pace') #>> '{}')::double precision, 1)
             * case r.phase
                 when 'draw' then 1.0 + 1.6 * encheres.unit('pause:' || coalesce(r.bot_token, r.code) || ':' || r.version)
                 when 'bidding' then 1.5 + 3.0 * encheres.unit('pause:' || coalesce(r.bot_token, r.code) || ':' || r.version)
                 else 6.0 + 3.0 * encheres.unit('pause:' || coalesce(r.bot_token, r.code) || ':' || r.version)
               end;
  if extract(epoch from (now() - r.updated_at)) < v_pause then
    return;
  end if;
  if r.phase = 'reveal' then
    perform encheres.play_as(p_code, r.drawer, 'next', null);
  else
    perform encheres.trio_bot_move(p_code, v_actor);
  end if;
end;
$$;

-- As in 0018: a player who leaves after their last purchase ends a game against the computer at once.
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
  -- 1v1v1: a player who gives up is placed last and a stand-in plays out
  -- their seat; the other two finish their game.
  if r.format = 'trio' then
    if r.status = 'playing' and encheres.can_buy(v_code, v_seat) then
      perform encheres.trio_leave(v_code, v_seat);
    elsif r.status = 'lobby' then
      perform encheres.free_place(v_code, v_seat, 0::smallint);
    end if;
    return encheres.room_view(v_code, v_seat);
  end if;
  if r.status = 'playing' then
    if encheres.can_buy(v_code, v_seat) then
      perform encheres.end_by_forfeit(v_code, v_seat);
    elsif r.bot_seat is not null then
      -- Leaving after the last purchase: nobody is watching, so finish now.
      perform encheres.finish_for_bot(v_code);
    end if;
  end if;
  return encheres.room_view(v_code, v_seat);
end;
$$;

revoke all on function public.add_friend_seat(text, text, smallint, smallint) from public;
grant execute on function public.add_friend_seat(text, text, smallint, smallint) to anon, authenticated;
revoke all on function public.decline_all_friends(text) from public;
grant execute on function public.decline_all_friends(text) to anon, authenticated;

revoke all on all functions in schema encheres from public;

notify pgrst, 'reload schema';
