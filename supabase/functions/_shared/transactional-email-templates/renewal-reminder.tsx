import * as React from 'npm:react@18.3.1'
import { Body, Button, Container, Head, Heading, Html, Preview, Text } from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'
import { SITE_NAME, SITE_URL, emailStyles, formatEmailDate, formatPlanName } from './styles.ts'

interface RenewalReminderProps {
  name?: string
  renewalDate?: string
  plan?: string
  firmName?: string
  amount?: string
}

const RenewalReminderEmail = ({ name, renewalDate, plan, firmName, amount }: RenewalReminderProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your strukcha subscription renews soon</Preview>
    <Body style={emailStyles.main}>
      <Container style={emailStyles.container}>
        <Text style={emailStyles.brand}>{SITE_NAME}</Text>
        <Heading style={emailStyles.h1}>Subscription renewal reminder</Heading>
        <Text style={emailStyles.text}>
          {name ? `Hi ${name},` : 'Hi,'} your {formatPlanName(plan)} subscription
          {firmName ? ` for ${firmName}` : ''} is scheduled to renew on{' '}
          <strong>{formatEmailDate(renewalDate)}</strong>.
        </Text>
        {amount ? (
          <Text style={emailStyles.text}>
            The upcoming charge is <strong>{amount}</strong>. No action is needed if your payment details are up to
            date.
          </Text>
        ) : (
          <Text style={emailStyles.text}>
            No action is needed if your payment details are up to date — we'll process the renewal automatically.
          </Text>
        )}
        <Button style={emailStyles.button} href={`${SITE_URL}/settings/billing`}>
          Review billing
        </Button>
        <Text style={emailStyles.footer}>
          Need to change your plan or update your card? Use the billing portal from your account settings.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: RenewalReminderEmail,
  subject: 'Reminder: your strukcha subscription renews soon',
  displayName: 'Renewal reminder',
  previewData: {
    name: 'Sarah',
    renewalDate: new Date().toISOString(),
    plan: 'pro',
    amount: 'A$99.00',
  },
} satisfies TemplateEntry
