
-- Function to count active structures for a tenant
CREATE OR REPLACE FUNCTION public.update_tenant_diagram_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _count int;
BEGIN
  -- Count active (non-deleted, non-scenario) structures for the tenant
  SELECT count(*) INTO _count
  FROM public.structures
  WHERE tenant_id = COALESCE(NEW.tenant_id, OLD.tenant_id)
    AND deleted_at IS NULL
    AND is_scenario = false;

  UPDATE public.tenants
  SET diagram_count = _count
  WHERE id = COALESCE(NEW.tenant_id, OLD.tenant_id);

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Trigger to update diagram_count on insert, update (soft delete/restore), delete
CREATE TRIGGER trg_update_diagram_count
AFTER INSERT OR UPDATE OF deleted_at, is_scenario OR DELETE
ON public.structures
FOR EACH ROW
EXECUTE FUNCTION public.update_tenant_diagram_count();

-- Validation trigger to block structure creation when limit reached
CREATE OR REPLACE FUNCTION public.validate_diagram_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _count int;
  _limit int;
  _access boolean;
BEGIN
  -- Only check on new non-scenario structures
  IF NEW.is_scenario = true THEN
    RETURN NEW;
  END IF;

  SELECT diagram_count, diagram_limit, access_enabled
  INTO _count, _limit, _access
  FROM public.tenants
  WHERE id = NEW.tenant_id;

  IF _access IS NOT TRUE THEN
    RAISE EXCEPTION 'Subscription inactive. Please activate your subscription to create structures.';
  END IF;

  IF _limit IS NOT NULL AND _count >= _limit THEN
    RAISE EXCEPTION 'Diagram limit reached. Your workspace can have a maximum of % active structures.', _limit;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_diagram_limit
BEFORE INSERT
ON public.structures
FOR EACH ROW
EXECUTE FUNCTION public.validate_diagram_limit();
