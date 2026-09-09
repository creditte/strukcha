CREATE OR REPLACE FUNCTION public.xpm_groups_guard_user_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;
  -- Users may only flip the selection flag.
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.xpm_uuid IS DISTINCT FROM OLD.xpm_uuid
     OR NEW.name IS DISTINCT FROM OLD.name
     OR NEW.member_hash IS DISTINCT FROM OLD.member_hash
     OR NEW.last_synced_at IS DISTINCT FROM OLD.last_synced_at THEN
    RAISE EXCEPTION 'Only the sync selection can be changed on a client group';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS xpm_groups_guard_user_update ON public.xpm_groups;
CREATE TRIGGER xpm_groups_guard_user_update
BEFORE UPDATE ON public.xpm_groups
FOR EACH ROW EXECUTE FUNCTION public.xpm_groups_guard_user_update();

DROP POLICY IF EXISTS "Firm admins can select xpm_groups" ON public.xpm_groups;
CREATE POLICY "Firm admins can select xpm_groups"
ON public.xpm_groups
FOR UPDATE
TO authenticated
USING (
  tenant_id = public.get_user_tenant_id(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.tenant_users tu
    WHERE tu.tenant_id = xpm_groups.tenant_id
      AND tu.auth_user_id = auth.uid()
      AND tu.status = 'active'
      AND tu.role IN ('owner', 'admin')
  )
)
WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

GRANT UPDATE ON public.xpm_groups TO authenticated;