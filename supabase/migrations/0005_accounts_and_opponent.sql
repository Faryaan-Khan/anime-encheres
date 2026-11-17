-- Enchères Animés — saved accounts and the computer opponent on the server
--
-- Run after 0004. Idempotent.
--
-- Accounts. A profile can now be opened from several devices. A device is
-- attached to a profile either with a recovery code (no third party needed)
-- or by signing in with Google once (Supabase Auth). After that the device
-- token is the identity, as before: no session is kept in the browser.
--
-- Computer opponent. When nobody is looking for a quick match, the database
-- itself seats an opponent and plays its moves. The player's browser only
-- polls, exactly as it does against a person, so a result against the
-- computer can be trusted like any other and counts for trophies at every
-- rank. Its strength follows the player's trophies. The client-reported
-- "practice" results of 0003 are removed.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- Switches that can be changed without a migration, for example:
--   update encheres.config set value = 'false' where key = 'opponent_enabled';
create table if not exists encheres.config (
  key   text primary key,
  value jsonb not null
);
insert into encheres.config (key, value) values
  ('opponent_enabled', 'true'),           -- seat the computer when nobody turns up
  ('opponent_after_seconds', '[12, 18]'), -- how long a player waits first (min, max)
  ('opponent_pace', '1')                  -- multiplies the computer's thinking pauses
on conflict (key) do nothing;

-- Extra devices attached to a profile. The device that created a profile is
-- in profiles.token_hash; a row here takes precedence over it.
create table if not exists encheres.devices (
  token_hash text primary key,
  profile    uuid not null references encheres.profiles (id) on delete cascade,
  added_at   timestamptz not null default now()
);
create index if not exists devices_profile_idx on encheres.devices (profile);

alter table encheres.profiles add column if not exists user_id uuid;
alter table encheres.profiles add column if not exists recovery_hash text;
create unique index if not exists profiles_user_idx on encheres.profiles (user_id) where user_id is not null;
create unique index if not exists profiles_recovery_idx on encheres.profiles (recovery_hash) where recovery_hash is not null;

-- The seat, secret token and skill (0 to 1) of the computer, when it plays.
alter table encheres.rooms add column if not exists bot_seat smallint check (bot_seat in (0, 1));
alter table encheres.rooms add column if not exists bot_token text;
alter table encheres.rooms add column if not exists bot_skill double precision;
alter table encheres.matches add column if not exists opponent_skill double precision;

alter table encheres.config enable row level security;
alter table encheres.devices enable row level security;
revoke all on all tables in schema encheres from public;

-- ---------------------------------------------------------------------------
-- Small helpers
-- ---------------------------------------------------------------------------

create or replace function encheres.setting(p_key text)
returns jsonb language sql stable set search_path = '' as $$
  select value from encheres.config where key = p_key;
$$;

