# Support email routing clean-up

Goal: support@strukcha.app becomes the single address for customer support and feedback. hello@strukcha.app stays only for general/sales enquiries. Every automated email that invites a reply gets Reply-To: support@strukcha.app; ones that shouldn't be replied to stop saying so.

## What I found

Support-related places currently pointing at hello@ (all to change to support@):
- Automated emails: "XPM sync didn't complete", "Welcome to strukcha"
- In-app error help text: Xero errors, import errors
- Locked-subscription page ("Need help? Contact support at ...")
- Account-deletion failure messages (two)

Correctly general/sales — leave as hello@:
- Sign-in page footer, onboarding "reach out anytime", pricing/sales contact

Reply invitations in automated email:
- "Subscription canceled" says "Reply to this email and we'll help" — keep the copy, add Reply-To: support@
- "Welcome" currently says the mailbox isn't monitored and asks users to write to hello@ — becomes a normal reply-friendly support line with Reply-To: support@

Feedback: the in-app feedback form already routes to support@ (unchanged). Only the stale comment naming the wrong constant gets fixed.

No reply-to capability exists today — automated mail is sent from noreply@strukcha.app with no Reply-To header at all. That has to be added.

## Changes

1. Shared email constants: support address becomes support@strukcha.app; add a separate general-contact constant for hello@ so the two can't drift again.
2. Email plumbing: templates can declare a reply-to address; the queue carries it and the sending step passes it to the mail provider as a Reply-To header. Emails without one behave exactly as today.
3. Set Reply-To: support@ on the support-related templates: welcome, XPM sync failed, subscription canceled, payment failed, Xero connection lapsed, trial ending, renewal reminder.
4. Copy: welcome and XPM sync-failure emails point to support@ (welcome drops the "this mailbox isn't monitored" line since replies now reach support). Any remaining template that neither invites replies nor gets a Reply-To keeps its current wording.
5. In-app support text: Xero errors, import errors, subscription-locked page and account-deletion messages point to support@.
6. Redeploy the email functions (send, preview, queue worker) so the new templates and Reply-To handling go live.

## Out of scope

Recipient addresses, feedback routing, auth emails (sign-up, password reset, invites), sales/general contact points, and anything unrelated to support routing stay untouched.
