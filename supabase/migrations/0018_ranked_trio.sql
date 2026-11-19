-- Enchères Animés — ranked 1v1v1.
--
-- A quick match for three, in any universe or all mixed. Trophies go to one
-- 1v1v1 rating whatever the universe, which has its own leaderboard and counts
-- as one more mode (one share) in the overall score.
--
-- Matchmaking (find_trio): a player waits in a room of their universe until
-- three are seated; after the usual wait, stand-ins (computer players,
-- presented like anyone else) take the empty seats. The game is the auction
-- of 0017 for three players, with the quick-match clock: 30 seconds a move,
-- the third time-out in a row or leaving counts as giving up. A player who
-- gives up is placed last and a stand-in plays out their seat, so the other
-- two can finish.
--
-- Trophies: each player is compared with each of the other two, as in a
-- one-against-one game (a better place is a win, a worse one a loss, the same
-- place a tie; a stand-in counts as a player of one's own level), and the two
-- results are averaged. Against equals: about +30 for first, +2 for second and
-- -26 for last.
--
-- None of this touches one-against-one games: enforce, bot_step, resign and
-- leave_queue branch off for 1v1v1 rooms and are otherwise unchanged.
--
-- Safe to run twice.

alter table encheres.rooms add column if not exists bot_seats smallint[];
-- Players who gave up (left, or timed out three times in a row); placed last.
alter table encheres.rooms add column if not exists left_seats smallint[];
alter table encheres.matches drop constraint if exists matches_forfeit_check;
alter table encheres.matches add constraint matches_forfeit_check check (forfeit in (0, 1, 2));

-- 1v1v1 is a mode of its own: one share of the overall score.
create or replace function encheres.is_mode(p_mode text)
returns boolean language sql stable set search_path = '' as $$
  select p_mode in ('mix', 'trio') or exists (select 1 from encheres.characters c where c.universe = p_mode);
$$;

create or replace function encheres.total_weight()
returns integer language sql stable set search_path = '' as $$
  select (select count(distinct c.universe) from encheres.characters c where c.universe is not null)::integer
         + encheres.mode_weight('mix') + encheres.mode_weight('trio');
$$;

-- Seats played by the computer in a 1v1v1 room: stand-ins and players who gave up.
create or replace function encheres.is_bot_seat(r encheres.rooms, p_seat smallint)
returns boolean language sql immutable set search_path = '' as $$
  select p_seat = any(coalesce(r.bot_seats, '{}'::smallint[]));
$$;

-- Stand-ins take every empty seat, then the game starts.
create or replace function encheres.trio_fill(p_code text)
returns void language plpgsql set search_path = '' as $$
declare
  r encheres.rooms;
  v_slot record;
  v_name text;
  v_level double precision;
begin
  select * into r from encheres.rooms where code = p_code for update;
  select coalesce(avg(encheres.mode_trophies(encheres.profile_id_of(p.token_hash), 'trio')), 0)
    into v_level
    from encheres.room_players p where p.room_code = p_code;
  for v_slot in select * from encheres.free_slots(p_code) order by seat loop
    for attempt in 1 .. 10 loop
      v_name := encheres.opponent_name(null);
      exit when not exists (select 1 from encheres.room_players p
                             where p.room_code = p_code and lower(p.name) = lower(v_name));
    end loop;
    perform encheres.take_slot(p_code, v_slot.seat, 0::smallint,
                               encheres.token_hash(replace(gen_random_uuid()::text, '-', '')), v_name);
    update encheres.rooms set bot_seats = array_append(coalesce(bot_seats, '{}'), v_slot.seat) where code = p_code;
  end loop;
  update encheres.rooms
     set bot_token = coalesce(bot_token, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')),
         bot_skill = least(1::double precision, greatest(0::double precision,
                       v_level / 1200::double precision + (random() * 0.2 - 0.1)))
   where code = p_code;
  perform encheres.begin_game(p_code);
end;
$$;

-- Quick match for three. Polled every few seconds while waiting, with the
-- code of the room the player waits in.
create or replace function public.find_trio(p_token text, p_name text, p_verse text, p_code text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_hash text;
  v_name text := encheres.clean_name(p_name);
  v_me encheres.profiles;
  v_room encheres.rooms;
  v_seat smallint;
  v_verse text := lower(btrim(coalesce(p_verse, '')));
  v_trophies integer;
  v_target text;
  v_code text;
  v_pool text[];
begin
  if p_token is null or char_length(p_token) < 16 or char_length(p_token) > 128 then
    raise exception 'INVALID_INPUT';
  end if;
  v_hash := encheres.token_hash(p_token);
  perform pg_advisory_xact_lock(hashtext('encheres.find_match'));

  v_me := encheres.profile_for(v_hash, v_name);
  perform encheres.roll_season();

  -- Waiting players who stopped polling give up their place; empty rooms go.
  delete from encheres.room_players p
   using encheres.rooms r
   where r.code = p.room_code and r.matched and r.format = 'trio' and r.status = 'lobby'
     and p.seen_at < now() - interval '15 seconds' and p.token_hash <> v_hash;
  delete from encheres.rooms r
   where r.matched and r.format = 'trio' and r.status = 'lobby'
     and not exists (select 1 from encheres.room_players p where p.room_code = r.code);

  if p_code is not null then
    select r.* into v_room
      from encheres.rooms r
      join encheres.room_players p on p.room_code = r.code
     where r.code = upper(btrim(p_code)) and r.matched and r.format = 'trio' and p.token_hash = v_hash;
    if found then
      v_seat := encheres.seat_of(v_room.code, p_token);
      if v_room.status <> 'lobby' then
        return encheres.room_view(v_room.code, v_seat);
      end if;
      update encheres.room_players set seen_at = now() where room_code = v_room.code and token_hash = v_hash;
      -- Nobody else turned up in time: stand-ins take the empty seats.
      if encheres.opponent_due(v_room.code, extract(epoch from (now() - v_room.created_at))) then
        perform encheres.trio_fill(v_room.code);
      end if;
      return encheres.room_view(v_room.code, v_seat);
    end if;
  end if;

  -- A fresh search: leave any room this player was waiting in.
  delete from encheres.room_players p
   using encheres.rooms r
   where r.code = p.room_code and r.matched and r.format = 'trio' and r.status = 'lobby'
     and p.token_hash = v_hash;
  delete from encheres.rooms r
   where r.matched and r.format = 'trio' and r.status = 'lobby'
     and not exists (select 1 from encheres.room_players p where p.room_code = r.code);

  if v_verse = '' or v_verse = 'trio' or not encheres.is_mode(v_verse) then
    raise exception 'INVALID_INPUT';
  end if;
  v_trophies := encheres.mode_trophies(v_me.id, 'trio');

  -- The oldest room of this universe with a free seat and players of a close
  -- level; the acceptable gap grows with the room's wait.
  select r.code into v_target
    from encheres.rooms r
   where r.matched and r.format = 'trio' and r.status = 'lobby' and r.verse = v_verse
     and encheres.headcount(r.code) < 3
     and not exists (select 1 from encheres.room_players p
                      where p.room_code = r.code
                        and encheres.profile_id_of(p.token_hash) is not distinct from v_me.id)
     and abs(coalesce((select avg(encheres.mode_trophies(encheres.profile_id_of(p.token_hash), 'trio'))
                         from encheres.room_players p where p.room_code = r.code), 0) - v_trophies)
         <= 150 + 40 * extract(epoch from (now() - r.created_at))
   order by r.created_at, r.code
   limit 1
   for update of r;

  if v_target is not null then
    select s.seat into v_seat from encheres.free_slots(v_target) as s order by s.seat limit 1;
    perform encheres.take_slot(v_target, v_seat, 0::smallint, v_hash, v_name);
    update encheres.rooms set version = version + 1, updated_at = now() where code = v_target;
    if encheres.headcount(v_target) >= 3 then
      perform encheres.begin_game(v_target);
    end if;
    return encheres.room_view(v_target, v_seat);
  end if;

  -- Nobody is waiting: open a room. The server deals from its own card list.
  v_pool := encheres.mode_pool(v_verse);
  if coalesce(array_length(v_pool, 1), 0) < 15 then
    raise exception 'INVALID_INPUT';
  end if;
  perform encheres.hit('match:' || encheres.client_key(), 120, interval '1 hour');
  delete from encheres.rooms where updated_at < now() - interval '24 hours';

  loop
    select string_agg(substr(v_alphabet, 1 + floor(random() * 32)::integer, 1), '')
      into v_code
      from generate_series(1, 5);
    exit when not exists (select 1 from encheres.rooms where code = v_code);
  end loop;

  insert into encheres.rooms (code, budget, team_size, min_bid, increment, pool, matched, mode, format, verse)
  values (v_code, 500, 5, 10, 10, v_pool, true, 'trio', 'trio', v_verse);
  insert into encheres.room_players (room_code, seat, token_hash, name, budget)
  values (v_code, 0, v_hash, v_name, 500);

  return encheres.room_view(v_code, 0::smallint);
end;
$$;

-- A player gives up: placed last, and a stand-in plays out their seat. When
-- nobody is left, the game plays out at once.
create or replace function encheres.trio_leave(p_code text, p_seat smallint)
returns void language plpgsql set search_path = '' as $$
declare
  r encheres.rooms;
begin
  select * into r from encheres.rooms where code = p_code for update;
  if not found or r.status <> 'playing' or encheres.is_bot_seat(r, p_seat) then
    return;
  end if;
  update encheres.rooms
     set bot_seats = array_append(coalesce(bot_seats, '{}'), p_seat),
         left_seats = array_append(coalesce(left_seats, '{}'), p_seat),
         bot_token = coalesce(bot_token, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')),
         bot_skill = coalesce(bot_skill, 0.3),
         updated_at = now(),
         version = version + 1
   where code = p_code;
  if not exists (select 1 from encheres.room_players p, encheres.rooms x
                  where x.code = p_code and p.room_code = p_code and not encheres.is_bot_seat(x, p.seat)) then
    perform encheres.trio_finish(p_code);
  end if;
end;
$$;

-- The computer's move for a seat it plays, or the simplest legal one.
create or replace function encheres.trio_bot_move(p_code text, p_seat smallint)
returns void language plpgsql set search_path = '' as $$
declare
  r encheres.rooms;
  v_choice jsonb;
  v_seed text;
begin
  select * into r from encheres.rooms where code = p_code;
  v_seed := coalesce(r.bot_token, r.code) || ':' || p_seat;
  begin
    v_choice := encheres.bot_choice_seat(
      p_code, p_seat,
      encheres.unit('noise:' || v_seed || ':' || r.round),
      encheres.unit('bluff:' || v_seed || ':' || r.round),
      encheres.unit('jump:' || v_seed || ':' || r.version));
    perform encheres.play_as(p_code, p_seat, v_choice ->> 'a', (v_choice ->> 'v')::integer);
  exception when others then
    perform encheres.play_as(p_code, p_seat,
      case r.phase when 'draw' then 'draw' when 'reveal' then 'next'
                   else case when r.high_bidder is null and not encheres.can_pass(p_code, p_seat) then 'bid'
                             else 'pass' end end,
      case when r.phase = 'bidding' and r.high_bidder is null and not encheres.can_pass(p_code, p_seat)
           then r.min_bid end);
  end;
end;
$$;

-- Plays the game out at once (no player can change their result any more).
create or replace function encheres.trio_finish(p_code text)
returns void language plpgsql set search_path = '' as $$
declare
  r encheres.rooms;
begin
  for step in 1 .. 600 loop
    select * into r from encheres.rooms where code = p_code for update;
    exit when not found or r.status <> 'playing';
    if r.phase = 'reveal' then
      perform encheres.play_as(p_code, r.drawer, 'next', null);
    elsif r.phase = 'draw' then
      perform encheres.play_as(p_code, r.drawer, 'draw', null);
    elsif encheres.is_bot_seat(r, r.turn) then
      perform encheres.trio_bot_move(p_code, r.turn);
    elsif r.high_bidder is null and not encheres.can_pass(p_code, r.turn) then
      perform encheres.play_as(p_code, r.turn, 'bid', r.min_bid);
    else
      perform encheres.play_as(p_code, r.turn, 'pass', null);
    end if;
  end loop;
end;
$$;

-- The quick-match rules for 1v1v1, read on every poll (as enforce for 1v1).
create or replace function encheres.enforce_trio(p_code text)
returns void language plpgsql set search_path = '' as $$
declare
  r encheres.rooms;
  v_gone smallint;
  v_actor smallint;
  v_strikes integer;
begin
  select * into r from encheres.rooms where code = p_code for update;
  if not found or r.status <> 'playing' then
    return;
  end if;

  -- Out of passes and nobody has bid: after a few seconds, the minimum.
  if r.phase = 'bidding' and r.high_bidder is null and not encheres.is_bot_seat(r, r.turn)
     and not encheres.can_pass(p_code, r.turn)
     and now() - r.updated_at >= make_interval(secs => encheres.auto_bid_seconds())
  then
    perform encheres.play_as(p_code, r.turn, 'bid', r.min_bid);
    return;
  end if;

  -- A player has left (a player who cannot buy any more has nothing to do).
  select p.seat into v_gone
    from encheres.room_players p
   where p.room_code = p_code
     and not encheres.is_bot_seat(r, p.seat)
     and encheres.can_buy(p_code, p.seat)
     and p.seen_at < now() - make_interval(secs => encheres.away_seconds())
   order by p.seen_at
   limit 1;
  if v_gone is not null then
    perform encheres.trio_leave(p_code, v_gone);
    return;
  end if;

  if r.phase = 'reveal' and now() - r.updated_at >= make_interval(secs => encheres.reveal_seconds()) then
    perform encheres.play_as(p_code, r.drawer, 'next', null);
    return;
  end if;

  v_actor := case r.phase when 'draw' then r.drawer when 'bidding' then r.turn else null end;
  if v_actor is null or encheres.is_bot_seat(r, v_actor)
     or now() - r.updated_at < make_interval(secs => encheres.turn_seconds())
  then
    return;
  end if;
  update encheres.room_players set strikes = strikes + 1
   where room_code = p_code and seat = v_actor
  returning strikes into v_strikes;
  if v_strikes >= encheres.max_strikes() then
    perform encheres.trio_leave(p_code, v_actor);
  elsif r.phase = 'draw' then
    perform encheres.play_as(p_code, v_actor, 'draw', null);
  elsif r.high_bidder is null and not encheres.can_pass(p_code, v_actor) then
    perform encheres.play_as(p_code, v_actor, 'bid', r.min_bid);
  else
    perform encheres.play_as(p_code, v_actor, 'pass', null);
  end if;
end;
$$;

-- The computer's seats in a 1v1v1 quick match, paced like a person.
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
  if r.phase <> 'reveal'
     and not exists (select 1 from encheres.room_players p
                      where p.room_code = p_code and not encheres.is_bot_seat(r, p.seat)
                        and encheres.can_buy(p_code, p.seat)) then
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

-- As bot_choice (0012), for any seat in a game of two or three players.
create or replace function encheres.bot_choice_seat(
  p_code text,
  p_seat smallint,
  p_noise double precision,
  p_bluff double precision,
  p_jump double precision
)
returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  r encheres.rooms;
  st record;
  mine record;
  theirs record;
  v_me smallint;
  v_rival smallint;
  v_budget integer;
  v_slots integer;
  v_rival_budget integer;
  v_rival_slots integer;
  v_required integer;
  v_deck integer;
  v_ids text[];
  v_strengths double precision[];
  v_market double precision[];
  v_presence double precision;
  v_rival_out boolean;
  v_noise double precision;
  v_card double precision;
  v_limit integer;
  v_bluff_ceiling integer;
  v_bluffing boolean;
  v_ceiling integer;
  v_opening integer;
  v_rival_chose boolean;
  v_worth double precision;
  v_weight double precision;
  v_stays double precision;
  v_total double precision := 0;
  v_win_weight double precision := 0;
  v_win_value double precision := 0;
  v_pass jsonb := jsonb_build_object('a', 'pass', 'v', null);
begin
  select * into r from encheres.rooms where code = p_code;
  if not found or r.status <> 'playing' then
    return null;
  end if;
  if r.phase = 'draw' then
    return jsonb_build_object('a', 'draw', 'v', null);
  elsif r.phase = 'reveal' then
    return jsonb_build_object('a', 'next', 'v', null);
  end if;

  v_me := p_seat;
  -- The rival to read: whoever drew the card (only they know it); when the
  -- computer drew, the other player with the most money still in the auction.
  v_rival := case
               when r.drawer <> v_me then r.drawer
               else coalesce(
                 (select p.seat from encheres.room_players p
                   where p.room_code = p_code and p.seat <> v_me and not r.passed[p.seat + 1]
                   order by p.budget desc, p.seat limit 1),
                 ((v_me + 1) % encheres.side_count(r.format))::smallint)
             end;
  select p.budget, r.team_size - coalesce(array_length(p.team, 1), 0) into v_budget, v_slots
    from encheres.room_players p where p.room_code = p_code and p.seat = v_me;
  select p.budget, r.team_size - coalesce(array_length(p.team, 1), 0) into v_rival_budget, v_rival_slots
    from encheres.room_players p where p.room_code = p_code and p.seat = v_rival;
  v_required := case when r.high_bidder is null then r.min_bid else r.high_bid + r.increment end;
  if v_slots <= 0 or v_budget < v_required then
    return v_pass;
  end if;
  -- Out of passes and nobody has bid: skipping is not allowed, so wherever
  -- the computer would pass it bids the minimum instead (as in src/bot/bot.ts).
  if r.high_bidder is null and not encheres.can_pass(p_code, v_me) then
    v_pass := jsonb_build_object('a', 'bid', 'v', v_required);
  end if;

  select * into st from encheres.bot_style(r.bot_skill);
  v_deck := coalesce(array_length(r.deck, 1), 0);

  -- Cards not revealed yet, in pool order. The card on the table is among
  -- them: nothing here depends on which one it is unless the computer drew it.
  select array_agg(x.id order by x.ord), array_agg(encheres.strength(c.power) order by x.ord)
    into v_ids, v_strengths
    from unnest(r.pool) with ordinality as x (id, ord)
    join encheres.characters c on c.id = x.id
   where not exists (
     select 1 from jsonb_array_elements(r.history) as h where h ->> 'card' = x.id
   );

  if st.counts_cards then
    select array_agg(u.s order by u.s desc) into v_market
      from unnest(v_ids, v_strengths) as u (id, s)
     where r.drawer <> v_me or u.id <> r.card;
  else
    select array_agg(encheres.strength(c.power) order by encheres.strength(c.power) desc) into v_market
      from unnest(r.pool) as x (id)
      join encheres.characters c on c.id = x.id;
  end if;
  v_presence := case
                  when coalesce(array_length(v_market, 1), 0) > 0
                    then least(1::double precision, v_deck::double precision / array_length(v_market, 1))
                  else 0::double precision
                end;
  select * into mine from encheres.bot_outlook(v_market, v_presence, v_slots);
  -- Nobody else can still take the card.
  v_rival_out := not exists (
    select 1 from encheres.room_players p
     where p.room_code = p_code and p.seat <> v_me and not r.passed[p.seat + 1]
       and r.team_size - coalesce(array_length(p.team, 1), 0) > 0 and p.budget >= r.min_bid);

  -- The computer drew the card and knows it -----------------------------------
  if r.drawer = v_me then
    select encheres.strength(c.power) into v_card from encheres.characters c where c.id = r.card;
    v_noise := 1::double precision + (p_noise * 2::double precision - 1::double precision) * st.noise;
    v_worth := encheres.bot_worth(v_budget, v_slots, coalesce(v_card, 0), mine.threshold, mine.alternatives);
    v_limit := floor(least(v_budget::double precision, v_worth * v_noise * st.greed) / r.increment)::integer
               * r.increment;
    -- A bluff pretends the card is decent: half a slot's fair share at most.
    v_bluff_ceiling := floor(least(v_budget::double precision,
                                   (v_budget::double precision / v_slots) * 0.5::double precision)
                             / r.increment)::integer * r.increment;
    v_bluffing := v_limit < r.min_bid * 2 and v_budget >= r.min_bid * 4 and p_bluff < st.bluff_chance;

    if r.high_bidder is null then
      if v_rival_out then
        return case when v_limit >= v_required
                    then jsonb_build_object('a', 'bid', 'v', v_required) else v_pass end;
      end if;
      if v_bluffing then
        return jsonb_build_object('a', 'bid', 'v', greatest(
          v_required,
          floor(v_bluff_ceiling::double precision * 0.5::double precision / r.increment)::integer * r.increment));
      end if;
      if v_limit < v_required then
        return v_pass;
      end if;
      -- Open low: a low bid on a great card looks like a low bid on a poor one.
      v_opening := floor(v_limit::double precision * 0.25::double precision / r.increment)::integer * r.increment;
      return jsonb_build_object('a', 'bid', 'v', least(v_limit, greatest(v_required, v_opening)));
    end if;

    v_ceiling := case when v_bluffing then v_bluff_ceiling else v_limit end;
    if v_required > v_ceiling then
      return v_pass;
    end if;
    return jsonb_build_object('a', 'bid', 'v', v_required + case
      when st.noise > 0 and p_jump < 0.25 and v_required + r.increment <= v_ceiling then r.increment
      else 0
    end);
  end if;

  -- The player drew the card: bid blind ----------------------------------------
  if v_ids is null then
    return v_pass;
  end if;
  select * into theirs from encheres.bot_outlook(v_market, v_presence, v_rival_slots);
  v_rival_chose := v_rival_slots > 0 and v_rival_budget >= r.min_bid;

  -- Weigh every card it could be by how well it explains the player's bids.
  for i in 1 .. array_length(v_ids, 1) loop
    v_worth := encheres.bot_worth(v_rival_budget, v_rival_slots, v_strengths[i], theirs.threshold, theirs.alternatives);
    if r.high_bidder = v_rival then
      v_weight := case when v_worth >= r.high_bid then 1::double precision else st.rival_bluff end;
    else
      v_weight := case when not v_rival_chose or v_worth < r.min_bid * 2
                       then 1::double precision else 0.07::double precision end;
    end if;
    -- It only wins the card if the player does not raise again.
    v_stays := case
                 when r.high_bidder is null then 1::double precision
                 else 1::double precision - (case when v_worth >= v_required + r.increment
                                                  then 0.85::double precision else 0.3::double precision end)
               end;
    v_total := v_total + v_weight;
    v_win_weight := v_win_weight + v_weight * v_stays;
    v_win_value := v_win_value + v_weight * v_stays
                   * encheres.bot_worth(v_budget, v_slots, v_strengths[i], mine.threshold, mine.alternatives);
  end loop;
  if v_win_weight <= 0 or v_total <= 0 then
    return v_pass;
  end if;

  v_noise := 1::double precision + (p_noise * 2::double precision - 1::double precision) * st.noise;
  if (v_win_value / v_win_weight) * v_noise * st.nerve >= v_required then
    return jsonb_build_object('a', 'bid', 'v', v_required);
  end if;
  return v_pass;
end;
$$;

-- As in 0013; ranked 1v1v1 has its own referee.
create or replace function encheres.enforce(p_code text)
returns void language plpgsql set search_path = '' as $$
declare
  r encheres.rooms;
  v_gone smallint;
  v_actor smallint;
  v_strikes integer;
begin
  select * into r from encheres.rooms where code = p_code for update;
  if not found or r.status <> 'playing' then
    return;
  end if;
  if r.format = 'trio' and r.matched then
    perform encheres.enforce_trio(p_code);
    return;
  end if;

  -- Out of passes and nobody has bid: the player has to bid anyway, so after
  -- a few seconds the minimum is bid for them (any room; no strike). Players
  -- on the old site may still pass, so they are left alone.
  if r.phase = 'bidding' and r.high_bidder is null and r.turn is distinct from r.bot_seat
     and not encheres.can_pass(p_code, r.turn)
     and not coalesce((select p.old_site from encheres.room_players p
                        where p.room_code = p_code and p.seat = r.turn), false)
     and now() - r.updated_at >= make_interval(secs => encheres.auto_bid_seconds())
  then
    perform encheres.play_as(p_code, r.turn, 'bid', r.min_bid);
    return;
  end if;

  -- The rest only applies to quick matches.
  if not r.matched then
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
  -- Strikes count time-outs in a row: any move the player makes themselves
  -- clears them (public.play).
  update encheres.room_players set strikes = strikes + 1
   where room_code = p_code and seat = v_actor
  returning strikes into v_strikes;
  if v_strikes >= encheres.max_strikes() then
    perform encheres.end_by_forfeit(p_code, v_actor);
  elsif r.phase = 'draw' then
    perform encheres.play_as(p_code, v_actor, 'draw', null);
  elsif r.high_bidder is null and not encheres.can_pass(p_code, v_actor) then
    -- Out of passes and nobody has bid: the only legal move is the minimum bid.
    perform encheres.play_as(p_code, v_actor, 'bid', r.min_bid);
  else
    perform encheres.play_as(p_code, v_actor, 'pass', null);
  end if;
end;
$$;

-- As in 0011; ranked 1v1v1 has its own stand-ins.
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

-- As in 0011, with 1v1v1.
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
    else
      perform encheres.bot_step(v_code);
    end if;
  end if;
  return encheres.room_view(v_code, v_seat);
end;
$$;

-- As in 0002, with 1v1v1.
create or replace function public.leave_queue(p_code text, p_token text)
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
  perform pg_advisory_xact_lock(hashtext('encheres.find_match'));
  select * into r from encheres.rooms where code = v_code for update;
  if not found then
    return null;
  end if;
  v_seat := encheres.seat_of(v_code, p_token);
  if v_seat is null or not r.matched then
    raise exception 'NOT_IN_ROOM';
  end if;
  if r.status = 'lobby' then
    if r.format = 'trio' then
      -- Others may be waiting in the same room: give up this place only.
      perform encheres.free_place(v_code, v_seat, 0::smallint);
      delete from encheres.rooms
       where code = v_code and not exists (select 1 from encheres.room_players where room_code = v_code);
    else
      delete from encheres.rooms where code = v_code;
    end if;
    return null;
  end if;
  return encheres.room_view(v_code, v_seat);
end;
$$;

-- As in 0017; ranked 1v1v1 games also move trophies (see the top of this file),
-- and players who gave up come last.
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
  v_left smallint[];
  v_places smallint[];
  v_winner smallint;
  v_person boolean[] := '{}';
  v_ids uuid[] := array[null, null, null]::uuid[];
  v_trophies integer[] := array[0, 0, 0];
  v_deltas integer[] := array[0, 0, 0];
  v_totals integer[] := array[null, null, null]::integer[];
  v_sum double precision;
  v_them integer;
  v_outcome text;
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
  v_left := coalesce(r.left_seats, '{}');

  -- Places: by team power, teams within the tie gap sharing a place; anyone
  -- who gave up is last.
  select array_agg(
           case when (i - 1)::smallint = any(v_left) then 3
                else 1 + (select count(*) from generate_series(1, 3) as j
                           where j <> i and not ((j - 1)::smallint = any(v_left))
                             and v_power[j] - v_power[i] >= 0.4)
           end::smallint
           order by i)
    into v_places
    from generate_series(1, 3) as i;
  v_winner := case when (select count(*) from unnest(v_places) as x where x = 1) = 1
                   then (select (i - 1)::smallint from generate_series(1, 3) as i where v_places[i] = 1)
              end;

  for i in 1 .. 3 loop
    -- A real player, as opposed to a stand-in (a player who left still counts).
    v_person := v_person || (not ((i - 1)::smallint = any(coalesce(r.bot_seats, '{}')))
                             or (i - 1)::smallint = any(v_left));
    if r.matched and v_person[i] then
      v_ids[i] := (encheres.profile_for(v_hashes[i], null)).id;
      v_trophies[i] := encheres.mode_trophies(v_ids[i], 'trio');
    else
      v_ids[i] := encheres.profile_id_of(v_hashes[i]);
    end if;
  end loop;

  if r.matched then
    for i in 1 .. 3 loop
      continue when not v_person[i];
      v_sum := 0;
      for j in 1 .. 3 loop
        continue when j = i;
        -- A stand-in counts as a player of one's own level.
        v_them := case when v_person[j] then v_trophies[j] else v_trophies[i] end;
        v_sum := v_sum + case
                           when v_places[i] < v_places[j] then encheres.win_gain(v_trophies[i], v_them)
                           when v_places[i] > v_places[j] then -encheres.loss_cost(v_trophies[i], v_them)
                           else 0
                         end;
      end loop;
      v_deltas[i] := greatest(round(v_sum / 2)::integer, -v_trophies[i]);
      v_outcome := case
                     when v_winner = i - 1 then 'win'
                     when v_places[i] > 1 and v_places[i] = (select max(x) from unnest(v_places) as x) then 'loss'
                     else 'tie'
                   end;
      v_totals[i] := encheres.apply_result(v_ids[i], 'trio', v_outcome, v_deltas[i],
                                           (i - 1)::smallint = any(v_left));
    end loop;
  end if;

  insert into encheres.matches
    (kind, room_code, profile0, profile1, profile2, names, teams, powers, winner, forfeit, places, deltas,
     settings, history, log, opponent_skill, mode)
  values (
    case when r.matched then 'ranked' else 'private' end, r.code,
    v_ids[1], v_ids[2], v_ids[3],
    v_names, v_teams,
    array[round(v_power[1]::numeric, 2), round(v_power[2]::numeric, 2), round(v_power[3]::numeric, 2)],
    v_winner, v_left[1], v_places, v_deltas,
    jsonb_build_object('budget', r.budget, 'teamSize', r.team_size, 'minBid', r.min_bid,
                       'increment', r.increment, 'poolSize', coalesce(array_length(r.pool, 1), 0)),
    r.history, r.log, r.bot_skill,
    case when r.matched then 'trio' end
  );

  update encheres.rooms
     set settled = true,
         result = jsonb_build_object(
           'winner', v_winner,
           'mode', case when r.matched then 'trio' end,
           'power', jsonb_build_array(round(v_power[1]::numeric, 1), round(v_power[2]::numeric, 1),
                                      round(v_power[3]::numeric, 1)),
           'places', to_jsonb(v_places),
           'left', to_jsonb(v_left),
           'deltas', case when r.matched then to_jsonb(v_deltas) end,
           'trophies', case when r.matched then to_jsonb(v_totals) end
         )
   where code = p_code;
end;
$$;

-- Stored overall scores were worked out over the old number of shares.
update encheres.profiles set trophies = encheres.overall(id) where trophies <> encheres.overall(id);

revoke all on function public.find_trio(text, text, text, text) from public;
grant execute on function public.find_trio(text, text, text, text) to anon, authenticated;

revoke all on all functions in schema encheres from public;

notify pgrst, 'reload schema';
