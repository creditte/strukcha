-- Phase 5.1: make the three live scheduled jobs reproducible from migrations.
select cron.schedule(
  'expire-trials-hourly',
  '7 * * * *',
  $job$
  select net.http_post(
    url := 'https://kdwmetjwxfzovdmarijl.supabase.co/functions/v1/expire-trials',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'email_queue_service_role_key')
    ),
    body := jsonb_build_object('time', now())
  );
  $job$
);

select cron.schedule(
  'send-billing-reminders-daily',
  '20 8 * * *',
  $job$
  select net.http_post(
    url := 'https://kdwmetjwxfzovdmarijl.supabase.co/functions/v1/send-billing-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'email_queue_service_role_key')
    ),
    body := jsonb_build_object('time', now())
  );
  $job$
);

select cron.schedule(
  'xero-keepalive-weekly',
  '35 3 * * 1',
  $job$
  select net.http_post(
    url := 'https://kdwmetjwxfzovdmarijl.supabase.co/functions/v1/xero-keepalive',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'email_queue_service_role_key')
    ),
    body := jsonb_build_object('time', now())
  );
  $job$
);

-- Phase 5.2: webhook + email delivery health, readable by super admins only.
create or replace function public.admin_operations_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.is_super_admin(auth.uid()) then
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
$$;

revoke all on function public.admin_operations_health() from public, anon;
grant execute on function public.admin_operations_health() to authenticated;