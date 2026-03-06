
CREATE OR REPLACE FUNCTION public.link_tenant_user_on_login()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid   uuid := auth.uid();
  _email text;
  _tu    record;
  _current_tenant uuid;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not authenticated'); END IF;

  SELECT email INTO _email FROM auth.users WHERE id = _uid LIMIT 1;
  IF _email IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'no email'); END IF;

  -- Find a matching tenant_users row by email that is not yet linked
  SELECT * INTO _tu FROM public.tenant_users
  WHERE lower(email) = lower(_email)
    AND (auth_user_id IS NULL OR auth_user_id = _uid)
    AND status IN ('invited', 'active')
  ORDER BY last_invited_at DESC NULLS LAST, created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no matching tenant_user row');
  END IF;

  -- Link and activate
  UPDATE public.tenant_users SET
    auth_user_id = _uid,
    accepted_at  = COALESCE(accepted_at, now()),
    status       = 'active',
    updated_at   = now()
  WHERE id = _tu.id
    AND (auth_user_id IS NULL OR auth_user_id = _uid);

  -- Check current profile tenant
  SELECT tenant_id INTO _current_tenant FROM public.profiles WHERE user_id = _uid LIMIT 1;

  IF _current_tenant IS NOT NULL AND _current_tenant != _tu.tenant_id THEN
    -- User moved to a new tenant: update profile and reset onboarding
    UPDATE public.profiles SET
      tenant_id = _tu.tenant_id,
      onboarding_complete = false,
      updated_at = now()
    WHERE user_id = _uid;
  ELSIF _current_tenant IS NULL THEN
    -- No profile yet: create one
    INSERT INTO public.profiles (user_id, tenant_id, full_name, status, onboarding_complete)
    VALUES (_uid, _tu.tenant_id, COALESCE((SELECT raw_user_meta_data->>'full_name' FROM auth.users WHERE id = _uid), ''), 'active', false)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'tenant_user_id', _tu.id,
    'tenant_id', _tu.tenant_id,
    'role', _tu.role
  );
END;
$function$;
