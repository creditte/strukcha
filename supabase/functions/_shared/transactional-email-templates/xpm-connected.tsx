import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Html, Preview, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'strukcha'
const SITE_URL = 'https://strukcha.app'

interface XpmConnectedProps {
  name?: string
}

const XpmConnectedEmail = ({ name }: XpmConnectedProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>XPM is connected — your first structure is on the way</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={brand}>{SITE_NAME}</Text>
        <Heading style={h1}>XPM connected successfully</Heading>
        <Text style={text}>
          {name ? `Nice one, ${name}.` : 'Nice one.'} Your XPM account is now connected to strukcha.
        </Text>
        <Text style={text}>
          We're syncing your data now. This usually takes a few minutes depending on the size of your client list.
        </Text>
        <Text style={text}>
          Once the sync is complete, you'll see your first structure diagram ready to explore.
        </Text>
        <Button style={button} href={`${SITE_URL}/structures`}>
          View Your Structures
        </Button>
        <Text style={footer}>
          We'll keep everything in sync automatically from here.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: XpmConnectedEmail,
  subject: 'XPM connected — your structure is being built',
  displayName: 'XPM connected',
  previewData: { name: 'Sarah' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' }
const container = { padding: '40px 32px', maxWidth: '480px', margin: '0 auto' }
const brand = { fontSize: '18px', fontWeight: 'bold' as const, color: '#2563c7', margin: '0 0 32px', letterSpacing: '-0.5px' }
const h1 = { fontSize: '22px', fontWeight: 'bold' as const, color: '#1a1f2e', margin: '0 0 16px' }
const text = { fontSize: '14px', color: '#6b7280', lineHeight: '1.6', margin: '0 0 20px' }
const button = { backgroundColor: '#2563c7', color: '#ffffff', fontSize: '14px', fontWeight: '600' as const, borderRadius: '10px', padding: '12px 24px', textDecoration: 'none' }
const footer = { fontSize: '12px', color: '#999999', margin: '24px 0 0', lineHeight: '1.5' }
