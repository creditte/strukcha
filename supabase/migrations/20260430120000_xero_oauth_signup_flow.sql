-- Allow starting Xero OAuth without an existing auth user (signup / login-with-Xero).
ALTER TABLE public.xero_oauth_states
  ADD COLUMN IF NOT EXISTS flow text NOT NULL DEFAULT 'link',
  ADD COLUMN IF NOT EXISTS pending_signup jsonb;

ALTER TABLE public.xero_oauth_states
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.xero_oauth_states
  DROP CONSTRAINT IF EXISTS xero_oauth_states_flow_user_ck;

ALTER TABLE public.xero_oauth_states
  ADD CONSTRAINT xero_oauth_states_flow_user_ck CHECK (
    (flow = 'link' AND user_id IS NOT NULL)
    OR (flow IN ('signup', 'login') AND user_id IS NULL)
  );

COMMENT ON COLUMN public.xero_oauth_states.flow IS 'link = connect Xero for logged-in user; signup/login = anonymous OAuth start';
COMMENT ON COLUMN public.xero_oauth_states.pending_signup IS 'For flow=signup: { firm_name, selected_plan, selected_billing }';
