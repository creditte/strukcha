-- Tracks scheduled/deduplicated tenant notification emails (trial ending, renewal reminders).
CREATE TABLE IF NOT EXISTS public.tenant_email_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  notification_key TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, notification_key)
);

CREATE INDEX IF NOT EXISTS idx_tenant_email_notifications_tenant
  ON public.tenant_email_notifications(tenant_id);

ALTER TABLE public.tenant_email_notifications ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Service role can manage tenant email notifications"
    ON public.tenant_email_notifications FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
