# Sign-in audit and "Set password" fix

## What we found so far
- The app decides whether to force the "Set Your Password" screen using one yes/no flag on the user's profile ("onboarding complete"). The same flag is also used for the first-time walkthrough, so the two ideas are mixed up.
- Anyone whose flag is "no" and who did not sign up through the normal form is sent to Set Password before they can use the app. Xero users fall into that group.
- Xero sign-up itself sets the flag to "yes", but an automatic step on first login sets it back to "no" when the person is matched to a firm invite or moved between firms. Invited staff who first arrive through "Sign in with Xero" are always forced to set a password.
- No Xero-created accounts exist in the data yet, so the exact path the reported user took is **not yet confirmed**. Step 1 reproduces it.
- Settings has no "Change / set password" option. The only password entry is the forced screen.

## Changes
1. **Reproduce first.** Run Xero sign-up and invite-plus-Xero-sign-in against a safe test firm. Record which screen appears and why. Nothing else changes until the cause is confirmed.
2. **Separate the two meanings.** Add a dedicated "has chosen a password" marker. The first-time walkthrough keeps its own flag.
3. **Stop forcing Set Password for Xero users.** People who sign up or sign in with Xero go straight into the app (card setup, then two-factor, as today). Invited staff who accept by email and have no Xero sign-in still get the Set Password screen, because otherwise they have no way to log in.
4. **Add a Password card to Settings → Account.**
   - Xero-only users see "Set a password" with new and confirm fields. After that they can also log in with email.
   - Users who already have a password see "Change password", which asks for the current password.
   - The card uses the same show/hide field style and 6-character minimum as today.
5. **Two-factor check.** Some security steps ask for your password again, such as resetting your authenticator. Xero-only users have no password yet, so they'll be offered "Set a password first" instead of hitting a dead end.
6. **Final report.** A report in Files covering every step of both journeys (Xero and email/password), each marked Working / Works with poor UX / Broken, with evidence and suggested next steps:
   - Xero: sign up, sign in, "no account" and "already exists" cases, invited staff, reconnecting, the organisation picker, card setup, two-factor.
   - Email/password: sign up, email verification, card setup, two-factor setup and verify, trusted devices, forgot/reset password, invite, set password, sign out, locked accounts.

## Out of scope
Pricing, billing rules, the Xero sync, and diagram behaviour.

## Technical details
- Migration: add `profiles.password_set boolean not null default false` and backfill it to true for self-service signups and for users who already have `onboarding_complete = true` and are not Xero-sourced. `link_tenant_user_on_login` stops resetting the password gate. Moving a user between firms only resets the walkthrough.
- `xero-signup-callback`: sets `password_set=false`, `onboarding_complete=true` and `signup_source: "xero"` as today.
- `xero-login-callback`: when an invited user's first sign-in comes through Xero, it stamps `user_metadata.auth_method="xero"`.
- `ProtectedRoute.tsx` and `Login.tsx`: redirect to `/setup-password` only when `password_set=false` and the user has no Xero sign-in (`signup_source` / `auth_method` is not xero).
- `SetupPassword.tsx`: also sets `password_set=true`.
- New `src/components/settings/PasswordSettings.tsx` on the Account tab. It uses `updateUser({ password })` when `password_set=false`, and `updateUser({ password, current_password })` otherwise. After success it sets `password_set=true`.
- `MfaSettings.tsx` / `reset-totp`: when `password_set=false`, show a "Set a password first" prompt instead of the password field.
- The report goes to `/mnt/documents/strukcha-auth-flow-report.md`.
