# Data API grants (audit 23/10/2026)

- 38 live public tables, RLS enabled on all. Live privileges came from the old automatic defaults (anon/authenticated/service_role full; `tenants` has no UPDATE for anon/authenticated). Unchanged by this work.
- No RLS policy permits signed-out (anon) access, so rebuilt schemas grant anon nothing.
- Baseline migration `drizzle/migrations/0000_data_api_explicit_grants_baseline.sql` writes the intended grants explicitly so preview branches / resets / new projects work:
  - service_role: ALL on every table.
  - authenticated: SELECT/INSERT/UPDATE/DELETE on app tables; SELECT only on `super_admins`, `mfa_verifications`, `tenant_user_audit_log`; `tenants` SELECT/INSERT/DELETE.
  - Backend-only (no authenticated grant on rebuild): `email_send_log`, `email_send_state`, `email_unsubscribe_tokens`, `suppressed_emails`, `signup_rate_events`, `tenant_email_notifications`.
- Optional, needs approval: revoke the legacy anon rights on live tables (defence-in-depth; RLS already blocks).
