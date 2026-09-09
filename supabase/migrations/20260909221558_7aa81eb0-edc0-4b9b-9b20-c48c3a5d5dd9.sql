ALTER TABLE public.xero_connections
  ADD COLUMN IF NOT EXISTS connection_type text NOT NULL DEFAULT 'practice_manager',
  ADD COLUMN IF NOT EXISTS scopes text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS last_error_at timestamptz,
  ADD COLUMN IF NOT EXISTS invalidated_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_refresh_at timestamptz,
  ADD COLUMN IF NOT EXISTS refresh_lock_until timestamptz;

ALTER TABLE public.xero_connections
  DROP CONSTRAINT IF EXISTS xero_connections_status_check;
ALTER TABLE public.xero_connections
  ADD CONSTRAINT xero_connections_status_check
  CHECK (status IN ('active', 'needs_reauth'));

ALTER TABLE public.xero_connections
  DROP CONSTRAINT IF EXISTS xero_connections_connection_type_check;
ALTER TABLE public.xero_connections
  ADD CONSTRAINT xero_connections_connection_type_check
  CHECK (connection_type IN ('practice_manager', 'standard'));

CREATE OR REPLACE FUNCTION public.get_xero_connection_info()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    WHERE xc.tenant_id = (get_user_tenant_id(auth.uid()))::text
    ORDER BY xc.connected_at DESC
    LIMIT 1),
    'null'::jsonb
  );
$function$;