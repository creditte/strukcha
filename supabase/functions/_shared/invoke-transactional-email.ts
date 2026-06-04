import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { queueTransactionalEmail } from './queue-transactional-email.ts'

export interface InvokeTransactionalEmailOptions {
  templateName: string
  recipientEmail: string
  templateData?: Record<string, unknown>
  idempotencyKey?: string
}

/** Queue a transactional email using the service role (no HTTP hop). */
export async function invokeTransactionalEmail(
  options: InvokeTransactionalEmailOptions,
): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) {
    return { ok: false, error: 'Missing Supabase configuration' }
  }

  const supabase = createClient(supabaseUrl, serviceKey)
  const result = await queueTransactionalEmail(supabase, options)

  if (!result.ok) {
    console.error('[invokeTransactionalEmail] failed', options.templateName, result.error)
    return { ok: false, error: result.error }
  }

  if (result.deduplicated || result.suppressed) {
    return { ok: true, skipped: true }
  }

  return { ok: true }
}

/** Record that a scheduled tenant notification was sent (dedup). */
export async function markTenantNotificationSent(
  supabase: SupabaseClient,
  tenantId: string,
  notificationKey: string,
): Promise<boolean> {
  const { error } = await supabase.from('tenant_email_notifications').insert({
    tenant_id: tenantId,
    notification_key: notificationKey,
  })
  if (error?.code === '23505') return false
  if (error) {
    console.error('[markTenantNotificationSent]', notificationKey, error)
    return false
  }
  return true
}

export async function wasTenantNotificationSent(
  supabase: SupabaseClient,
  tenantId: string,
  notificationKey: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('tenant_email_notifications')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('notification_key', notificationKey)
    .maybeSingle()
  return !!data
}
