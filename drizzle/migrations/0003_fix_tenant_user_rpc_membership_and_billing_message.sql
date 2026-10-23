-- A: reject callers who are not active owner/admin members of the target firm (NULL role previously slipped past NOT IN).
-- B: fix billing-protection trigger array building and message.

CREATE OR REPLACE FUNCTION public.protect_tenant_billing_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _changed text[] := ARRAY[]::text[];
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF public.is_super_admin() THEN
    RETURN NEW;
  END IF;

  IF NEW.subscription_status   IS DISTINCT FROM OLD.subscription_status   THEN _changed := array_append(_changed, 'subscription_status'); END IF;
  IF NEW.subscription_plan     IS DISTINCT FROM OLD.subscription_plan     THEN _changed := array_append(_changed, 'subscription_plan'); END IF;
  IF NEW.selected_plan         IS DISTINCT FROM OLD.selected_plan         THEN _changed := array_append(_changed, 'selected_plan'); END IF;
  IF NEW.stripe_customer_id    IS DISTINCT FROM OLD.stripe_customer_id    THEN _changed := array_append(_changed, 'stripe_customer_id'); END IF;
  IF NEW.stripe_subscription_id IS DISTINCT FROM OLD.stripe_subscription_id THEN _changed := array_append(_changed, 'stripe_subscription_id'); END IF;
  IF NEW.current_period_start  IS DISTINCT FROM OLD.current_period_start  THEN _changed := array_append(_changed, 'current_period_start'); END IF;
  IF NEW.current_period_end    IS DISTINCT FROM OLD.current_period_end    THEN _changed := array_append(_changed, 'current_period_end'); END IF;
  IF NEW.access_enabled        IS DISTINCT FROM OLD.access_enabled        THEN _changed := array_append(_changed, 'access_enabled'); END IF;
  IF NEW.access_locked_reason  IS DISTINCT FROM OLD.access_locked_reason  THEN _changed := array_append(_changed, 'access_locked_reason'); END IF;
  IF NEW.diagram_limit         IS DISTINCT FROM OLD.diagram_limit         THEN _changed := array_append(_changed, 'diagram_limit'); END IF;
  IF NEW.unlimited_structures  IS DISTINCT FROM OLD.unlimited_structures  THEN _changed := array_append(_changed, 'unlimited_structures'); END IF;
  IF NEW.trial_used_at         IS DISTINCT FROM OLD.trial_used_at         THEN _changed := array_append(_changed, 'trial_used_at'); END IF;
  IF NEW.trial_starts_at       IS DISTINCT FROM OLD.trial_starts_at       THEN _changed := array_append(_changed, 'trial_starts_at'); END IF;
  IF NEW.trial_ends_at         IS DISTINCT FROM OLD.trial_ends_at         THEN _changed := array_append(_changed, 'trial_ends_at'); END IF;
  IF NEW.cancel_at_period_end  IS DISTINCT FROM OLD.cancel_at_period_end  THEN _changed := array_append(_changed, 'cancel_at_period_end'); END IF;
  IF NEW.canceled_at           IS DISTINCT FROM OLD.canceled_at           THEN _changed := array_append(_changed, 'canceled_at'); END IF;
  IF NEW.last_plan_switch_at   IS DISTINCT FROM OLD.last_plan_switch_at   THEN _changed := array_append(_changed, 'last_plan_switch_at'); END IF;
  IF NEW.payment_method_captured IS DISTINCT FROM OLD.payment_method_captured THEN _changed := array_append(_changed, 'payment_method_captured'); END IF;
  IF NEW.payment_setup_completed_at IS DISTINCT FROM OLD.payment_setup_completed_at THEN _changed := array_append(_changed, 'payment_setup_completed_at'); END IF;

  IF array_length(_changed, 1) > 0 THEN
    RAISE EXCEPTION 'Billing fields are managed by the billing system.'
      USING ERRCODE = '42501', DETAIL = 'Attempted: ' || array_to_string(_changed, ', ');
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_change_tenant_user_role(p_tenant_id uuid, p_tenant_user_id uuid, p_new_role text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _actor_id   uuid := auth.uid();
  _actor_role text;
  _target     record;
  _old_role   text;
BEGIN
  SELECT role INTO _actor_role FROM public.tenant_users
  WHERE tenant_id = p_tenant_id AND auth_user_id = _actor_id AND status = 'active';
  IF _actor_role IS NULL OR _actor_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF p_new_role NOT IN ('owner','admin','user') THEN RAISE EXCEPTION 'Invalid role'; END IF;
  IF _actor_role = 'admin' AND p_new_role = 'owner' THEN RAISE EXCEPTION 'Admins cannot assign owner role'; END IF;

  SELECT * INTO _target FROM public.tenant_users WHERE id = p_tenant_user_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'User not found'; END IF;

  _old_role := _target.role;
  UPDATE public.tenant_users SET role = p_new_role WHERE id = p_tenant_user_id;

  INSERT INTO public.tenant_user_audit_log (tenant_id, actor_auth_user_id, action, target_tenant_user_id, target_email, meta)
  VALUES (p_tenant_id, _actor_id, 'role_changed', p_tenant_user_id, _target.email,
    jsonb_build_object('old_role', _old_role, 'new_role', p_new_role));

  RETURN jsonb_build_object('ok', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_disable_tenant_user(p_tenant_id uuid, p_tenant_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _actor_id    uuid := auth.uid();
  _actor_role  text;
  _target      record;
  _owner_count int;
BEGIN
  SELECT role INTO _actor_role FROM public.tenant_users
  WHERE tenant_id = p_tenant_id AND auth_user_id = _actor_id AND status = 'active';
  IF _actor_role IS NULL OR _actor_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  SELECT * INTO _target FROM public.tenant_users WHERE id = p_tenant_user_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'User not found'; END IF;

  IF _target.role = 'owner' THEN
    SELECT COUNT(*) INTO _owner_count FROM public.tenant_users
    WHERE tenant_id = p_tenant_id AND role = 'owner' AND status = 'active';
    IF _owner_count <= 1 THEN RAISE EXCEPTION 'Cannot disable the last owner'; END IF;
  END IF;

  UPDATE public.tenant_users SET status = 'disabled', disabled_at = now() WHERE id = p_tenant_user_id;

  INSERT INTO public.tenant_user_audit_log (tenant_id, actor_auth_user_id, action, target_tenant_user_id, target_email)
  VALUES (p_tenant_id, _actor_id, 'disabled', p_tenant_user_id, _target.email);

  RETURN jsonb_build_object('ok', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_enable_tenant_user(p_tenant_id uuid, p_tenant_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _actor_id   uuid := auth.uid();
  _actor_role text;
  _target     record;
BEGIN
  SELECT role INTO _actor_role FROM public.tenant_users
  WHERE tenant_id = p_tenant_id AND auth_user_id = _actor_id AND status = 'active';
  IF _actor_role IS NULL OR _actor_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  SELECT * INTO _target FROM public.tenant_users WHERE id = p_tenant_user_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'User not found'; END IF;
  IF _target.status = 'deleted' THEN RAISE EXCEPTION 'Cannot enable a deleted user. Restore first.'; END IF;

  UPDATE public.tenant_users SET status = 'active', disabled_at = NULL WHERE id = p_tenant_user_id;

  INSERT INTO public.tenant_user_audit_log (tenant_id, actor_auth_user_id, action, target_tenant_user_id, target_email)
  VALUES (p_tenant_id, _actor_id, 'enabled', p_tenant_user_id, _target.email);

  RETURN jsonb_build_object('ok', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_reinvite_tenant_user(p_tenant_id uuid, p_tenant_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _actor_id   uuid := auth.uid();
  _actor_role text;
  _target     record;
BEGIN
  SELECT role INTO _actor_role FROM public.tenant_users
  WHERE tenant_id = p_tenant_id AND auth_user_id = _actor_id AND status = 'active';
  IF _actor_role IS NULL OR _actor_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  SELECT * INTO _target FROM public.tenant_users WHERE id = p_tenant_user_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'User not found'; END IF;
  IF _target.status = 'deleted' THEN RAISE EXCEPTION 'Cannot reinvite a deleted user. Restore first.'; END IF;

  UPDATE public.tenant_users SET status = 'invited', last_invited_at = now(), invited_by = _actor_id
  WHERE id = p_tenant_user_id;

  INSERT INTO public.tenant_user_audit_log (tenant_id, actor_auth_user_id, action, target_tenant_user_id, target_email)
  VALUES (p_tenant_id, _actor_id, 'reinvited', p_tenant_user_id, _target.email);

  RETURN jsonb_build_object('email', _target.email);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_restore_tenant_user(p_tenant_id uuid, p_tenant_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _actor_id   uuid := auth.uid();
  _actor_role text;
  _target     record;
BEGIN
  SELECT role INTO _actor_role FROM public.tenant_users
  WHERE tenant_id = p_tenant_id AND auth_user_id = _actor_id AND status = 'active';
  IF _actor_role IS NULL OR _actor_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  SELECT * INTO _target FROM public.tenant_users WHERE id = p_tenant_user_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'User not found'; END IF;
  IF _target.status != 'deleted' THEN RAISE EXCEPTION 'User is not deleted'; END IF;

  UPDATE public.tenant_users SET
    status          = 'invited',
    deleted_at      = NULL,
    disabled_at     = NULL,
    last_invited_at = now(),
    invited_by      = _actor_id
  WHERE id = p_tenant_user_id;

  INSERT INTO public.tenant_user_audit_log (tenant_id, actor_auth_user_id, action, target_tenant_user_id, target_email)
  VALUES (p_tenant_id, _actor_id, 'restored', p_tenant_user_id, _target.email);

  RETURN jsonb_build_object('email', _target.email);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_soft_delete_tenant_user(p_tenant_id uuid, p_tenant_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _actor_id    uuid := auth.uid();
  _actor_role  text;
  _target      record;
  _owner_count int;
BEGIN
  SELECT role INTO _actor_role FROM public.tenant_users
  WHERE tenant_id = p_tenant_id AND auth_user_id = _actor_id AND status = 'active';
  IF _actor_role IS NULL OR _actor_role <> 'owner' THEN RAISE EXCEPTION 'Only owners can delete users'; END IF;

  SELECT * INTO _target FROM public.tenant_users WHERE id = p_tenant_user_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'User not found'; END IF;

  IF _target.role = 'owner' THEN
    SELECT COUNT(*) INTO _owner_count FROM public.tenant_users
    WHERE tenant_id = p_tenant_id AND role = 'owner' AND status NOT IN ('deleted');
    IF _owner_count <= 1 THEN RAISE EXCEPTION 'Cannot delete the last owner'; END IF;
  END IF;

  IF _target.auth_user_id = _actor_id THEN
    SELECT COUNT(*) INTO _owner_count FROM public.tenant_users
    WHERE tenant_id = p_tenant_id AND role = 'owner' AND status = 'active' AND auth_user_id != _actor_id;
    IF _owner_count = 0 THEN RAISE EXCEPTION 'Transfer ownership before deleting yourself'; END IF;
  END IF;

  UPDATE public.tenant_users SET status = 'deleted', deleted_at = now() WHERE id = p_tenant_user_id;

  INSERT INTO public.tenant_user_audit_log (tenant_id, actor_auth_user_id, action, target_tenant_user_id, target_email)
  VALUES (p_tenant_id, _actor_id, 'deleted', p_tenant_user_id, _target.email);

  RETURN jsonb_build_object('ok', true);
END;
$function$;