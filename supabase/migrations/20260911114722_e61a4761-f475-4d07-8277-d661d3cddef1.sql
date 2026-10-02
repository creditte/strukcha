-- 1. Drop connections whose firm no longer exists (includes the legacy row with unprotected keys)
DELETE FROM public.xero_connections c
WHERE NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id::text = c.tenant_id);

-- 2. One connection per firm: keep the healthiest, most recently connected row
DELETE FROM public.xero_connections c
USING public.xero_connections k
WHERE c.tenant_id = k.tenant_id
  AND c.id <> k.id
  AND ROW((k.status = 'active')::int, COALESCE(k.connected_at, '-infinity'::timestamptz), k.id::text)
    > ROW((c.status = 'active')::int, COALESCE(c.connected_at, '-infinity'::timestamptz), c.id::text);

-- 3. Policies and functions reference tenant_id as text; rebuild them after retyping
DROP POLICY IF EXISTS "Tenant owners/admins can delete xero connections" ON public.xero_connections;
DROP POLICY IF EXISTS "Users can delete own xero connections" ON public.xero_connections;
DROP POLICY IF EXISTS "Users can insert own xero connections" ON public.xero_connections;
DROP POLICY IF EXISTS "Users can update own xero connections" ON public.xero_connections;

ALTER TABLE public.xero_connections
  ALTER COLUMN tenant_id TYPE uuid USING tenant_id::uuid;

ALTER TABLE public.xero_connections
  ADD CONSTRAINT xero_connections_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS xero_connections_one_per_tenant
  ON public.xero_connections (tenant_id);

ALTER TABLE public.xero_connections
  ADD COLUMN IF NOT EXISTS reauth_notified_at timestamptz;

-- The connection belongs to the firm, so any owner/admin may manage it.
CREATE POLICY "Firm owners and admins can insert xero connections"
ON public.xero_connections FOR INSERT TO authenticated
WITH CHECK (is_owner_or_admin(tenant_id));

CREATE POLICY "Firm owners and admins can update xero connections"
ON public.xero_connections FOR UPDATE TO authenticated
USING (is_owner_or_admin(tenant_id));

CREATE POLICY "Firm owners and admins can delete xero connections"
ON public.xero_connections FOR DELETE TO authenticated
USING (is_owner_or_admin(tenant_id));

-- 4. Rebuild helpers for the uuid column
CREATE OR REPLACE FUNCTION public.get_xero_connection_info()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT jsonb_build_object(
      'id', xc.id,
      'connected_at', xc.connected_at,
      'expires_at', xc.expires_at,
      'xero_tenant_id', xc.xero_tenant_id,
      'xero_org_name', xc.xero_org_name,
      'connected_by_email', xc.connected_by_email,
      'connection_type', xc.connection_type,
      'status', xc.status,
      'last_error', xc.last_error,
      'last_error_at', xc.last_error_at,
      'invalidated_at', xc.invalidated_at
    )
    FROM public.xero_connections xc
    WHERE xc.tenant_id = get_user_tenant_id(auth.uid())
    ORDER BY
      (xc.status = 'needs_reauth'),
      (xc.connection_type IS DISTINCT FROM 'practice_manager'),
      xc.connected_at DESC NULLS LAST
    LIMIT 1),
    'null'::jsonb
  );
$$;

CREATE OR REPLACE FUNCTION public.disconnect_xero_connection(p_connection_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  _tenant_id uuid;
BEGIN
  _tenant_id := get_user_tenant_id(auth.uid());

  IF NOT is_owner_or_admin(_tenant_id) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  DELETE FROM public.xero_connections
  WHERE id = p_connection_id AND tenant_id = _tenant_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;