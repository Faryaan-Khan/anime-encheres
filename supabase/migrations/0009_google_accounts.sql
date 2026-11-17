-- Enchères Animés — Google accounts alongside guest play
--
-- Run after 0008. Idempotent.
--
-- Everyone starts as a guest: a profile tied to the device, as before. A
-- guest can then sign in with Google and choose what happens to the guest
-- profile:
--
--   link   the guest profile becomes the Google account's profile (all
--          progress is kept). If the Google account already has a profile,
--          this device opens that one instead and the guest profile stays
--          behind (it can still be opened with its recovery code, if any).
--   fresh  start a new, empty profile for the Google account; the guest
--          profile is deleted. If the Google account already has a profile,
--          this device simply opens it.
--
-- A guest profile with no games, no sign-in and no recovery code is deleted
-- whenever its device moves to another profile: there is nothing to lose.
--
-- The answer says what happened: linked, created, switched or already.

drop function if exists public.link_account(text);

create or replace function public.link_account(p_token text, p_intent text default 'link')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := encheres.auth_uid();
  v_hash text;
  v_intent text := lower(coalesce(p_intent, 'link'));
  guest encheres.profiles;
  target encheres.profiles;
  v_outcome text;
begin
  if p_token is null or char_length(p_token) < 16 or char_length(p_token) > 128
     or v_intent not in ('link', 'fresh')
  then
    raise exception 'INVALID_INPUT';
  end if;
  if v_uid is null then
    raise exception 'NOT_ALLOWED';
  end if;
  v_hash := encheres.token_hash(p_token);
  perform encheres.hit('link:' || v_hash, 20, interval '1 day');

  guest := encheres.profile_for(v_hash, null);
  select * into target from encheres.profiles where user_id = v_uid;

  if found then
    -- The Google account already has a profile: this device opens it.
    v_outcome := case when target.id = guest.id then 'already' else 'switched' end;
  elsif v_intent = 'link' then
    if guest.user_id is not null then
      -- This device's profile belongs to someone else's sign-in.
      raise exception 'ALREADY_LINKED';
    end if;
    update encheres.profiles set user_id = v_uid where id = guest.id returning * into target;
    v_outcome := 'linked';
  else
    insert into encheres.profiles (token_hash, name, user_id)
    values ('user:' || v_uid::text, 'Player', v_uid)
    returning * into target;
    target := encheres.profile_for(target.token_hash, null); -- gives it a tag
    v_outcome := 'created';
  end if;

  if target.id <> guest.id then
    perform encheres.attach_device(v_hash, target.id);
    -- Drop the guest profile when the player chose to, or when it holds nothing.
    if guest.user_id is null
       and (v_outcome = 'created'
            or (guest.games = 0 and guest.recovery_hash is null))
    then
      delete from encheres.profiles where id = guest.id;
    end if;
  end if;

  select * into target from encheres.profiles where id = target.id;
  return encheres.profile_json(target) || jsonb_build_object('outcome', v_outcome);
end;
$$;

revoke all on function public.link_account(text, text) from public;
grant execute on function public.link_account(text, text) to authenticated;

notify pgrst, 'reload schema';
