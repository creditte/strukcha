import * as React from 'npm:react@18.3.1'
import { Body, Button, Container, Head, Heading, Html, Preview, Text } from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'
import { SITE_NAME, SITE_URL, emailStyles, formatPlanName } from './styles.ts'

interface PaymentFailedProps {
  name?: string
  plan?: string
  firmName?: string
}

const PaymentFailedEmail = ({ name, plan, firmName }: PaymentFailedProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Action required: payment failed for your strukcha subscription</Preview>
    <Body style={emailStyles.main}>
      <Container style={emailStyles.container}>
        <Text style={emailStyles.brand}>{SITE_NAME}</Text>
        <Heading style={emailStyles.h1}>We couldn't process your payment</Heading>
        <Text style={emailStyles.text}>
          {name ? `Hi ${name},` : 'Hi,'} we weren't able to charge the payment method on file for your{' '}
          {formatPlanName(plan)} subscription{firmName ? ` (${firmName})` : ''}.
        </Text>
        <Text style={emailStyles.text}>
          Your workspace access may be limited until the payment is resolved. Please update your billing details as
          soon as possible to avoid interruption.
        </Text>
        <Button style={emailStyles.button} href={`${SITE_URL}/settings/billing`}>
          Update payment method
        </Button>
        <Text style={emailStyles.footer}>
          If you've already updated your card, it can take a few minutes for Stripe to retry the charge.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: PaymentFailedEmail,
  subject: 'Action required: strukcha payment failed',
  displayName: 'Payment failed',
  previewData: { name: 'Sarah', plan: 'pro' },
} satisfies TemplateEntry
