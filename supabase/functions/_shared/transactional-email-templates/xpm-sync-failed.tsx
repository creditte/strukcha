import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Html, Link, Preview, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'strukcha'
const SITE_URL = 'https://strukcha.app'

interface XpmSyncFailedProps {
  name?: string
}

const XpmSyncFailedEmail = ({ name }: XpmSyncFailedProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your XPM sync didn't go through — here's how to fix it</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={brand}>{SITE_NAME}</Text>
        <Heading style={h1}>XPM sync didn't complete</Heading>
        <Text style={text}>
          {name ? `Hi ${name}, we` : 'We'} ran into an issue syncing your XPM data. This happens occasionally and is usually easy to fix.
        </Text>
        <Text style={text}>
          The most common fix is to reconnect your XPM account. It only takes a moment.
        </Text>
        <Button style={button} href={`${SITE_URL}/import`}>
          Reconnect XPM
        </Button>
        <Text style={text}>
          If the issue persists, reply to this email and we'll help you sort it out.
        </Text>
        <Text style={footer}>
          Your existing data is safe — nothing has been lost.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: XpmSyncFailedEmail,
  subject: 'XPM sync issue — quick fix needed',
  displayName: 'XPM sync failed',
  previewData: { name: 'Sarah' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' }
const container = { padding: '40px 32px', maxWidth: '480px', margin: '0 auto' }
const brand = { fontSize: '18px', fontWeight: 'bold' as const, color: '#2563c7', margin: '0 0 32px', letterSpacing: '-0.5px' }
const h1 = { fontSize: '22px', fontWeight: 'bold' as const, color: '#1a1f2e', margin: '0 0 16px' }
const text = { fontSize: '14px', color: '#6b7280', lineHeight: '1.6', margin: '0 0 20px' }
const button = { backgroundColor: '#2563c7', color: '#ffffff', fontSize: '14px', fontWeight: '600' as const, borderRadius: '10px', padding: '12px 24px', textDecoration: 'none' }
const footer = { fontSize: '12px', color: '#999999', margin: '24px 0 0', lineHeight: '1.5' }
