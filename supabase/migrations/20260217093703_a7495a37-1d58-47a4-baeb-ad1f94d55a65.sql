
CREATE TABLE public.xero_connections (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  tenant_id text NOT NULL,
  xero_tenant_id text,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  connected_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

ALTER TABLE public.xero_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own xero connections"
  ON public.xero_connections FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own xero connections"
  ON public.xero_connections FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own xero connections"
  ON public.xero_connections FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own xero connections"
  ON public.xero_connections FOR DELETE
  USING (auth.uid() = user_id);
