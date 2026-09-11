import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Html, Preview, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'strukcha'
const SITE_URL = 'https://strukcha.app'

interface XeroConnectionLapsedProps {
  name?: string
  orgName?: string
  reason?: string
}

const XeroConnectionLapsedEmail = ({ name, orgName, reason }: XeroConnectionLapsedProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your Xero connection needs to be reconnected</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={brand}>{SITE_NAME}</Text>
        <Heading style={h1}>Your Xero connection stopped working</Heading>
        <Text style={text}>
          {name ? `Hi ${name}, ` : ''}Xero is no longer accepting our access to
          {orgName ? ` ${orgName}` : ' your organisation'}, so client data can't be synced until
          someone reconnects it.
        </Text>
        {reason ? <Text style={quote}>{reason}</Text> : null}
        <Text style={text}>
          Reconnecting takes a moment and nothing you've already built is affected.
        </Text>
        <Button style={button} href={`${SITE_URL}/settings?tab=integrations`}>
          Reconnect Xero
        </Button>
        <Text style={footer}>
          Your existing diagrams and data are safe — nothing has been lost.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: XeroConnectionLapsedEmail,
  subject: 'Action needed: reconnect Xero',
  displayName: 'Xero connection lapsed',
  previewData: {
    name: 'Sarah',
    orgName: 'Demo Company (AU)',
    reason: 'Xero rejected the stored authorisation (401).',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' }
const container = { padding: '40px 32px', maxWidth: '480px', margin: '0 auto' }
const brand = { fontSize: '18px', fontWeight: 'bold' as const, color: '#2563c7', margin: '0 0 32px', letterSpacing: '-0.5px' }
const h1 = { fontSize: '22px', fontWeight: 'bold' as const, color: '#1a1f2e', margin: '0 0 16px' }
const text = { fontSize: '14px', color: '#6b7280', lineHeight: '1.6', margin: '0 0 20px' }
const quote = { fontSize: '13px', color: '#6b7280', lineHeight: '1.6', margin: '0 0 20px', padding: '12px 16px', backgroundColor: '#f6f7f9', borderRadius: '10px' }
const button = { backgroundColor: '#2563c7', color: '#ffffff', fontSize: '14px', fontWeight: '600' as const, borderRadius: '10px', padding: '12px 24px', textDecoration: 'none' }
const footer = { fontSize: '12px', color: '#999999', margin: '24px 0 0', lineHeight: '1.5' }
