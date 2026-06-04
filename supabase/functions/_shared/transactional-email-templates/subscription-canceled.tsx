import * as React from 'npm:react@18.3.1'
import { Body, Button, Container, Head, Heading, Html, Preview, Text } from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'
import { SITE_NAME, SITE_URL, emailStyles, formatEmailDate, formatPlanName } from './styles.ts'

interface SubscriptionCanceledProps {
  name?: string
  plan?: string
  firmName?: string
  reason?: string
  accessEndsAt?: string
}

const SubscriptionCanceledEmail = ({
  name,
  plan,
  firmName,
  reason,
  accessEndsAt,
}: SubscriptionCanceledProps) => {
  const paymentFailed = reason === 'payment_failed' || reason === 'payment failed'
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>
        {paymentFailed
          ? 'Your strukcha subscription was canceled after a failed payment'
          : 'Your strukcha subscription has been canceled'}
      </Preview>
      <Body style={emailStyles.main}>
        <Container style={emailStyles.container}>
          <Text style={emailStyles.brand}>{SITE_NAME}</Text>
          <Heading style={emailStyles.h1}>
            {paymentFailed ? 'Subscription canceled — payment could not be processed' : 'Subscription canceled'}
          </Heading>
          <Text style={emailStyles.text}>
            {name ? `Hi ${name},` : 'Hi,'} your {formatPlanName(plan)} subscription
            {firmName ? ` for ${firmName}` : ''} has been canceled
            {paymentFailed ? ' because we could not process your payment after multiple attempts' : ''}.
          </Text>
          {accessEndsAt ? (
            <Text style={emailStyles.text}>
              {paymentFailed
                ? `Workspace access was limited on ${formatEmailDate(accessEndsAt)}.`
                : `You may retain access until ${formatEmailDate(accessEndsAt)}.`}
            </Text>
          ) : null}
          <Text style={emailStyles.text}>
            {paymentFailed
              ? 'To restore access, update your payment method and resubscribe from billing settings.'
              : 'You can resubscribe at any time from your billing settings.'}
          </Text>
          <Button style={emailStyles.button} href={`${SITE_URL}/settings/billing`}>
            {paymentFailed ? 'Resubscribe' : 'View billing'}
          </Button>
          <Text style={emailStyles.footer}>
            Questions about your account? Reply to this email and we'll help.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: SubscriptionCanceledEmail,
  subject: (data: Record<string, unknown>) => {
    const reason = data.reason as string | undefined
    if (reason === 'payment_failed' || reason === 'payment failed') {
      return 'strukcha subscription canceled — payment could not be processed'
    }
    return 'Your strukcha subscription has been canceled'
  },
  displayName: 'Subscription canceled',
  previewData: { name: 'Sarah', plan: 'pro', reason: 'payment_failed' },
} satisfies TemplateEntry
