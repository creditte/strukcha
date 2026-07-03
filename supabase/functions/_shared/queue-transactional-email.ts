import * as React from 'npm:react@18.3.1'
import { renderAsync } from 'npm:@react-email/components@0.0.22'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { TEMPLATES } from './transactional-email-templates/registry.ts'

const SITE_NAME = 'strukcha'
const SENDER_DOMAIN = 'notify.strukcha.app'
const FROM_DOMAIN = 'strukcha.app'

function generateToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export interface QueueTransactionalEmailOptions {
  templateName: string
  recipientEmail: string
  templateData?: Record<string, unknown>
  idempotencyKey?: string
}

export interface QueueTransactionalEmailResult {
  ok: boolean
  error?: string
  deduplicated?: boolean
  suppressed?: boolean
}

/** Render template and enqueue for process-email-queue (no HTTP hop). */
export async function queueTransactionalEmail(
  supabase: SupabaseClient,
  options: QueueTransactionalEmailOptions,
): Promise<QueueTransactionalEmailResult> {
  const { templateName, templateData = {} } = options
  const idempotencyKey = options.idempotencyKey ?? crypto.randomUUID()
  const messageId = crypto.randomUUID()

  const template = TEMPLATES[templateName]
  if (!template) {
    return {
      ok: false,
      error: `Template '${templateName}' not found. Available: ${Object.keys(TEMPLATES).join(', ')}`,
    }
  }

  const effectiveRecipient = template.to || options.recipientEmail
  if (!effectiveRecipient) {
    return { ok: false, error: 'recipientEmail is required' }
  }

  const normalizedEmail = effectiveRecipient.toLowerCase()

  if (idempotencyKey) {
    const { data: priorSend } = await supabase
      .from('email_send_log')
      .select('id')
      .eq('template_name', templateName)
      .eq('recipient_email', normalizedEmail)
      .contains('metadata', { idempotency_key: idempotencyKey })
      .in('status', ['pending', 'sent'])
      .limit(1)
      .maybeSingle()

    if (priorSend) {
      return { ok: true, deduplicated: true }
    }
  }

  const { data: suppressed, error: suppressionError } = await supabase
    .from('suppressed_emails')
    .select('id')
    .eq('email', normalizedEmail)
    .maybeSingle()

  if (suppressionError) {
    return { ok: false, error: 'Failed to verify suppression status' }
  }

  if (suppressed) {
    await supabase.from('email_send_log').insert({
      message_id: messageId,
      template_name: templateName,
      recipient_email: effectiveRecipient,
      status: 'suppressed',
    })
    return { ok: true, suppressed: true }
  }

  let unsubscribeToken: string
  const { data: existingToken, error: tokenLookupError } = await supabase
    .from('email_unsubscribe_tokens')
    .select('token, used_at')
    .eq('email', normalizedEmail)
    .maybeSingle()

  if (tokenLookupError) {
    await supabase.from('email_send_log').insert({
      message_id: messageId,
      template_name: templateName,
      recipient_email: effectiveRecipient,
      status: 'failed',
      error_message: 'Failed to look up unsubscribe token',
    })
    return { ok: false, error: 'Failed to look up unsubscribe token' }
  }

  if (existingToken && !existingToken.used_at) {
    unsubscribeToken = existingToken.token
  } else if (!existingToken) {
    unsubscribeToken = generateToken()
    const { error: tokenError } = await supabase
      .from('email_unsubscribe_tokens')
      .upsert(
        { token: unsubscribeToken, email: normalizedEmail },
        { onConflict: 'email', ignoreDuplicates: true },
      )

    if (tokenError) {
      await supabase.from('email_send_log').insert({
        message_id: messageId,
        template_name: templateName,
        recipient_email: effectiveRecipient,
        status: 'failed',
        error_message: 'Failed to create unsubscribe token',
      })
      return { ok: false, error: 'Failed to create unsubscribe token' }
    }

    const { data: storedToken } = await supabase
      .from('email_unsubscribe_tokens')
      .select('token')
      .eq('email', normalizedEmail)
      .maybeSingle()

    if (!storedToken?.token) {
      return { ok: false, error: 'Failed to confirm unsubscribe token storage' }
    }
    unsubscribeToken = storedToken.token
  } else {
    await supabase.from('email_send_log').insert({
      message_id: messageId,
      template_name: templateName,
      recipient_email: effectiveRecipient,
      status: 'suppressed',
      error_message: 'Unsubscribe token used but email missing from suppressed list',
    })
    return { ok: true, suppressed: true }
  }

  const html = await renderAsync(React.createElement(template.component, templateData))
  const plainText = await renderAsync(React.createElement(template.component, templateData), {
    plainText: true,
  })

  const resolvedSubject =
    typeof template.subject === 'function' ? template.subject(templateData) : template.subject

  const logMetadata = { idempotency_key: idempotencyKey }

  await supabase.from('email_send_log').insert({
    message_id: messageId,
    template_name: templateName,
    recipient_email: effectiveRecipient,
    status: 'pending',
    metadata: logMetadata,
  })

  const { error: enqueueError } = await supabase.rpc('enqueue_email', {
    queue_name: 'transactional_emails',
    payload: {
      message_id: messageId,
      to: effectiveRecipient,
      from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
      sender_domain: SENDER_DOMAIN,
      subject: resolvedSubject,
      html,
      text: plainText,
      purpose: 'transactional',
      label: templateName,
      idempotency_key: idempotencyKey,
      unsubscribe_token: unsubscribeToken,
      queued_at: new Date().toISOString(),
    },
  })

  if (enqueueError) {
    console.error('[queueTransactionalEmail] enqueue failed', enqueueError)
    await supabase.from('email_send_log').insert({
      message_id: messageId,
      template_name: templateName,
      recipient_email: effectiveRecipient,
      status: 'failed',
      error_message: enqueueError.message?.slice(0, 1000) ?? 'Failed to enqueue email',
      metadata: logMetadata,
    })
    return { ok: false, error: enqueueError.message ?? 'Failed to enqueue email' }
  }

  return { ok: true }
}
