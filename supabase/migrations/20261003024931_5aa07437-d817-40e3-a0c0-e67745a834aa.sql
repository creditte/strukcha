CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    -- API callers acting as a user (or signed out) may only ask about themselves.
    WHEN coalesce(auth.role(), '') IN ('authenticated', 'anon')
         AND _user_id IS DISTINCT FROM auth.uid() THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = _user_id AND role = _role
    )
  END
$$;

REVOKE ALL ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC;
-- anon keeps EXECUTE only because some RLS policies (TO public) call
-- has_role(auth.uid(), ...); for anon the function always returns false.
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO anon, authenticated, service_role;

-- Static role-name lookup: not read by the app; restrict to super admins
-- (who already have the ALL policy) and the backend.
DROP POLICY IF EXISTS "Authenticated users can read roles" ON public.roles;