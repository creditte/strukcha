import * as React from 'npm:react@18.3.1'
import { Body, Container, Head, Heading, Html, Preview, Text } from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'
import { SITE_NAME, emailStyles } from './styles.ts'

interface UserDeactivatedProps {
  name?: string
  firmName?: string
  deactivatedBy?: string
}

const UserDeactivatedEmail = ({ name, firmName, deactivatedBy }: UserDeactivatedProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your strukcha account access has been deactivated</Preview>
    <Body style={emailStyles.main}>
      <Container style={emailStyles.container}>
        <Text style={emailStyles.brand}>{SITE_NAME}</Text>
        <Heading style={emailStyles.h1}>Account deactivated</Heading>
        <Text style={emailStyles.text}>
          {name ? `Hi ${name},` : 'Hi,'} your access{firmName ? ` to ${firmName}` : ''} on strukcha has been
          deactivated. You will no longer be able to sign in to this workspace.
        </Text>
        {deactivatedBy ? (
          <Text style={emailStyles.text}>This was done by {deactivatedBy}.</Text>
        ) : null}
        <Text style={emailStyles.text}>
          If you believe this was a mistake, contact your workspace owner or administrator.
        </Text>
        <Text style={emailStyles.footer}>
          You may still receive transactional emails related to your account where applicable.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: UserDeactivatedEmail,
  subject: 'Your strukcha account has been deactivated',
  displayName: 'User deactivated',
  previewData: { name: 'Alex', firmName: 'Acme Advisory' },
} satisfies TemplateEntry
