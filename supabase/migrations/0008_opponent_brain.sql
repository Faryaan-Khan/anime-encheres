-- Enchères Animés — a stronger brain for the computer opponent
--
-- Run after 0007. Idempotent.
--
-- From a skill of 0.6 upwards (about 720 trophies in a mode), the computer's
-- bids are decided by the Edge Function "opponent" (supabase/functions/
-- opponent), which runs the look-ahead player of src/bot/bot.ts: for each
-- choice it imagines dozens of ways the game could go on and picks the one
-- that wins most often. In simulation it beats the offline "hard" level about
-- 63% of the time; the rule-based player in SQL is level with it.
--
-- The database asks the function with pg_net (asynchronous HTTP) and a
-- one-time secret. If the function is not deployed, not configured, or does
-- not answer within 6 seconds, the rule-based move of 0005 is played, so the
-- game never waits on it.
--
-- To switch it on after deploying the function:
--   update encheres.config set value = to_jsonb('https://<ref>.supabase.co/functions/v1/opponent'::text)
--    where key = 'opponent_function_url';

do $$
begin
  create extension if not exists pg_net with schema extensions;
exception when others then
  -- Not available (local tests): the rule-based opponent plays every move.
  null;
end;
$$;

alter table encheres.rooms add column if not exists bot_nonce text;
alter table encheres.rooms add column if not exists bot_request_version integer;
alter table encheres.rooms add column if not exists bot_requested_at timestamptz;

insert into encheres.config (key, value) values
  ('opponent_function_url', 'null'),
  ('opponent_lookahead_from', '0.6')
on conflict (key) do nothing;

create or replace function encheres.lookahead_from()
returns double precision language sql stable set search_path = '' as $$
  select coalesce((encheres.setting('opponent_lookahead_from') #>> '{}')::double precision, 0.6);
$$;

-- True when the function is configured and the database can reach it.
create or replace function encheres.lookahead_available()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(jsonb_typeof(encheres.setting('opponent_function_url')) = 'string', false)
     and exists (
       select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'net' and p.proname = 'http_post');
$$;

-- Sends the request. Dynamic SQL, so this file loads where pg_net is absent.
create or replace function encheres.call_opponent(p_code text, p_nonce text)
returns void language plpgsql set search_path = '' as $$
begin
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 8000)'
    using encheres.setting('opponent_function_url') #>> '{}',
          jsonb_build_object('code', p_code, 'nonce', p_nonce),
          jsonb_build_object('Content-Type', 'application/json');
exception when others then
  -- The fallback move will follow.
  null;
end;
$$;

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
    perform public.play(p_code, r.bot_token, v_choice ->> 'a', (v_choice ->> 'v')::integer);
  exception when others then
    -- Never leave the player stuck: fall back to the simplest legal move.
    perform public.play(p_code, r.bot_token,
                        case r.phase when 'draw' then 'draw' when 'reveal' then 'next' else 'pass' end, null);
  end;
end;
$$;

-- What the function gets in exchange for the one-time secret: the computer's
-- view of the room (the same a person in that seat would see), the cards in
-- play, its token to move with, and its skill. Only while it is the
-- computer's turn in the position the secret was issued for.
create or replace function public.opponent_claim(p_code text, p_nonce text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r encheres.rooms;
begin
  if p_nonce is null or char_length(p_nonce) < 32 then
    return null;
  end if;
  select * into r from encheres.rooms where code = upper(btrim(coalesce(p_code, ''))) for update;
  if not found or r.bot_nonce is null or r.bot_nonce <> p_nonce
     or r.bot_request_version is distinct from r.version
     or r.status <> 'playing' or r.phase <> 'bidding' or r.turn <> r.bot_seat
  then
    return null;
  end if;
  update encheres.rooms set bot_nonce = null where code = r.code;
  return jsonb_build_object(
    'view', encheres.room_view(r.code, r.bot_seat),
    'pool', to_jsonb(r.pool),
    'token', r.bot_token,
    'skill', r.bot_skill
  );
end;
$$;

revoke all on all functions in schema encheres from public;
revoke all on function public.opponent_claim(text, text) from public;
grant execute on function public.opponent_claim(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
