import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Html, Preview, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'strukcha'
const SITE_URL = 'https://strukcha.app'

interface WelcomeProps {
  name?: string
}

const WelcomeEmail = ({ name }: WelcomeProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Welcome to strukcha — let's get your org structure set up</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={brand}>{SITE_NAME}</Text>
        <Heading style={h1}>
          {name ? `Welcome, ${name}` : 'Welcome to strukcha'}
        </Heading>
        <Text style={text}>
          strukcha connects to your XPM account and builds a visual org structure for your firm — automatically.
        </Text>
        <Text style={text}>
          Your first step is to connect XPM. It takes about 30 seconds, and your data stays secure the entire time.
        </Text>
        <Text style={text}>
          Once connected, we'll generate your first structure diagram within minutes.
        </Text>
        <Button style={button} href={`${SITE_URL}/import`}>
          Connect XPM
        </Button>
        <Text style={footer}>
          Questions? Just reply to this email — a real person will get back to you.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: WelcomeEmail,
  subject: 'Welcome to strukcha — connect XPM to get started',
  displayName: 'Welcome',
  previewData: { name: 'Sarah' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' }
const container = { padding: '40px 32px', maxWidth: '480px', margin: '0 auto' }
const brand = { fontSize: '18px', fontWeight: 'bold' as const, color: '#2563c7', margin: '0 0 32px', letterSpacing: '-0.5px' }
const h1 = { fontSize: '22px', fontWeight: 'bold' as const, color: '#1a1f2e', margin: '0 0 16px' }
const text = { fontSize: '14px', color: '#6b7280', lineHeight: '1.6', margin: '0 0 20px' }
const button = { backgroundColor: '#2563c7', color: '#ffffff', fontSize: '14px', fontWeight: '600' as const, borderRadius: '10px', padding: '12px 24px', textDecoration: 'none' }
const footer = { fontSize: '12px', color: '#999999', margin: '24px 0 0', lineHeight: '1.5' }