-- A number in [0, 1) derived from a text. The same text always gives the same
-- number, so the computer's choices can be replayed, but they depend on a
-- secret (the opponent's token) and cannot be predicted by a player.
create or replace function encheres.unit(p_text text)
returns double precision language sql immutable set search_path = '' as $$
  select (('x' || substr(encode(sha256(convert_to(p_text, 'UTF8')), 'hex'), 1, 8))::bit(32)::bigint)
         / 4294967296::double precision;
$$;

-- The signed-in Supabase user of this request, if any.
create or replace function encheres.auth_uid()
returns uuid language plpgsql stable set search_path = '' as $$
begin
  return nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid;
exception when others then
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------

-- The profile a device opens: the one it was attached to, else its own.
create or replace function encheres.profile_id_of(p_hash text)
returns uuid language sql stable set search_path = '' as $$
  select coalesce(
    (select d.profile from encheres.devices d where d.token_hash = p_hash),
    (select p.id from encheres.profiles p where p.token_hash = p_hash)
  );
$$;

-- As in 0003, but a device attached to another profile gets that profile.
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
    return p;
  end if;
  insert into encheres.profiles as existing (token_hash, name)
  values (p_hash, coalesce(p_name, 'Player'))
  on conflict (token_hash) do update
    set name = coalesce(p_name, existing.name)
  returning * into p;
  return p;
end;
$$;

-- Attaches a device to a profile.
create or replace function encheres.attach_device(p_hash text, p_profile uuid)
returns void language plpgsql set search_path = '' as $$
begin
  if encheres.profile_id_of(p_hash) is distinct from p_profile then
    insert into encheres.devices (token_hash, profile) values (p_hash, p_profile)
    on conflict (token_hash) do update set profile = excluded.profile, added_at = now();
  end if;
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
begin
  select coalesce(jsonb_agg(item order by finished_at desc), '[]'::jsonb) into v_recent
    from (
      select m.finished_at,
             jsonb_build_object(
               'at', m.finished_at,
               'kind', m.kind,
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

  return jsonb_build_object(
    'id', p.id,
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
    'weekGain', case when p.week = encheres.current_week() then p.week_gain else 0 end,
    'rank', v_rank,
    'players', v_players,
    'saved', p.user_id is not null,
    'hasCode', p.recovery_hash is not null,
    'recent', v_recent
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- The computer opponent: how it bids
-- ---------------------------------------------------------------------------
--
-- A port of the rule-based player in src/bot/bot.ts (`byRules`). A test plays
-- whole games and checks that this function and the TypeScript one choose the
-- same action at every step, given the same random numbers.
--
-- It plays fair: when the player drew the card, the functions below never
-- read it. They use what a person in that seat could see: the pool, the cards
-- already revealed, both budgets and teams, and the bids so far.

create or replace function encheres.strength(p_power integer)
returns double precision language sql immutable set search_path = '' as $$
  select case when p_power > 0 then power(2::double precision, p_power / 2.5::double precision)
              else 0::double precision end;
$$;

-- The style for a skill between 0 (beginner) and 1 (expert). Mirrors
-- `styleForSkill`. A beginner is timid with cards it has seen and reckless
-- with cards it has not; an expert is sound on both and counts the cards left.
create or replace function encheres.bot_style(
  p_skill double precision,
  out counts_cards boolean,
  out noise double precision,
  out bluff_chance double precision,
  out rival_bluff double precision,
  out greed double precision,
  out nerve double precision
)
language plpgsql immutable set search_path = '' as $$
declare
  s double precision := least(1::double precision, greatest(0::double precision, coalesce(p_skill, 0.5)));
begin
  counts_cards := s >= 0.7;
  noise := 0.45::double precision - 0.4::double precision * s;
  bluff_chance := 0.15;
  rival_bluff := 0.25;
  greed := case when s >= 0.5 then 1::double precision else 0.4::double precision + 1.2::double precision * s end;
  nerve := case when s <= 0.5 then 2.5::double precision - 3.2::double precision * s
                else 0.9::double precision - 1.2::double precision * (s - 0.5::double precision) end;
end;
$$;

-- What the cards still to come mean for a player with `p_slots` open slots:
-- the strength a card must reach to deserve a slot, and the combined strength
-- the player can expect from the rest of the game. Mirrors `valuer`.
create or replace function encheres.bot_outlook(
  p_strengths double precision[],   -- strongest first
  p_presence double precision,      -- chance that any one of them is still in the deck
  p_slots integer,
  out threshold double precision,
  out alternatives double precision
)
language plpgsql immutable set search_path = '' as $$
declare
  n integer := coalesce(array_length(p_strengths, 1), 0);
  v_reach double precision := p_presence * 0.5::double precision;
  v_index integer;
  v_expected double precision := 0;
  v_future double precision := 0;
  v_part double precision;
begin
  threshold := 0;
  alternatives := 0;
  if p_slots <= 0 then
    return;
  end if;
  if v_reach > 0 then
    v_index := ceil(p_slots / v_reach)::integer - 1;
    if v_index < n then
      threshold := p_strengths[v_index + 1];
    end if;
  end if;
  for i in 1 .. n loop
    exit when v_expected >= p_slots;
    v_part := least(p_presence, p_slots - v_expected);
    v_expected := v_expected + v_part;
    v_future := v_future + v_part * p_strengths[i];
  end loop;
  alternatives := 0.5::double precision * v_future;
end;
$$;

-- What a card of this strength is worth to a player: the share of the budget
-- that its strength represents among everything they could still add.
create or replace function encheres.bot_worth(
  p_budget integer,
  p_slots integer,
  p_strength double precision,
  p_threshold double precision,
  p_alternatives double precision
)
returns double precision language sql immutable set search_path = '' as $$
  select case
           when p_slots <= 0 or p_budget <= 0 or p_strength < p_threshold then 0::double precision
           else p_budget::double precision * (p_strength / (p_strength + p_alternatives))
         end;
$$;

-- The computer's move in a room, as {"a": action, "v": amount}. The three
-- numbers in [0, 1) stand for its mood: valuation error, bluff, raise size.
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
  v_pass constant jsonb := jsonb_build_object('a', 'pass', 'v', null);
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

-- ---------------------------------------------------------------------------
-- The computer opponent: when it sits down and when it moves
-- ---------------------------------------------------------------------------

-- True once a waiting player has waited long enough for the computer to join.
create or replace function encheres.opponent_due(p_code text, p_waited numeric)
returns boolean language sql stable set search_path = '' as $$
  select coalesce(encheres.setting('opponent_enabled') = 'true'::jsonb, false)
     and p_waited >= (encheres.setting('opponent_after_seconds') ->> 0)::numeric
                     + encheres.unit('wait:' || p_code)::numeric
                       * ((encheres.setting('opponent_after_seconds') ->> 1)::numeric
                          - (encheres.setting('opponent_after_seconds') ->> 0)::numeric);
$$;

-- An ordinary player name, sometimes with the digits or prefix people add.
create or replace function encheres.opponent_name(p_avoid text)
returns text language plpgsql volatile set search_path = '' as $$
declare
  v_names constant text[] := array[
    'Rayan', 'Lina', 'Kenji', 'Sami', 'Noa', 'Akira', 'Mehdi', 'Yuna', 'Tom', 'Ines', 'Leo', 'Sora',
    'Hugo', 'Nina', 'Ilyes', 'Maya', 'Enzo', 'Sarah', 'Adam', 'Jade', 'Nassim', 'Lea', 'Yanis', 'Emma'];
  v_base text;
  v_kind double precision;
  v_name text;
begin
  for attempt in 1 .. 20 loop
    v_base := v_names[1 + floor(random() * array_length(v_names, 1))::integer];
    v_kind := random();
    v_name := case
                when v_kind < 0.45 then v_base
                when v_kind < 0.8 then v_base || (10 + floor(random() * 90))::integer
                when v_kind < 0.9 then lower(v_base) || '_' || (1 + floor(random() * 9))::integer
                else 'x' || v_base
              end;
    if lower(v_name) <> lower(btrim(coalesce(p_avoid, ''))) then
      return v_name;
    end if;
  end loop;
  return 'Player2';
end;
$$;

-- Seats the computer in a waiting room and starts the game. Its strength
-- follows the player's trophies, with a little variety from game to game.
-- The caller holds the matchmaking lock.
create or replace function encheres.seat_opponent(p_code text, p_trophies integer, p_avoid text)
returns void language plpgsql set search_path = '' as $$
declare
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  insert into encheres.room_players (room_code, seat, token_hash, name, budget)
  select p_code, 1, encheres.token_hash(v_token), encheres.opponent_name(p_avoid), r.budget
    from encheres.rooms r where r.code = p_code;
  update encheres.rooms
     set bot_seat = 1,
         bot_token = v_token,
         bot_skill = least(1::double precision, greatest(0::double precision,
                       coalesce(p_trophies, 0) / 1200::double precision + (random() * 0.2 - 0.1)))
   where code = p_code;
  perform encheres.begin_game(p_code);
end;
$$;

-- Lets the computer act in a room if it is its move and it has "thought" long
-- enough. Called whenever the player's device asks for the room, which it
-- does every few seconds: the computer needs no clock of its own.
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
begin
  select * into r from encheres.rooms where code = p_code for update;
  if not found or r.bot_seat is null or r.status <> 'playing' then
    return;
  end if;
  v_actor := case r.phase when 'draw' then r.drawer when 'bidding' then r.turn else null end;
  v_idle := extract(epoch from (now() - r.updated_at));

  -- The player ran out of time: against a person the rival would claim the
  -- win, here the room does it itself.
  if v_actor is not null and v_actor <> r.bot_seat then
    if v_idle >= encheres.turn_seconds() + 5 then
      perform encheres.end_by_forfeit(p_code, v_actor);
    end if;
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

  begin
    v_choice := encheres.bot_choice(
      p_code,
      encheres.unit('noise:' || r.bot_token || ':' || r.round),
      encheres.unit('bluff:' || r.bot_token || ':' || r.round),
      encheres.unit('jump:' || r.bot_token || ':' || r.version));
    perform public.play(p_code, r.bot_token, v_choice ->> 'a', (v_choice ->> 'v')::integer);
  exception when others then
    -- Never leave the player stuck: fall back to the simplest legal move.
    perform public.play(p_code, r.bot_token,
                        case r.phase when 'draw' then 'draw' when 'reveal' then 'next' else 'pass' end, null);
  end;
end;
$$;

-- A game against the computer that the player left is lost by the player.
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
    perform encheres.end_by_forfeit(v_room.code, v_room.seat);
  end loop;
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
begin
  select * into r from encheres.rooms where code = p_code;
  if not found or r.settled or r.status <> 'finished' then
    return;
  end if;
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
    v_delta := case
                 when v_winner is null then 0
                 when v_winner = v_human then encheres.win_gain(fh.trophies, fh.trophies)
                 else -least(fh.trophies, encheres.loss_cost(fh.trophies, fh.trophies))
               end;
    v_total := encheres.apply_result(
      fh.id, case when v_winner is null then 'tie' when v_winner = v_human then 'win' else 'loss' end,
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
    if v_winner = 0 then
      v_delta0 := encheres.win_gain(f0.trophies, f1.trophies);
      v_delta1 := -least(f1.trophies, encheres.loss_cost(f1.trophies, f0.trophies));
    elsif v_winner = 1 then
      v_delta1 := encheres.win_gain(f1.trophies, f0.trophies);
      v_delta0 := -least(f0.trophies, encheres.loss_cost(f0.trophies, f1.trophies));
    end if;
    v_total0 := encheres.apply_result(
      f0.id, case when v_winner is null then 'tie' when v_winner = 0 then 'win' else 'loss' end,
      v_delta0, r.forfeit = 0);
    v_total1 := encheres.apply_result(
      f1.id, case when v_winner is null then 'tie' when v_winner = 1 then 'win' else 'loss' end,
      v_delta1, r.forfeit = 1);
  else
    -- Private rooms are recorded but never move trophies.
    v_id0 := encheres.profile_id_of(s0.token_hash);
    v_id1 := encheres.profile_id_of(s1.token_hash);
  end if;

  insert into encheres.matches
    (kind, room_code, profile0, profile1, names, teams, powers, winner, forfeit, deltas, settings, history, log,
     opponent_skill)
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
    r.bot_skill
  );

  update encheres.rooms
     set settled = true,
         result = jsonb_build_object(
           'winner', v_winner,
           'power', jsonb_build_array(round(v_power0::numeric, 1), round(v_power1::numeric, 1)),
           'deltas', case when r.matched then jsonb_build_array(v_delta0, v_delta1) else null end,
           'trophies', case when r.matched then jsonb_build_array(v_total0, v_total1) else null end
         )
   where code = p_code;
end;
$$;

-- ---------------------------------------------------------------------------
-- Public API
-- ---------------------------------------------------------------------------

-- As in 0001, and gives the computer its turn when it plays in this room.
create or replace function public.get_room(p_code text, p_token text)
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
  perform encheres.bot_step(v_code);
  return encheres.room_view(v_code, v_seat);
end;
$$;

create or replace function public.find_match(
  p_token text,
  p_name text,
  p_budget integer,
  p_team_size integer,
  p_min_bid integer,
  p_increment integer,
  p_pool text[],
  p_code text default null
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
begin
  if p_token is null or char_length(p_token) < 16 or char_length(p_token) > 128 then
    raise exception 'INVALID_INPUT';
  end if;
  v_hash := encheres.token_hash(p_token);

  -- One pairing at a time, so two callers can never both take the same seat.
  perform pg_advisory_xact_lock(hashtext('encheres.find_match'));

  -- Quick matches are ranked: every player has a profile.
  v_me := encheres.profile_for(v_hash, v_name);

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

  -- The waiting player closest in trophies who is still polling. The gap that
  -- is acceptable grows with the time either player has waited, so a close
  -- match is preferred but nobody waits forever.
  select r.code into v_other
    from encheres.rooms r
    join encheres.room_players p on p.room_code = r.code and p.seat = 0
    left join encheres.profiles hp on hp.id = encheres.profile_id_of(p.token_hash)
   where r.matched
     and abs(coalesce(hp.trophies, 0) - v_me.trophies)
         <= 150 + 40 * greatest(v_waited, extract(epoch from (now() - r.created_at)))
     and r.status = 'lobby'
     and r.seen_at > now() - interval '12 seconds'
     and p.token_hash <> v_hash
     and hp.id is distinct from v_me.id
     and (v_mine.code is null or (r.created_at, r.code) < (v_mine.created_at, v_mine.code))
     and (select count(*) from encheres.room_players q where q.room_code = r.code) = 1
   order by abs(coalesce(hp.trophies, 0) - v_me.trophies), r.created_at, r.code
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
      perform encheres.seat_opponent(v_mine.code, v_me.trophies, v_name);
    end if;
    return encheres.room_view(v_mine.code, 0::smallint);
  end if;

  -- Nobody is waiting: wait as the host of a new room.
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

  insert into encheres.rooms (code, budget, team_size, min_bid, increment, pool, matched)
  values (v_code, p_budget, p_team_size, p_min_bid, p_increment, p_pool, true);

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
  return encheres.profile_json(encheres.profile_for(v_hash, null));
end;
$$;

create or replace function public.update_profile(
  p_token text,
  p_name text,
  p_country text,
  p_avatar integer
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
  p encheres.profiles;
begin
  if p_token is null or char_length(p_token) < 16 or char_length(p_token) > 128
     or (v_country is not null and v_country !~ '^[A-Z]{2}$')
     or p_avatar is null or p_avatar < 0 or p_avatar > 11
  then
    raise exception 'INVALID_INPUT';
  end if;
  v_hash := encheres.token_hash(p_token);
  perform encheres.hit('profile:' || v_hash, 60, interval '1 day');
  p := encheres.profile_for(v_hash, v_name);
  update encheres.profiles
     set country = v_country, avatar = p_avatar
   where id = p.id
  returning * into p;
  return encheres.profile_json(p);
end;
$$;

create or replace function public.leaderboard(
  p_token text,
  p_scope text default 'all',
  p_country text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_country text := nullif(upper(btrim(coalesce(p_country, ''))), '');
  v_week date := encheres.current_week();
  v_me encheres.profiles;
  v_rows jsonb;
  v_total integer;
  v_mine jsonb;
begin
  if p_scope not in ('all', 'week') or (v_country is not null and v_country !~ '^[A-Z]{2}$') then
    raise exception 'INVALID_INPUT';
  end if;
  if p_token is not null and char_length(p_token) between 16 and 128 then
    select * into v_me from encheres.profiles
     where id = encheres.profile_id_of(encheres.token_hash(p_token));
  end if;

  with ranked as (
    select p.id, p.name, p.country, p.avatar,
           case when p_scope = 'week' then p.week_gain else p.trophies end as value,
           row_number() over (
             order by case when p_scope = 'week' then p.week_gain else p.trophies end desc, p.updated_at
           ) as rank
      from encheres.profiles p
     where p.games > 0
       and (v_country is null or p.country = v_country)
       and (p_scope = 'all' or (p.week = v_week and p.week_gain > 0))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'rank', rank, 'name', name, 'country', country, 'avatar', avatar, 'value', value,
           'you', id = v_me.id) order by rank) filter (where rank <= 50), '[]'::jsonb),
         count(*),
         (jsonb_agg(jsonb_build_object('rank', rank, 'value', value)) filter (where id = v_me.id)) -> 0
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
     or p_category is null or p_category not in ('idea', 'bug', 'ratings', 'other')
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

-- Gives the caller a new recovery code for their profile and cancels the
-- previous one. Only a hash of the code is kept: it cannot be shown again.
create or replace function public.recovery_code(p_token text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_hash text;
  p encheres.profiles;
  v_bytes bytea;
  v_code text := '';
begin
  if p_token is null or char_length(p_token) < 16 or char_length(p_token) > 128 then
    raise exception 'INVALID_INPUT';
  end if;
  v_hash := encheres.token_hash(p_token);
  perform encheres.hit('code:' || v_hash, 10, interval '1 day');
  p := encheres.profile_for(v_hash, null);

  -- 16 characters from 32: 80 bits, far beyond guessing at the allowed rate.
  v_bytes := sha256(convert_to(
    gen_random_uuid()::text || gen_random_uuid()::text || clock_timestamp()::text, 'UTF8'));
  for i in 0 .. 15 loop
    v_code := v_code || substr(v_alphabet, 1 + get_byte(v_bytes, i) % 32, 1);
  end loop;

  update encheres.profiles set recovery_hash = encheres.token_hash(v_code) where id = p.id;
  return substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4) || '-' || substr(v_code, 9, 4) || '-' || substr(v_code, 13, 4);
end;
$$;

-- Attaches the caller's device to the profile that owns this recovery code and
-- returns that profile, or null if the code is wrong. A wrong code is not an
-- error on purpose: an error would undo the attempt counter below.
create or replace function public.redeem_code(p_token text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_target encheres.profiles;
begin
  if p_token is null or char_length(p_token) < 16 or char_length(p_token) > 128 then
    raise exception 'INVALID_INPUT';
  end if;
  v_hash := encheres.token_hash(p_token);
  perform encheres.hit('redeem:' || v_hash, 8, interval '1 hour');
  perform encheres.hit('redeem-ip:' || encheres.client_key(), 20, interval '1 hour');
  if char_length(v_code) <> 16 then
    return null;
  end if;
  select * into v_target from encheres.profiles where recovery_hash = encheres.token_hash(v_code);
  if not found then
    return null;
  end if;
  perform encheres.attach_device(v_hash, v_target.id);
  return encheres.profile_json(v_target);
end;
$$;

-- Ties the caller's profile to the Supabase user who is signed in, or, if that
-- user already has a profile, attaches this device to it. Called once after
-- signing in; the device token is the identity from then on.
create or replace function public.link_account(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := encheres.auth_uid();
  v_hash text;
  p encheres.profiles;
begin
  if p_token is null or char_length(p_token) < 16 or char_length(p_token) > 128 then
    raise exception 'INVALID_INPUT';
  end if;
  if v_uid is null then
    raise exception 'NOT_ALLOWED';
  end if;
  v_hash := encheres.token_hash(p_token);
  perform encheres.hit('link:' || v_hash, 20, interval '1 day');

  select * into p from encheres.profiles where user_id = v_uid;
  if found then
    perform encheres.attach_device(v_hash, p.id);
    return encheres.profile_json(p);
  end if;

  p := encheres.profile_for(v_hash, null);
  if p.user_id is not null then
    -- This device's profile belongs to someone else's sign-in.
    raise exception 'ALREADY_LINKED';
  end if;
  update encheres.profiles set user_id = v_uid where id = p.id returning * into p;
  return encheres.profile_json(p);
end;
$$;

-- Results reported by the browser are no longer accepted.
drop function if exists public.report_practice(text, text, text[], jsonb);
drop function if exists encheres.practice_below();
drop function if exists encheres.practice_per_day();

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

revoke all on all functions in schema encheres from public;

revoke all on function public.get_room(text, text) from public;
revoke all on function public.find_match(text, text, integer, integer, integer, integer, text[], text) from public;
revoke all on function public.get_profile(text) from public;
revoke all on function public.update_profile(text, text, text, integer) from public;
revoke all on function public.leaderboard(text, text, text) from public;
revoke all on function public.send_feedback(text, text, text, text, text) from public;
revoke all on function public.recovery_code(text) from public;
revoke all on function public.redeem_code(text, text) from public;
revoke all on function public.link_account(text) from public;

grant execute on function public.get_room(text, text) to anon, authenticated;
grant execute on function public.find_match(text, text, integer, integer, integer, integer, text[], text) to anon, authenticated;
grant execute on function public.get_profile(text) to anon, authenticated;
grant execute on function public.update_profile(text, text, text, integer) to anon, authenticated;
grant execute on function public.leaderboard(text, text, text) to anon, authenticated;
grant execute on function public.send_feedback(text, text, text, text, text) to anon, authenticated;
grant execute on function public.recovery_code(text) to anon, authenticated;
grant execute on function public.redeem_code(text, text) to anon, authenticated;
grant execute on function public.link_account(text) to authenticated;

notify pgrst, 'reload schema';
