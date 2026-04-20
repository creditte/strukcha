
-- 1. Drop and re-add foreign keys with CASCADE for all tables referencing tenants

-- tenant_users
ALTER TABLE public.tenant_users DROP CONSTRAINT IF EXISTS tenant_users_tenant_id_fkey;
ALTER TABLE public.tenant_users ADD CONSTRAINT tenant_users_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

-- entities
ALTER TABLE public.entities DROP CONSTRAINT IF EXISTS entities_tenant_id_fkey;
ALTER TABLE public.entities ADD CONSTRAINT entities_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

-- relationships
ALTER TABLE public.relationships DROP CONSTRAINT IF EXISTS relationships_tenant_id_fkey;
ALTER TABLE public.relationships ADD CONSTRAINT relationships_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

-- Also cascade relationships when entities are deleted
ALTER TABLE public.relationships DROP CONSTRAINT IF EXISTS relationships_from_entity_id_fkey;
ALTER TABLE public.relationships ADD CONSTRAINT relationships_from_entity_id_fkey
  FOREIGN KEY (from_entity_id) REFERENCES public.entities(id) ON DELETE CASCADE;

ALTER TABLE public.relationships DROP CONSTRAINT IF EXISTS relationships_to_entity_id_fkey;
ALTER TABLE public.relationships ADD CONSTRAINT relationships_to_entity_id_fkey
  FOREIGN KEY (to_entity_id) REFERENCES public.entities(id) ON DELETE CASCADE;

-- structures
ALTER TABLE public.structures DROP CONSTRAINT IF EXISTS structures_tenant_id_fkey;
ALTER TABLE public.structures ADD CONSTRAINT structures_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

-- structure_entities (cascade from structures and entities)
ALTER TABLE public.structure_entities DROP CONSTRAINT IF EXISTS structure_entities_structure_id_fkey;
ALTER TABLE public.structure_entities ADD CONSTRAINT structure_entities_structure_id_fkey
  FOREIGN KEY (structure_id) REFERENCES public.structures(id) ON DELETE CASCADE;

ALTER TABLE public.structure_entities DROP CONSTRAINT IF EXISTS structure_entities_entity_id_fkey;
ALTER TABLE public.structure_entities ADD CONSTRAINT structure_entities_entity_id_fkey
  FOREIGN KEY (entity_id) REFERENCES public.entities(id) ON DELETE CASCADE;

-- structure_relationships (cascade from structures and relationships)
ALTER TABLE public.structure_relationships DROP CONSTRAINT IF EXISTS structure_relationships_structure_id_fkey;
ALTER TABLE public.structure_relationships ADD CONSTRAINT structure_relationships_structure_id_fkey
  FOREIGN KEY (structure_id) REFERENCES public.structures(id) ON DELETE CASCADE;

ALTER TABLE public.structure_relationships DROP CONSTRAINT IF EXISTS structure_relationships_relationship_id_fkey;
ALTER TABLE public.structure_relationships ADD CONSTRAINT structure_relationships_relationship_id_fkey
  FOREIGN KEY (relationship_id) REFERENCES public.relationships(id) ON DELETE CASCADE;

-- structure_snapshots
ALTER TABLE public.structure_snapshots DROP CONSTRAINT IF EXISTS structure_snapshots_tenant_id_fkey;
ALTER TABLE public.structure_snapshots ADD CONSTRAINT structure_snapshots_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE public.structure_snapshots DROP CONSTRAINT IF EXISTS structure_snapshots_structure_id_fkey;
ALTER TABLE public.structure_snapshots ADD CONSTRAINT structure_snapshots_structure_id_fkey
  FOREIGN KEY (structure_id) REFERENCES public.structures(id) ON DELETE CASCADE;

-- snapshot_entities
ALTER TABLE public.snapshot_entities DROP CONSTRAINT IF EXISTS snapshot_entities_snapshot_id_fkey;
ALTER TABLE public.snapshot_entities ADD CONSTRAINT snapshot_entities_snapshot_id_fkey
  FOREIGN KEY (snapshot_id) REFERENCES public.structure_snapshots(id) ON DELETE CASCADE;

-- snapshot_relationships
ALTER TABLE public.snapshot_relationships DROP CONSTRAINT IF EXISTS snapshot_relationships_snapshot_id_fkey;
ALTER TABLE public.snapshot_relationships ADD CONSTRAINT snapshot_relationships_snapshot_id_fkey
  FOREIGN KEY (snapshot_id) REFERENCES public.structure_snapshots(id) ON DELETE CASCADE;

ALTER TABLE public.snapshot_relationships DROP CONSTRAINT IF EXISTS snapshot_relationships_from_entity_snapshot_id_fkey;
ALTER TABLE public.snapshot_relationships ADD CONSTRAINT snapshot_relationships_from_entity_snapshot_id_fkey
  FOREIGN KEY (from_entity_snapshot_id) REFERENCES public.snapshot_entities(id) ON DELETE CASCADE;

