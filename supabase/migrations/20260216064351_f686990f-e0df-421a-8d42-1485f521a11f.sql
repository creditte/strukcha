
-- Add position columns to structure_entities
ALTER TABLE public.structure_entities
  ADD COLUMN position_x double precision,
  ADD COLUMN position_y double precision;

-- Add layout_mode to structures  
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'layout_mode') THEN
    CREATE TYPE public.layout_mode AS ENUM ('auto', 'manual');
  END IF;
END$$;

ALTER TABLE public.structures
  ADD COLUMN layout_mode public.layout_mode NOT NULL DEFAULT 'auto';

-- Allow UPDATE on structure_entities (currently missing)
CREATE POLICY "Users can update structure_entities"
  ON public.structure_entities FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM structures s
      WHERE s.id = structure_entities.structure_id
        AND s.tenant_id = get_user_tenant_id(auth.uid())
    )
    AND (has_role(auth.uid(), 'user'::app_role) OR has_role(auth.uid(), 'admin'::app_role))
  );
