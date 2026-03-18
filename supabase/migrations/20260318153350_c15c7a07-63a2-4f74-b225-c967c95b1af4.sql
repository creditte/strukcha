-- Fix 1: RLS policies for mfa_email_codes
-- Only the edge function (service role) should access this table directly.
-- Deny all access for normal users (service role bypasses RLS).
CREATE POLICY "deny_all_select_mfa_email_codes"
  ON public.mfa_email_codes FOR SELECT
  TO authenticated
  USING (false);

CREATE POLICY "deny_all_insert_mfa_email_codes"
  ON public.mfa_email_codes FOR INSERT
  TO authenticated
  WITH CHECK (false);

CREATE POLICY "deny_all_update_mfa_email_codes"
  ON public.mfa_email_codes FOR UPDATE
  TO authenticated
  USING (false);

CREATE POLICY "deny_all_delete_mfa_email_codes"
  ON public.mfa_email_codes FOR DELETE
  TO authenticated
  USING (false);

-- Fix 2: RLS policies for xero_oauth_states
-- Only the edge function (service role) should access this table directly.
CREATE POLICY "deny_all_select_xero_oauth_states"
  ON public.xero_oauth_states FOR SELECT
  TO authenticated
  USING (false);

CREATE POLICY "deny_all_insert_xero_oauth_states"
  ON public.xero_oauth_states FOR INSERT
  TO authenticated
  WITH CHECK (false);

CREATE POLICY "deny_all_update_xero_oauth_states"
  ON public.xero_oauth_states FOR UPDATE
  TO authenticated
  USING (false);

CREATE POLICY "deny_all_delete_xero_oauth_states"
  ON public.xero_oauth_states FOR DELETE
  TO authenticated
  USING (false);