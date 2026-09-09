-- Weekly keep-alive so idle Xero connections stay authorised inside the 60-day window.
select cron.schedule(
  'xero-keepalive-weekly',
  '35 3 * * 1',
  $$
  select net.http_post(
    url := 'https://kdwmetjwxfzovdmarijl.supabase.co/functions/v1/xero-keepalive',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'email_queue_service_role_key')
    ),
    body := jsonb_build_object('time', now())
  );
  $$
);

-- Connections whose most recent sync failed with an authorisation error can only
-- be fixed by reconnecting; record that on the connection itself.
update public.xero_connections c
set status = 'needs_reauth',
    last_error = 'Xero rejected the saved authorisation. Please reconnect.',
    last_error_at = now(),
    invalidated_at = now(),
    updated_at = now()
where c.status = 'active'
  and exists (
    select 1
    from public.import_logs l
    where l.tenant_id::text = c.tenant_id
      and l.file_name = 'xpm-sync-3.1'
      and l.status = 'failed'
      and l.created_at > now() - interval '30 days'
      and (
        l.result->>'error' ilike '%invalid_grant%'
        or l.result->>'error' ilike '%AuthorizationUnsuccessful%'
        or l.result->>'error' ilike '%consumed%'
      )
  );

-- The organisation behind the repeated "Unauthorized" syncs has no Practice
-- Manager access; label it so the app refuses XPM sync up front.
update public.xero_connections c
set connection_type = 'standard',
    updated_at = now()
where c.connection_type = 'practice_manager'
  and exists (
    select 1
    from public.import_logs l
    where l.tenant_id::text = c.tenant_id
      and l.file_name = 'xpm-sync-3.1'
      and l.status = 'failed'
      and l.created_at > now() - interval '30 days'
      and l.result->>'error' ilike '%AuthorizationUnsuccessful%'
  );