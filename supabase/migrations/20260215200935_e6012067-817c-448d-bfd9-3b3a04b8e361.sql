
-- 1. Update handle_new_user to assign 'user' role
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _tenant_id UUID;
BEGIN
  SELECT id INTO _tenant_id FROM public.tenants WHERE name = 'creditte' LIMIT 1;
  INSERT INTO public.profiles (user_id, tenant_id, full_name)
  VALUES (NEW.id, _tenant_id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''));
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user');
  RETURN NEW;
END;
$$;

-- 2. entities policies
DROP POLICY IF EXISTS "Users can read tenant entities" ON public.entities;
DROP POLICY IF EXISTS "Editors can insert entities" ON public.entities;
DROP POLICY IF EXISTS "Editors can update entities" ON public.entities;
DROP POLICY IF EXISTS "Admins can delete entities" ON public.entities;

CREATE POLICY "Tenant users can read entities" ON public.entities FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()));
CREATE POLICY "Users can insert entities" ON public.entities FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id(auth.uid()) AND (has_role(auth.uid(), 'user') OR has_role(auth.uid(), 'admin')));
CREATE POLICY "Users can update entities" ON public.entities FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()) AND (has_role(auth.uid(), 'user') OR has_role(auth.uid(), 'admin')));
CREATE POLICY "Users can delete entities" ON public.entities FOR DELETE TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()) AND (has_role(auth.uid(), 'user') OR has_role(auth.uid(), 'admin')));

-- 3. relationships policies
DROP POLICY IF EXISTS "Users can read tenant relationships" ON public.relationships;
DROP POLICY IF EXISTS "Editors can insert relationships" ON public.relationships;
DROP POLICY IF EXISTS "Editors can update relationships" ON public.relationships;
DROP POLICY IF EXISTS "Admins can delete relationships" ON public.relationships;

CREATE POLICY "Tenant users can read relationships" ON public.relationships FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()));
CREATE POLICY "Users can insert relationships" ON public.relationships FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id(auth.uid()) AND (has_role(auth.uid(), 'user') OR has_role(auth.uid(), 'admin')));
CREATE POLICY "Users can update relationships" ON public.relationships FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()) AND (has_role(auth.uid(), 'user') OR has_role(auth.uid(), 'admin')));
CREATE POLICY "Users can delete relationships" ON public.relationships FOR DELETE TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()) AND (has_role(auth.uid(), 'user') OR has_role(auth.uid(), 'admin')));

-- 4. structures policies
DROP POLICY IF EXISTS "Users can read tenant structures" ON public.structures;
DROP POLICY IF EXISTS "Editors can insert structures" ON public.structures;
DROP POLICY IF EXISTS "Editors can update structures" ON public.structures;
DROP POLICY IF EXISTS "Admins can delete structures" ON public.structures;

CREATE POLICY "Tenant users can read structures" ON public.structures FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()));
CREATE POLICY "Users can insert structures" ON public.structures FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id(auth.uid()) AND (has_role(auth.uid(), 'user') OR has_role(auth.uid(), 'admin')));
CREATE POLICY "Users can update structures" ON public.structures FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()) AND (has_role(auth.uid(), 'user') OR has_role(auth.uid(), 'admin')));
CREATE POLICY "Users can delete structures" ON public.structures FOR DELETE TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()) AND (has_role(auth.uid(), 'user') OR has_role(auth.uid(), 'admin')));

-- 5. structure_entities policies
DROP POLICY IF EXISTS "Users can read structure_entities" ON public.structure_entities;
DROP POLICY IF EXISTS "Editors can insert structure_entities" ON public.structure_entities;
DROP POLICY IF EXISTS "Editors can delete structure_entities" ON public.structure_entities;

CREATE POLICY "Tenant users can read structure_entities" ON public.structure_entities FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM structures s WHERE s.id = structure_entities.structure_id AND s.tenant_id = get_user_tenant_id(auth.uid())));
CREATE POLICY "Users can insert structure_entities" ON public.structure_entities FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM structures s WHERE s.id = structure_entities.structure_id AND s.tenant_id = get_user_tenant_id(auth.uid())) AND (has_role(auth.uid(), 'user') OR has_role(auth.uid(), 'admin')));
CREATE POLICY "Users can delete structure_entities" ON public.structure_entities FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM structures s WHERE s.id = structure_entities.structure_id AND s.tenant_id = get_user_tenant_id(auth.uid())) AND (has_role(auth.uid(), 'user') OR has_role(auth.uid(), 'admin')));

-- 6. structure_relationships policies
DROP POLICY IF EXISTS "Users can read structure_relationships" ON public.structure_relationships;
DROP POLICY IF EXISTS "Editors can insert structure_relationships" ON public.structure_relationships;
DROP POLICY IF EXISTS "Editors can delete structure_relationships" ON public.structure_relationships;

CREATE POLICY "Tenant users can read structure_relationships" ON public.structure_relationships FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM structures s WHERE s.id = structure_relationships.structure_id AND s.tenant_id = get_user_tenant_id(auth.uid())));
CREATE POLICY "Users can insert structure_relationships" ON public.structure_relationships FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM structures s WHERE s.id = structure_relationships.structure_id AND s.tenant_id = get_user_tenant_id(auth.uid())) AND (has_role(auth.uid(), 'user') OR has_role(auth.uid(), 'admin')));
CREATE POLICY "Users can delete structure_relationships" ON public.structure_relationships FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM structures s WHERE s.id = structure_relationships.structure_id AND s.tenant_id = get_user_tenant_id(auth.uid())) AND (has_role(auth.uid(), 'user') OR has_role(auth.uid(), 'admin')));

-- 7. import_logs policies
DROP POLICY IF EXISTS "Users can read tenant import_logs" ON public.import_logs;
DROP POLICY IF EXISTS "Editors can insert import_logs" ON public.import_logs;

CREATE POLICY "Tenant users can read import_logs" ON public.import_logs FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()));
CREATE POLICY "Users can insert import_logs" ON public.import_logs FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id(auth.uid()) AND user_id = auth.uid() AND (has_role(auth.uid(), 'user') OR has_role(auth.uid(), 'admin')));
CREATE POLICY "Users can update import_logs" ON public.import_logs FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()) AND (has_role(auth.uid(), 'user') OR has_role(auth.uid(), 'admin')));

-- 8. audit_log policies
DROP POLICY IF EXISTS "System can insert audit_log" ON public.audit_log;
DROP POLICY IF EXISTS "Users can read tenant audit_log" ON public.audit_log;

CREATE POLICY "Tenant users can read audit_log" ON public.audit_log FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()));
CREATE POLICY "Allow audit_log inserts" ON public.audit_log FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id(auth.uid()));

-- 9. user_roles policies
DROP POLICY IF EXISTS "Users can read own roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;

CREATE POLICY "Users can read own roles" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "Admins can manage roles" ON public.user_roles FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'));

-- 10. Create audit triggers (were missing from DB)
DROP TRIGGER IF EXISTS trg_audit_entity_update ON public.entities;
CREATE TRIGGER trg_audit_entity_update
  AFTER UPDATE ON public.entities
  FOR EACH ROW EXECUTE FUNCTION public.audit_entity_update();

DROP TRIGGER IF EXISTS trg_audit_relationship_update ON public.relationships;
CREATE TRIGGER trg_audit_relationship_update
  AFTER UPDATE ON public.relationships
  FOR EACH ROW EXECUTE FUNCTION public.audit_relationship_update();
