REVOKE EXECUTE ON FUNCTION public.tenant_structure_capacity(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.tenant_structure_capacity(uuid) TO service_role;