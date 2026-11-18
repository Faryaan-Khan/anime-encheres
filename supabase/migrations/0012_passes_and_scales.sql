-- Enchères Animés — whole-universe decks, three passes, time-outs in a row,
-- and each universe's own power scale
--
-- Run after 0011. Idempotent.
--
-- 1. The deck is every card of the game's pool: the whole universe, or every
--    universe when mixed (it used to be teamSize × 4 cards).
--
-- 2. Passes are limited. Skipping a card nobody has bid on costs one of the
--    player's passes, three per game (rooms.pass_limit). Letting the other
--    player have a card they bid on is always free, and so is a pass the game
--    makes for a player who cannot bid. A player out of passes, facing a card
--    nobody has bid on, must bid. (Same rule as pass() in src/game/engine.ts.)
--
-- 3. Strikes count time-outs in a row: any move a player makes themselves
--    clears them. Three in a row still lose the match.
--
-- 4. rooms.scale: a universe id when every card of the pool comes from one
--    universe, otherwise 'all'. The client shows powers on that universe's own
--    0–100 scale. Display only: winners are still decided on shared power.

alter table encheres.rooms add column if not exists pass_limit integer not null default 3;
alter table encheres.rooms add column if not exists scale text;
alter table encheres.room_players add column if not exists passes integer not null default 0;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Same rule as scaleOf in src/data/characters.ts.
create or replace function encheres.scale_of(p_pool text[])
returns text language sql stable set search_path = '' as $$
  select case when count(distinct c.universe) = 1 then min(c.universe) else 'all' end
    from unnest(p_pool) as t (id)
    join encheres.characters c on c.id = t.id;
$$;

-- False when this seat has used all its passes.
create or replace function encheres.can_pass(p_code text, p_seat smallint)
returns boolean language sql stable set search_path = '' as $$
  select coalesce(bool_or(p.passes < r.pass_limit), false)
    from encheres.rooms r
    join encheres.room_players p on p.room_code = r.code and p.seat = p_seat
   where r.code = p_code;
$$;

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
  v_drawer := floor(random() * 2)::smallint;

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
         passed = '{false,false}',
         history = '[]'::jsonb,
         forfeit = null,
         version = version + 1,
         updated_at = now()
   where code = p_code;
end;
$$;

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
begin
  select * into r from encheres.rooms where code = v_code for update;
  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  v_seat := p_seat;
  if v_seat is null or v_seat not in (0, 1) then
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
    -- Skipping a card nobody has bid on costs one of the player's passes;
    -- letting the other player have a card they bid on is free.
    if r.high_bidder is null then
      if not encheres.can_pass(v_code, v_seat) then raise exception 'NO_PASSES_LEFT'; end if;
      update encheres.room_players set passes = passes + 1 where room_code = v_code and seat = v_seat;
    end if;
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

  return encheres.room_view(v_code, p_seat);
end;
$$;

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

create or replace function encheres.bot_choice(
  p_code text,
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
  if not found or r.bot_seat is null or r.status <> 'playing' then
    return null;
  end if;
  if r.phase = 'draw' then
    return jsonb_build_object('a', 'draw', 'v', null);
  elsif r.phase = 'reveal' then
    return jsonb_build_object('a', 'next', 'v', null);
  end if;

  v_me := r.bot_seat;
  v_rival := 1 - v_me;
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
  v_rival_out := r.passed[v_rival + 1] or v_rival_slots <= 0 or v_rival_budget < r.min_bid;

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

-- As in 0010, and a move the player makes themselves clears their time-outs.
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
begin
  if not exists (select 1 from encheres.rooms where code = v_code) then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  v_seat := encheres.seat_of(v_code, p_token);
  if v_seat is null then
    raise exception 'NOT_IN_ROOM';
  end if;
  perform encheres.touch(v_code, v_seat);
  update encheres.room_players set strikes = 0
   where room_code = v_code and seat = v_seat and strikes <> 0;
  return encheres.play_as(v_code, v_seat, p_action, p_amount);
end;
$$;

-- Rooms already playing keep the deck they were dealt; give them a scale.
update encheres.rooms set scale = encheres.scale_of(pool) where scale is null;

revoke all on all functions in schema encheres from public;

notify pgrst, 'reload schema';
