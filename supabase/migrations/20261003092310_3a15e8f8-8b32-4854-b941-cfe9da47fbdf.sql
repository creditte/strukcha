CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _invitation RECORD;
  _tu RECORD;
  _role app_role;
BEGIN
  -- NOTE: use FOUND, not "record IS NOT NULL" (that is false when any column is null,
  -- e.g. accepted_at / auth_user_id on a pending invite).
  SELECT i.* INTO _invitation
  FROM public.invitations i
  WHERE lower(i.email) = lower(NEW.email)
    AND i.accepted_at IS NULL
    AND i.expires_at > now()
  ORDER BY i.created_at DESC
  LIMIT 1;

  IF FOUND THEN
    UPDATE public.invitations SET accepted_at = now() WHERE id = _invitation.id;
    INSERT INTO public.profiles (user_id, tenant_id, full_name, status)
    VALUES (NEW.id, _invitation.tenant_id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), 'active')
    ON CONFLICT (user_id) DO NOTHING;
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, _invitation.role)
    ON CONFLICT (user_id, role) DO NOTHING;

    SELECT * INTO _tu FROM public.tenant_users
    WHERE lower(email) = lower(NEW.email)
      AND auth_user_id IS NULL
      AND tenant_id = _invitation.tenant_id
      AND status IN ('invited', 'active')
    ORDER BY created_at DESC LIMIT 1;
    IF FOUND THEN
      UPDATE public.tenant_users SET
        auth_user_id = NEW.id,
        accepted_at  = COALESCE(_tu.accepted_at, now()),
        status       = 'active'
      WHERE id = _tu.id;
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO _tu FROM public.tenant_users
  WHERE lower(email) = lower(NEW.email)
    AND auth_user_id IS NULL
    AND status IN ('invited', 'active')
  ORDER BY created_at DESC LIMIT 1;

  IF FOUND THEN
    _role := CASE WHEN _tu.role IN ('owner', 'admin') THEN 'admin'::app_role ELSE 'user'::app_role END;
    INSERT INTO public.profiles (user_id, tenant_id, full_name, status)
    VALUES (NEW.id, _tu.tenant_id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), 'active')
    ON CONFLICT (user_id) DO NOTHING;
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, _role)
    ON CONFLICT (user_id, role) DO NOTHING;
    UPDATE public.tenant_users SET
      auth_user_id = NEW.id,
      accepted_at  = COALESCE(_tu.accepted_at, now()),
      status       = 'active'
    WHERE id = _tu.id;
  END IF;

  -- No invitation: join no firm. Self-service and Xero sign-up create
  -- their own tenant, profile and role afterwards.
  RETURN NEW;
END;
$function$;