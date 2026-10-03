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
    SELECT * INTO _tu FROM public.tenant_users
    WHERE lower(email) = lower(NEW.email)
      AND status IN ('invited', 'active')
    ORDER BY created_at DESC LIMIT 1;

    IF _tu IS NOT NULL THEN
      _tenant_id := _tu.tenant_id;
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

      UPDATE public.tenant_users SET
        auth_user_id = NEW.id,
        accepted_at  = COALESCE(_tu.accepted_at, now()),
        status       = 'active'
      WHERE id = _tu.id;

      RETURN NEW;
    END IF;

    -- No invitation: join no firm. The old creditte fallback let any public
    -- sign-up read that firm's data. Self-service and Xero sign-up create
    -- their own tenant, profile and role afterwards.
    RETURN NEW;
  END IF;

  -- Invitation path: link a matching tenant_users record (catch-all).
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