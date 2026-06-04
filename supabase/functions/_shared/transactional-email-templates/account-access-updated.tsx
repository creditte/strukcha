import * as React from 'npm:react@18.3.1'
import { Body, Button, Container, Head, Heading, Html, Preview, Text } from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'
import { SITE_NAME, SITE_URL, emailStyles } from './styles.ts'

interface AccountAccessUpdatedProps {
  name?: string
  firmName?: string
  summary?: string
  changedBy?: string
}

const AccountAccessUpdatedEmail = ({ name, firmName, summary, changedBy }: AccountAccessUpdatedProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your strukcha account access has been updated</Preview>
    <Body style={emailStyles.main}>
      <Container style={emailStyles.container}>
        <Text style={emailStyles.brand}>{SITE_NAME}</Text>
        <Heading style={emailStyles.h1}>Account access updated</Heading>
        <Text style={emailStyles.text}>
          {name ? `Hi ${name},` : 'Hi,'} your access{firmName ? ` to ${firmName}` : ''} on strukcha has been updated.
        </Text>
        {summary ? (
          <Text style={emailStyles.text}>
            <strong>{summary}</strong>
          </Text>
        ) : null}
        {changedBy ? (
          <Text style={emailStyles.text}>This change was made by {changedBy}.</Text>
        ) : null}
        <Button style={emailStyles.button} href={`${SITE_URL}/`}>
          Open strukcha
        </Button>
        <Text style={emailStyles.footer}>
          If this doesn't look right, contact your workspace administrator.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: AccountAccessUpdatedEmail,
  subject: 'Your strukcha account access has been updated',
  displayName: 'Account access updated',
  previewData: {
    name: 'Alex',
    firmName: 'Acme Advisory',
    summary: 'You can now manage billing for this workspace.',
  },
} satisfies TemplateEntry
