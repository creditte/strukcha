
ALTER TABLE public.xero_oauth_states
  ADD COLUMN IF NOT EXISTS pending_link jsonb,
  ADD COLUMN IF NOT EXISTS selection_token text;
CREATE INDEX IF NOT EXISTS xero_oauth_states_selection_token_idx
  ON public.xero_oauth_states(selection_token);
