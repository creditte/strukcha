ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS billing_exempt boolean NOT NULL DEFAULT false;

UPDATE public.tenants SET billing_exempt = true, unlimited_structures = true
WHERE id = 'f0e4888d-3d0c-4f70-8890-b6f202a380f1';

CREATE OR REPLACE FUNCTION public.tenant_has_unlimited_structures(_tenant_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT unlimited_structures OR billing_exempt FROM public.tenants WHERE id = _tenant_id), false);
$function$;

CREATE OR REPLACE FUNCTION public.tenant_structure_capacity(_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _count int;
  _limit int;
  _access boolean;
  _unlimited boolean;
  _exempt boolean;
  _enforced boolean;
BEGIN
  SELECT diagram_count, diagram_limit, access_enabled, unlimited_structures, billing_exempt
  INTO _count, _limit, _access, _unlimited, _exempt
  FROM public.tenants WHERE id = _tenant_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  _enforced := public.is_billing_enforcement_enabled();
  _unlimited := coalesce(_unlimited, false) OR coalesce(_exempt, false);

  RETURN jsonb_build_object(
    'found', true,
    'enforced', _enforced,
    'accessEnabled', coalesce(_exempt, false) OR coalesce(_access, false),
    'unlimited', _unlimited,
    'billingExempt', coalesce(_exempt, false),
    'used', coalesce(_count, 0),
    'limit', _limit,
    'remaining', CASE
      WHEN _enforced IS NOT TRUE OR _unlimited OR _limit IS NULL THEN NULL
      ELSE greatest(_limit - coalesce(_count, 0), 0)
    END
  );
END;
$function$;

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
  _exempt boolean;
BEGIN
  IF NEW.is_scenario = true THEN
    RETURN NEW;
  END IF;

  IF public.is_billing_enforcement_enabled() = false THEN
    RETURN NEW;
  END IF;

  SELECT diagram_count, diagram_limit, access_enabled, unlimited_structures, billing_exempt
  INTO _count, _limit, _access, _unlimited, _exempt
  FROM public.tenants
  WHERE id = NEW.tenant_id;

  IF _exempt IS TRUE THEN
    RETURN NEW;
  END IF;

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
  _exempt boolean;
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

  SELECT diagram_count, diagram_limit, access_enabled, unlimited_structures, billing_exempt
  INTO _count, _limit, _access, _unlimited, _exempt
  FROM public.tenants
  WHERE id = NEW.tenant_id;

  IF _exempt IS TRUE THEN
    RETURN NEW;
  END IF;

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