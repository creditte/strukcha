ALTER TABLE public.xpm_groups
  ADD COLUMN IF NOT EXISTS is_selected boolean NOT NULL DEFAULT false;

-- Groups that already produced a diagram stay in the sync.
UPDATE public.xpm_groups g
SET is_selected = true
WHERE EXISTS (
  SELECT 1 FROM public.structures s
  WHERE s.tenant_id = g.tenant_id
    AND s.name = g.name
    AND s.deleted_at IS NULL
);

CREATE INDEX IF NOT EXISTS xpm_groups_tenant_selected_idx
  ON public.xpm_groups (tenant_id, is_selected, xpm_uuid);