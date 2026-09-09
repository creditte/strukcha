ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS unlimited_structures boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.tenant_has_unlimited_structures(_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT unlimited_structures FROM public.tenants WHERE id = _tenant_id), false);
$function$;

GRANT EXECUTE ON FUNCTION public.tenant_has_unlimited_structures(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.validate_diagram_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _count int;
  _limit int;
  _access boolean;
  _unlimited boolean;
BEGIN
  IF NEW.is_scenario = true THEN
    RETURN NEW;
  END IF;

  IF public.is_billing_enforcement_enabled() = false THEN
    RETURN NEW;
  END IF;

  SELECT diagram_count, diagram_limit, access_enabled, unlimited_structures
  INTO _count, _limit, _access, _unlimited
  FROM public.tenants
  WHERE id = NEW.tenant_id;

  IF _access IS NOT TRUE THEN
    RAISE EXCEPTION 'Subscription inactive. Please activate your subscription to create structures.';
  END IF;

  IF _unlimited IS TRUE THEN
    RETURN NEW;
  END IF;

  IF _limit IS NOT NULL AND _count >= _limit THEN
    RAISE EXCEPTION 'Diagram limit reached. Your workspace can have a maximum of % active structures.', _limit;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.validate_diagram_limit_on_restore()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _count int;
  _limit int;
  _access boolean;
  _unlimited boolean;
  _was_inactive boolean;
  _is_active boolean;
BEGIN
  IF NEW.is_scenario = true THEN
    RETURN NEW;
  END IF;

  IF public.is_billing_enforcement_enabled() = false THEN
    RETURN NEW;
  END IF;

  _was_inactive := (OLD.archived_at IS NOT NULL OR OLD.deleted_at IS NOT NULL);
  _is_active    := (NEW.archived_at IS NULL AND NEW.deleted_at IS NULL);

  IF NOT (_was_inactive AND _is_active) THEN
    RETURN NEW;
  END IF;

  SELECT diagram_count, diagram_limit, access_enabled, unlimited_structures
  INTO _count, _limit, _access, _unlimited
  FROM public.tenants
  WHERE id = NEW.tenant_id;

  IF _access IS NOT TRUE THEN
    RAISE EXCEPTION 'Subscription inactive. Please activate your subscription to restore structures.';
  END IF;

  IF _unlimited IS TRUE THEN
    RETURN NEW;
  END IF;

  IF _limit IS NOT NULL AND _count >= _limit THEN
    RAISE EXCEPTION 'Diagram limit reached. Your workspace can have a maximum of % active structures.', _limit;
  END IF;

  RETURN NEW;
END;
$function$;
