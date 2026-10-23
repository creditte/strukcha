-- Regression checks for sign-up limits, code checks, settings and logo-file access.
-- Runs in a transaction and ROLLS BACK. Uses only fake example.invalid data.
BEGIN;
CREATE TEMP TABLE _r(check_name text, pass boolean) ON COMMIT DROP;

-- rate limit: 2 allowed then refused; other key unaffected
INSERT INTO _r SELECT 'rate: 1st allowed', public.signup_rate_hit('t_bucket','k1',2,3600);
INSERT INTO _r SELECT 'rate: 2nd allowed', public.signup_rate_hit('t_bucket','k1',2,3600);
INSERT INTO _r SELECT 'rate: 3rd refused', NOT public.signup_rate_hit('t_bucket','k1',2,3600);
INSERT INTO _r SELECT 'rate: other key separate', public.signup_rate_hit('t_bucket','k2',2,3600);
UPDATE public.signup_rate_events SET created_at = now() - interval '2 hours' WHERE bucket='t_bucket' AND key_hash='k1';
INSERT INTO _r SELECT 'rate: window resets', public.signup_rate_hit('t_bucket','k1',2,3600);

-- code checks (fake user id, fake email)
INSERT INTO public.signup_verifications(user_id,email,code,expires_at)
VALUES ('00000000-0000-0000-0000-0000000000aa','t1@example.invalid','123456', now()+interval '10 min');
INSERT INTO _r SELECT 'code: wrong refused', public.signup_check_code('t1@example.invalid','000000',3) IS NULL;
INSERT INTO _r SELECT 'code: right accepted', public.signup_check_code('T1@example.invalid','123456',3) = '00000000-0000-0000-0000-0000000000aa';
INSERT INTO _r SELECT 'code: one-time', public.signup_check_code('t1@example.invalid','123456',3) IS NULL;

INSERT INTO public.signup_verifications(user_id,email,code,expires_at)
VALUES ('00000000-0000-0000-0000-0000000000bb','t2@example.invalid','222222', now()+interval '10 min');
SELECT public.signup_check_code('t2@example.invalid','000001',3);
SELECT public.signup_check_code('t2@example.invalid','000002',3);
SELECT public.signup_check_code('t2@example.invalid','000003',3);
INSERT INTO _r SELECT 'code: burnt after max attempts', public.signup_check_code('t2@example.invalid','222222',3) IS NULL;

INSERT INTO public.signup_verifications(user_id,email,code,expires_at)
VALUES ('00000000-0000-0000-0000-0000000000cc','t3@example.invalid','333333', now()-interval '1 min');
INSERT INTO _r SELECT 'code: expired refused', public.signup_check_code('t3@example.invalid','333333',3) IS NULL;

-- privileges
INSERT INTO _r SELECT 'anon cannot run rate fn', NOT has_function_privilege('anon','public.signup_rate_hit(text,text,integer,integer)','EXECUTE');
INSERT INTO _r SELECT 'authenticated cannot run code fn', NOT has_function_privilege('authenticated','public.signup_check_code(text,text,integer)','EXECUTE');
INSERT INTO _r SELECT 'service role can run code fn', has_function_privilege('service_role','public.signup_check_code(text,text,integer)','EXECUTE');
INSERT INTO _r SELECT 'email fns pinned', (SELECT bool_and(proconfig @> ARRAY['search_path=""']) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('enqueue_email','read_email_batch','delete_email','move_to_dlq'));

-- settings table and logo listing
INSERT INTO _r SELECT 'service role reads settings', (SELECT count(*) > 0 FROM public.app_config);
GRANT ALL ON _r TO anon, authenticated;
SET LOCAL ROLE anon;
INSERT INTO _r SELECT 'anon cannot read settings', (SELECT count(*) = 0 FROM public.app_config);
INSERT INTO _r SELECT 'anon cannot list logo files', (SELECT count(*) = 0 FROM storage.objects WHERE bucket_id='tenant-assets');
RESET ROLE;

SELECT * FROM _r ORDER BY check_name;
ROLLBACK;