ALTER TABLE public.snapshot_relationships DROP CONSTRAINT IF EXISTS snapshot_relationships_to_entity_snapshot_id_fkey;
ALTER TABLE public.snapshot_relationships ADD CONSTRAINT snapshot_relationships_to_entity_snapshot_id_fkey
  FOREIGN KEY (to_entity_snapshot_id) REFERENCES public.snapshot_entities(id) ON DELETE CASCADE;

-- audit_log
ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_tenant_id_fkey;
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

-- feedback
ALTER TABLE public.feedback DROP CONSTRAINT IF EXISTS feedback_tenant_id_fkey;
ALTER TABLE public.feedback ADD CONSTRAINT feedback_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE public.feedback DROP CONSTRAINT IF EXISTS feedback_structure_id_fkey;
ALTER TABLE public.feedback ADD CONSTRAINT feedback_structure_id_fkey
  FOREIGN KEY (structure_id) REFERENCES public.structures(id) ON DELETE SET NULL;

-- import_logs
ALTER TABLE public.import_logs DROP CONSTRAINT IF EXISTS import_logs_tenant_id_fkey;
ALTER TABLE public.import_logs ADD CONSTRAINT import_logs_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

-- entity_merges
ALTER TABLE public.entity_merges DROP CONSTRAINT IF EXISTS entity_merges_tenant_id_fkey;
ALTER TABLE public.entity_merges ADD CONSTRAINT entity_merges_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE public.entity_merges DROP CONSTRAINT IF EXISTS entity_merges_merged_entity_id_fkey;
ALTER TABLE public.entity_merges ADD CONSTRAINT entity_merges_merged_entity_id_fkey
  FOREIGN KEY (merged_entity_id) REFERENCES public.entities(id) ON DELETE CASCADE;

ALTER TABLE public.entity_merges DROP CONSTRAINT IF EXISTS entity_merges_primary_entity_id_fkey;
ALTER TABLE public.entity_merges ADD CONSTRAINT entity_merges_primary_entity_id_fkey
  FOREIGN KEY (primary_entity_id) REFERENCES public.entities(id) ON DELETE CASCADE;

ALTER TABLE public.entity_merges DROP CONSTRAINT IF EXISTS entity_merges_structure_id_fkey;
ALTER TABLE public.entity_merges ADD CONSTRAINT entity_merges_structure_id_fkey
  FOREIGN KEY (structure_id) REFERENCES public.structures(id) ON DELETE SET NULL;

-- invitations
ALTER TABLE public.invitations DROP CONSTRAINT IF EXISTS invitations_tenant_id_fkey;
ALTER TABLE public.invitations ADD CONSTRAINT invitations_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

-- profiles
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_tenant_id_fkey;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

-- xpm_groups
ALTER TABLE public.xpm_groups DROP CONSTRAINT IF EXISTS xpm_groups_tenant_id_fkey;
ALTER TABLE public.xpm_groups ADD CONSTRAINT xpm_groups_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

-- structures self-reference
ALTER TABLE public.structures DROP CONSTRAINT IF EXISTS structures_parent_structure_id_fkey;
ALTER TABLE public.structures ADD CONSTRAINT structures_parent_structure_id_fkey
  FOREIGN KEY (parent_structure_id) REFERENCES public.structures(id) ON DELETE SET NULL;

-- entities self-reference (merged_into)
ALTER TABLE public.entities DROP CONSTRAINT IF EXISTS entities_merged_into_entity_id_fkey;
ALTER TABLE public.entities ADD CONSTRAINT entities_merged_into_entity_id_fkey
  FOREIGN KEY (merged_into_entity_id) REFERENCES public.entities(id) ON DELETE SET NULL;

-- 2. Allow super admins to delete tenants
CREATE POLICY "super_admin_delete_tenants"
  ON public.tenants FOR DELETE
  TO authenticated
  USING (is_super_admin());

-- 3. Create RPC for safe tenant deletion
CREATE OR REPLACE FUNCTION public.rpc_delete_tenant(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _name text;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only super admins can delete tenants';
  END IF;

  SELECT name INTO _name FROM public.tenants WHERE id = p_tenant_id;
  IF _name IS NULL THEN
    RAISE EXCEPTION 'Tenant not found';
  END IF;

  -- Also clean up xero_connections (tenant_id is text there)
  DELETE FROM public.xero_connections WHERE tenant_id = p_tenant_id::text;

  -- Delete the tenant - cascades handle the rest
  DELETE FROM public.tenants WHERE id = p_tenant_id;

  RETURN jsonb_build_object('ok', true, 'deleted_tenant', _name);
END;
$$;
