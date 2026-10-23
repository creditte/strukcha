-- C: signed-in users may only look up their own firm. Calls with no signed-in user
-- (backend service role, internal jobs) and super admins keep full lookup.
-- anon has no EXECUTE (revoked in 0001); grants are unchanged by CREATE OR REPLACE.
CREATE OR REPLACE FUNCTION public.get_user_tenant_id(_user_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.tenant_id
  FROM public.profiles p
  WHERE p.user_id = _user_id
    AND (
      auth.uid() IS NULL
      OR _user_id = auth.uid()
      OR public.is_super_admin()
    )
  LIMIT 1
$function$;