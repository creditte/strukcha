-- The new pure policy helpers get the same execute access as the existing
-- relationship_policy_evaluate / _rp_check_pair helpers (anon, authenticated,
-- service_role), so every caller that could evaluate the policy before still
-- can. They read no data and are IMMUTABLE.
GRANT EXECUTE ON FUNCTION public._rp_check_pair_x(jsonb, text, text, text, boolean) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.relationship_policy_evaluate_core(text, text, text, boolean, boolean) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.relationship_policy_evaluate_xpm(text, text, text, boolean) TO anon, authenticated, service_role;
