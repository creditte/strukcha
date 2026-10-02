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
    WHERE xc.tenant_id = (get_user_tenant_id(auth.uid()))::text
    ORDER BY
      (xc.status = 'needs_reauth'),
      (xc.connection_type IS DISTINCT FROM 'practice_manager'),
      xc.connected_at DESC NULLS LAST
    LIMIT 1),
    'null'::jsonb
  );
$$;

-- Xero drops a link after 60 days of inactivity. These rows can no longer be
-- renewed, so record that fact instead of letting a sync discover it.
UPDATE public.xero_connections
SET status = 'needs_reauth',
    last_error = 'This Xero connection lapsed after 60 days without use. Please reconnect Xero.',
    last_error_at = now(),
    invalidated_at = COALESCE(invalidated_at, now()),
    updated_at = now()
WHERE status = 'active'
  AND COALESCE(last_refresh_at, connected_at, '-infinity'::timestamptz) < now() - interval '60 days';