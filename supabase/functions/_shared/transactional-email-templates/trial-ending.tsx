import * as React from 'npm:react@18.3.1'
import { Body, Button, Container, Head, Heading, Html, Preview, Text } from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'
import { SITE_NAME, SITE_URL, emailStyles, formatEmailDate, formatPlanName } from './styles.ts'

interface TrialEndingProps {
  name?: string
  trialEndsAt?: string
  daysRemaining?: number
  plan?: string
  firmName?: string
}

const TrialEndingEmail = ({ name, trialEndsAt, daysRemaining, plan, firmName }: TrialEndingProps) => {
  const days = daysRemaining ?? 3
  const when = formatEmailDate(trialEndsAt)
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>Your strukcha free trial ends in {days} day{days === 1 ? '' : 's'}</Preview>
      <Body style={emailStyles.main}>
        <Container style={emailStyles.container}>
          <Text style={emailStyles.brand}>{SITE_NAME}</Text>
          <Heading style={emailStyles.h1}>Your free trial is ending soon</Heading>
          <Text style={emailStyles.text}>
            {name ? `Hi ${name},` : 'Hi,'} your free trial
            {firmName ? ` for ${firmName}` : ''} ends on <strong>{when}</strong>
            {days <= 1 ? ' — that\'s tomorrow' : ` — in ${days} days`}.
          </Text>
          <Text style={emailStyles.text}>
            You're currently on the {formatPlanName(plan)} plan. Add a payment method before your trial ends to keep
            building and sharing structure diagrams without interruption.
          </Text>
          <Button style={emailStyles.button} href={`${SITE_URL}/settings/billing`}>
            Manage billing
          </Button>
          <Text style={emailStyles.footer}>
            If you've already subscribed, you can ignore this reminder.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: TrialEndingEmail,
  subject: (data: Record<string, unknown>) => {
    const days = (data.daysRemaining as number) ?? 3
    return days <= 1
      ? 'Your strukcha trial ends tomorrow'
      : `Your strukcha trial ends in ${days} days`
  },
  displayName: 'Trial ending',
  previewData: { name: 'Sarah', trialEndsAt: new Date().toISOString(), daysRemaining: 3, plan: 'pro' },
} satisfies TemplateEntry
