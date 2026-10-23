-- data-api-explicit-grants-baseline
-- From 30/10/2026 new public tables no longer receive automatic Data API grants.
-- Every table below was created by an earlier migration without explicit grants and
-- relied on the old defaults. On the live database these GRANTs are no-ops (the
-- privileges already exist); on rebuilt schemas (preview branches, db reset, new
-- projects) they restore exactly the access the app needs. Nothing is revoked and
-- anon receives nothing: no RLS policy allows signed-out access.
-- Row-level access is still decided by the existing RLS policies.

-- Browser + backend tables (tenant/user isolation enforced by RLS).
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.app_config, public.audit_log, public.duplicate_dismissals, public.entities,
  public.entity_merges, public.favourite_groups, public.feedback, public.import_logs,
  public.invitations, public.mfa_email_codes, public.mfa_settings, public.profiles,
  public.relationship_import_evidence, public.relationships, public.roles,
  public.signup_verifications, public.snapshot_entities, public.snapshot_relationships,
  public.stripe_webhook_events, public.structure_entities, public.structure_relationships,
  public.structure_snapshots, public.structures, public.tenant_users, public.trusted_devices,
  public.user_roles, public.xero_connections, public.xero_oauth_states, public.xpm_groups
  TO authenticated;

-- Read-only for signed-in users (writes happen only in backend functions).
GRANT SELECT ON public.super_admins, public.mfa_verifications, public.tenant_user_audit_log TO authenticated;

-- tenants: UPDATE intentionally not granted (billing fields change only via backend).
GRANT SELECT, INSERT, DELETE ON public.tenants TO authenticated;

-- Backend functions use service_role on every table.
GRANT ALL ON
  public.app_config, public.audit_log, public.duplicate_dismissals, public.email_send_log,
  public.email_send_state, public.email_unsubscribe_tokens, public.entities, public.entity_merges,
  public.favourite_groups, public.feedback, public.import_logs, public.invitations,
  public.mfa_email_codes, public.mfa_settings, public.mfa_verifications, public.profiles,
  public.relationship_import_evidence, public.relationships, public.roles,
  public.signup_rate_events, public.signup_verifications, public.snapshot_entities,
  public.snapshot_relationships, public.stripe_webhook_events, public.structure_entities,
  public.structure_relationships, public.structure_snapshots, public.structures,
  public.super_admins, public.suppressed_emails, public.tenant_user_audit_log,
  public.tenant_users, public.tenants, public.trusted_devices, public.user_roles,
  public.xero_connections, public.xero_oauth_states, public.xpm_groups
  TO service_role;

-- Created by an older migration but absent on live; grant only if it exists.
DO $$ BEGIN
  IF to_regclass('public.tenant_email_notifications') IS NOT NULL THEN
    GRANT ALL ON public.tenant_email_notifications TO service_role;
  END IF;
END $$;