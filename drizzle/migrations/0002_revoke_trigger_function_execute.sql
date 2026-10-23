-- Item E: trigger-only SECURITY DEFINER functions need no direct EXECUTE.
-- PostgreSQL checks EXECUTE on a trigger function only at CREATE TRIGGER,
-- never when the trigger fires, so existing triggers keep working.
-- Functions returning "trigger" cannot be called through the Data API anyway.
REVOKE EXECUTE ON FUNCTION public.audit_entity_insert() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_entity_update() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_relationship_delete() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_relationship_insert() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_relationship_update() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_structure_update() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.protect_tenant_billing_fields() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_tenant_diagram_count() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.email_queue_wake() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_diagram_limit() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_diagram_limit_on_restore() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_relationship_rules() FROM PUBLIC, anon, authenticated;