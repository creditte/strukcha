CREATE OR REPLACE FUNCTION public.sync_xpm_archive_absent_clients(_tenant_id uuid, _since timestamp with time zone)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _archived int := 0;
BEGIN
  WITH upd AS (
    UPDATE public.entities
    SET is_archived = true, updated_at = now()
    WHERE tenant_id = _tenant_id
      AND deleted_at IS NULL
      AND source = 'imported'
      AND xpm_uuid IS NOT NULL
      AND NOT is_archived
      AND (xpm_last_seen_at IS NULL OR xpm_last_seen_at < _since)
    RETURNING 1
  )
  SELECT count(*) INTO _archived FROM upd;

  -- Membership rows are deliberately left in place: diagrams filter archived
  -- clients out at read time, so a client that becomes active in XPM again
  -- returns to its saved position instead of being lost.

  RETURN jsonb_build_object('archived', _archived);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_operations_health()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  result jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'Not authorised';
  end if;

  select jsonb_build_object(
    'checked_at', now(),
    'webhooks', jsonb_build_object(
      'total', (select count(*) from public.stripe_webhook_events),
      'completed', (select count(*) from public.stripe_webhook_events where status = 'completed'),
      'failing', (select count(*) from public.stripe_webhook_events where status <> 'completed' and attempts >= 3),
      'pending', (select count(*) from public.stripe_webhook_events where status <> 'completed' and attempts < 3),
      'rows', coalesce((
        select jsonb_agg(r)
        from (
          select id, event_type, status, attempts, last_error, processed_at
          from public.stripe_webhook_events
          where status <> 'completed'
          order by attempts desc, processed_at desc
          limit 25
        ) r
      ), '[]'::jsonb)
    ),
    'emails', jsonb_build_object(
      'sent', (select count(*) from public.email_send_log where status = 'sent'),
      'pending', (select count(*) from public.email_send_log where status = 'pending'),
      'stale_pending', (select count(*) from public.email_send_log where status = 'pending' and created_at < now() - interval '1 day'),
      'dlq', (select count(*) from public.email_send_log where status = 'dlq'),
      'rows', coalesce((
        select jsonb_agg(r)
        from (
          select id, template_name, recipient_email, status, error_message, created_at
          from public.email_send_log
          where status in ('pending','dlq')
          order by created_at desc
          limit 25
        ) r
      ), '[]'::jsonb)
    ),
    'cron_jobs', coalesce((
      select jsonb_agg(jsonb_build_object('name', jobname, 'schedule', schedule, 'active', active))
      from cron.job
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$function$;

REVOKE ALL ON FUNCTION public.admin_operations_health() FROM public;
REVOKE ALL ON FUNCTION public.admin_operations_health() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_operations_health() TO authenticated;