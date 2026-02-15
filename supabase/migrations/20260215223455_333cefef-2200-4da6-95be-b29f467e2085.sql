
-- Add soft-delete column to structures
ALTER TABLE public.structures
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL;

-- Index for efficient filtering
CREATE INDEX IF NOT EXISTS idx_structures_deleted_at ON public.structures (deleted_at) WHERE deleted_at IS NULL;

-- Audit trigger for structure soft-delete (fires on update of deleted_at)
CREATE OR REPLACE FUNCTION public.audit_structure_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.audit_log (tenant_id, user_id, action, entity_type, entity_id, before_state, after_state)
  VALUES (NEW.tenant_id, auth.uid(),
    CASE WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN 'structure_delete'
         WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN 'structure_restore'
         ELSE 'structure_update' END,
    'structure', NEW.id, row_to_json(OLD)::jsonb, row_to_json(NEW)::jsonb);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_audit_structure_update
  AFTER UPDATE ON public.structures
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_structure_update();
