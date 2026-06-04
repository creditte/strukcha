import * as React from 'npm:react@18.3.1'
import { Body, Button, Container, Head, Heading, Html, Preview, Text } from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'
import { SITE_NAME, SITE_URL, emailStyles, formatRoleName } from './styles.ts'

interface RoleChangedProps {
  name?: string
  newRole?: string
  previousRole?: string
  firmName?: string
  changedBy?: string
}

const RoleChangedEmail = ({ name, newRole, previousRole, firmName, changedBy }: RoleChangedProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your strukcha role has been updated</Preview>
    <Body style={emailStyles.main}>
      <Container style={emailStyles.container}>
        <Text style={emailStyles.brand}>{SITE_NAME}</Text>
        <Heading style={emailStyles.h1}>Your role has been updated</Heading>
        <Text style={emailStyles.text}>
          {name ? `Hi ${name},` : 'Hi,'} your role{firmName ? ` in ${firmName}` : ''} has been changed
          {previousRole ? ` from ${formatRoleName(previousRole)}` : ''} to{' '}
          <strong>{formatRoleName(newRole)}</strong>.
        </Text>
        {changedBy ? (
          <Text style={emailStyles.text}>This change was made by {changedBy}.</Text>
        ) : null}
        <Text style={emailStyles.text}>
          Your permissions in strukcha may have changed. Sign in to see what you can access.
        </Text>
        <Button style={emailStyles.button} href={`${SITE_URL}/`}>
          Open strukcha
        </Button>
        <Text style={emailStyles.footer}>
          If you weren't expecting this change, contact your workspace owner.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: RoleChangedEmail,
  subject: 'Your strukcha role has been updated',
  displayName: 'Role changed',
  previewData: { name: 'Alex', newRole: 'admin', previousRole: 'user', firmName: 'Acme Advisory' },
} satisfies TemplateEntry
