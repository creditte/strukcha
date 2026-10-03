-- Security regression checks for user role access. Runs inside a transaction
-- and ROLLS BACK: nothing is kept. Returns one row per check (pass = true).
-- U = ordinary creditte user, A = creditte admin, X = admin in another firm.
BEGIN;
CREATE TEMP TABLE _r(check_name text, pass boolean) ON COMMIT DROP;
GRANT ALL ON _r TO authenticated, anon, service_role;

-- ── ordinary user U ──
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"ce2a9860-a759-4f63-a814-bd3ab615f4d1","role":"authenticated"}', true);
INSERT INTO _r SELECT 'user: has_role on self works', public.has_role('ce2a9860-a759-4f63-a814-bd3ab615f4d1', 'user');
INSERT INTO _r SELECT 'user: reads only own role rows', (SELECT bool_and(user_id = auth.uid()) AND count(*) > 0 FROM public.user_roles);
INSERT INTO _r SELECT 'user: cannot probe admin via has_role', NOT public.has_role('8e54bf79-9818-43d3-9af4-ff662e8b0331', 'admin');
INSERT INTO _r SELECT 'user: cannot probe other firm via has_role', NOT public.has_role('3442ae1c-b115-42eb-85ad-f9f59ef76ea7', 'admin');
INSERT INTO _r SELECT 'user: role-name list hidden', (SELECT count(*) = 0 FROM public.roles);
WITH ins AS (INSERT INTO public.user_roles(user_id, role) SELECT 'ce2a9860-a759-4f63-a814-bd3ab615f4d1', 'admin' WHERE false RETURNING 1) SELECT 1;
RESET ROLE;

-- user cannot grant themselves admin (RLS rejects)
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"ce2a9860-a759-4f63-a814-bd3ab615f4d1","role":"authenticated"}', true);
SAVEPOINT s1;
DO $$ BEGIN
  INSERT INTO public.user_roles(user_id, role) VALUES ('ce2a9860-a759-4f63-a814-bd3ab615f4d1', 'admin');
  INSERT INTO _r VALUES ('user: cannot self-grant admin', false);
EXCEPTION WHEN insufficient_privilege OR check_violation OR unique_violation THEN
  INSERT INTO _r VALUES ('user: cannot self-grant admin', true);
END $$;
RESET ROLE;

-- ── creditte admin A ──
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"8e54bf79-9818-43d3-9af4-ff662e8b0331","role":"authenticated"}', true);
INSERT INTO _r SELECT 'admin: sees own-firm member roles', (SELECT count(*) > 1 FROM public.user_roles WHERE user_id = 'ce2a9860-a759-4f63-a814-bd3ab615f4d1' OR user_id = auth.uid());
INSERT INTO _r SELECT 'admin: cannot see other firm roles', (SELECT count(*) = 0 FROM public.user_roles WHERE user_id = '3442ae1c-b115-42eb-85ad-f9f59ef76ea7');
INSERT INTO _r SELECT 'admin: has_role cannot probe others', NOT public.has_role('3442ae1c-b115-42eb-85ad-f9f59ef76ea7', 'admin');
WITH ins AS (INSERT INTO public.user_roles(user_id, role) VALUES ('ce2a9860-a759-4f63-a814-bd3ab615f4d1', 'editor') RETURNING 1)
INSERT INTO _r SELECT 'admin: can manage own-firm role', count(*) = 1 FROM ins;
DO $$ BEGIN
  INSERT INTO public.user_roles(user_id, role) VALUES ('3442ae1c-b115-42eb-85ad-f9f59ef76ea7', 'editor');
  INSERT INTO _r VALUES ('admin: cannot add role cross-firm', false);
EXCEPTION WHEN insufficient_privilege OR check_violation THEN
  INSERT INTO _r VALUES ('admin: cannot add role cross-firm', true);
END $$;
WITH d AS (DELETE FROM public.user_roles WHERE user_id = '3442ae1c-b115-42eb-85ad-f9f59ef76ea7' RETURNING 1)
INSERT INTO _r SELECT 'admin: cannot delete cross-firm role', count(*) = 0 FROM d;
RESET ROLE;

-- ── signed out ──
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
INSERT INTO _r SELECT 'anon: has_role always false', NOT public.has_role('8e54bf79-9818-43d3-9af4-ff662e8b0331', 'admin');
RESET ROLE;

-- ── backend (service role) ──
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
INSERT INTO _r SELECT 'backend: has_role checks any user', public.has_role('8e54bf79-9818-43d3-9af4-ff662e8b0331', 'admin');
INSERT INTO _r SELECT 'backend: reads all role rows', (SELECT count(DISTINCT user_id) > 2 FROM public.user_roles);
RESET ROLE;

SELECT * FROM _r;
ROLLBACK;
