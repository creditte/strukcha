
ALTER TABLE public.xero_oauth_states
  ALTER COLUMN user_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS flow text NOT NULL DEFAULT 'link',
  ADD COLUMN IF NOT EXISTS pending_signup jsonb;

ALTER TABLE public.xero_oauth_states
  ADD CONSTRAINT xero_oauth_states_flow_check
  CHECK (flow IN ('link','login','signup'));
