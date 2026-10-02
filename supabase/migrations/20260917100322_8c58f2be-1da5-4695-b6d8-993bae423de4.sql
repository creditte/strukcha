CREATE UNIQUE INDEX IF NOT EXISTS entities_tenant_xpm_uuid_active_uidx
  ON public.entities (tenant_id, xpm_uuid)
  WHERE xpm_uuid IS NOT NULL AND deleted_at IS NULL;