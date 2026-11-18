-- Enchères Animés — the automatic minimum bid, and the old site's passes
--
-- Run after 0012. Idempotent.
--
-- 1. A player out of passes, facing a card nobody has bid on, has to bid. After
--    5 seconds the minimum is bid for them, in every kind of online room and
--    without a strike; they can still bid themselves (any amount) before that.
--    (Offline games do the same in src/screens/LocalGame.tsx.)
--
-- 2. The game moved from anime-encheres.netlify.app to anime-encheres.pages.dev.
--    Netlify cannot publish again until its credits reset, so the old address
--    keeps serving a version that knows nothing about the three-pass limit.
--    Players who come from it may still pass as often as they like, and are not
--    bid for. Drop this once the old address only redirects to the new one.

alter table encheres.room_players add column if not exists old_site boolean not null default false;

create or replace function encheres.auto_bid_seconds()
returns integer language sql immutable set search_path = '' as $$ select 5; $$;

-- True when the current request comes from a page on the old address. Requests
-- through PostgREST carry their headers; anything else (tests, the minute
-- sweep, the computer) is not the old site.
create or replace function encheres.old_client()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'origin', '')
         = 'https://anime-encheres.netlify.app';
$$;

-- As in 0010, and remembers which site the player is on.
create or replace function encheres.touch(p_code text, p_seat smallint)
returns void language sql set search_path = '' as $$
  update encheres.room_players
     set seen_at = now(), old_site = encheres.old_client()
   where room_code = p_code and seat = p_seat;
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
      if not encheres.can_pass(v_code, v_seat) and not encheres.old_client() then
        raise exception 'NO_PASSES_LEFT';
      end if;
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

-- The limit is back on for new games (it was off while only the old site was live).
alter table encheres.rooms alter column pass_limit set default 3;
update encheres.rooms set pass_limit = 3 where pass_limit = 99 and status <> 'playing';

revoke all on all functions in schema encheres from public;

notify pgrst, 'reload schema';
