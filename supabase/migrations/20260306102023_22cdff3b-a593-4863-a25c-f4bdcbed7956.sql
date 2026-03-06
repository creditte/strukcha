
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant_id UUID;
  _invitation RECORD;
  _role app_role;
  _tu RECORD;
BEGIN
  -- 1. Check invitations table first
  SELECT i.*, i.role as inv_role INTO _invitation
  FROM public.invitations i
  WHERE i.email = NEW.email
    AND i.accepted_at IS NULL
    AND i.expires_at > now()
  ORDER BY i.created_at DESC
  LIMIT 1;

  IF _invitation IS NOT NULL THEN
    _tenant_id := _invitation.tenant_id;
    _role := _invitation.inv_role;
    UPDATE public.invitations SET accepted_at = now() WHERE id = _invitation.id;
    INSERT INTO public.profiles (user_id, tenant_id, full_name, status)
    VALUES (NEW.id, _tenant_id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), 'active')
    ON CONFLICT (user_id) DO NOTHING;
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, _role)
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    -- 2. Check tenant_users table (for super admin invites)
    SELECT * INTO _tu FROM public.tenant_users
    WHERE lower(email) = lower(NEW.email)
      AND status IN ('invited', 'active')
    ORDER BY created_at DESC LIMIT 1;

    IF _tu IS NOT NULL THEN
      _tenant_id := _tu.tenant_id;
      -- Map tenant_users role to app_role
      IF _tu.role = 'owner' OR _tu.role = 'admin' THEN
        _role := 'admin'::app_role;
      ELSE
        _role := 'user'::app_role;
      END IF;

      INSERT INTO public.profiles (user_id, tenant_id, full_name, status)
      VALUES (NEW.id, _tenant_id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), 'active')
      ON CONFLICT (user_id) DO NOTHING;
      INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, _role)
      ON CONFLICT (user_id, role) DO NOTHING;

      -- Link tenant_users record
      UPDATE public.tenant_users SET
        auth_user_id = NEW.id,
        accepted_at  = COALESCE(_tu.accepted_at, now()),
        status       = 'active'
      WHERE id = _tu.id;

      RETURN NEW;
    END IF;

    -- 3. Fallback to creditte tenant
    SELECT id INTO _tenant_id FROM public.tenants WHERE name = 'creditte' LIMIT 1;
    INSERT INTO public.profiles (user_id, tenant_id, full_name, status)
    VALUES (NEW.id, _tenant_id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), 'active')
    ON CONFLICT (user_id) DO NOTHING;
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  -- Link tenant_users record if matching email exists (catch-all)
  SELECT * INTO _tu FROM public.tenant_users
  WHERE lower(email) = lower(NEW.email)
    AND (auth_user_id IS NULL)
    AND status IN ('invited', 'active')
  ORDER BY created_at DESC LIMIT 1;

  IF _tu IS NOT NULL THEN
    UPDATE public.tenant_users SET
      auth_user_id = NEW.id,
      accepted_at  = COALESCE(_tu.accepted_at, now()),
      status       = 'active'
    WHERE id = _tu.id;
  END IF;

  RETURN NEW;
END;
$function$;
