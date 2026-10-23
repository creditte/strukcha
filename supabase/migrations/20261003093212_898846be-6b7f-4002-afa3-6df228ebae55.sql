-- 1. Sign-up abuse controls -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.signup_rate_events (
  id bigserial PRIMARY KEY,
  bucket text NOT NULL,
  key_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.signup_rate_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.signup_rate_events_id_seq TO service_role;
ALTER TABLE public.signup_rate_events ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS signup_rate_events_lookup ON public.signup_rate_events (bucket, key_hash, created_at);

ALTER TABLE public.signup_verifications ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;

-- Records one hit and returns true if still within the limit; false if over it.
CREATE OR REPLACE FUNCTION public.signup_rate_hit(_bucket text, _key_hash text, _max integer, _window_seconds integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  IF _bucket IS NULL OR _key_hash IS NULL OR _max < 1 OR _window_seconds < 1 THEN RETURN false; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(_bucket || ':' || _key_hash));
  DELETE FROM public.signup_rate_events WHERE created_at < now() - interval '2 days';
  SELECT count(*) INTO n FROM public.signup_rate_events
   WHERE bucket = _bucket AND key_hash = _key_hash
     AND created_at > now() - make_interval(secs => _window_seconds);
  IF n >= _max THEN RETURN false; END IF;
  INSERT INTO public.signup_rate_events(bucket, key_hash) VALUES (_bucket, _key_hash);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.signup_rate_hit(text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.signup_rate_hit(text, text, integer, integer) TO service_role;

-- Checks a code against the newest live code for the email. One-time on success;
-- wrong guesses count, and the code is burnt after _max_attempts.
CREATE OR REPLACE FUNCTION public.signup_check_code(_email text, _code text, _max_attempts integer DEFAULT 5)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.signup_verifications%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.signup_verifications
   WHERE email = lower(trim(_email)) AND used = false AND expires_at > now()
   ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF r.code = _code AND r.attempts < _max_attempts THEN
    UPDATE public.signup_verifications SET used = true
     WHERE email = r.email AND used = false;
    RETURN r.user_id;
  END IF;
  UPDATE public.signup_verifications
     SET attempts = attempts + 1, used = (attempts + 1 >= _max_attempts)
   WHERE id = r.id;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.signup_check_code(text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.signup_check_code(text, text, integer) TO service_role;

-- 2. Email queue functions: pin search_path (bodies already use pgmq.*) -----
ALTER FUNCTION public.enqueue_email(text, jsonb) SET search_path = '';
ALTER FUNCTION public.read_email_batch(text, integer, integer) SET search_path = '';
ALTER FUNCTION public.delete_email(text, bigint) SET search_path = '';
ALTER FUNCTION public.move_to_dlq(text, text, bigint, jsonb) SET search_path = '';

-- 3. app_config: no public read. Backend uses service role; super admins keep their policy.
DROP POLICY IF EXISTS "app_config readable by all" ON public.app_config;

-- 4. tenant-assets: replace open listing with own-firm listing. Public links still work.
DROP POLICY IF EXISTS "Public read tenant assets" ON storage.objects;
DROP POLICY IF EXISTS "Members list own tenant assets" ON storage.objects;
CREATE POLICY "Members list own tenant assets" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'tenant-assets'
     AND (storage.foldername(name))[1] = 'tenant'
     AND (storage.foldername(name))[2] = (public.get_user_tenant_id(auth.uid()))::text);