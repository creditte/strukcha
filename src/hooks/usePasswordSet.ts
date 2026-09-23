import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/** Whether the signed-in user has chosen their own password (Xero-only users haven't). */
export function usePasswordSet() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = ["password-set", user?.id];
  const query = useQuery({
    queryKey: key,
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("password_set")
        .eq("user_id", user!.id)
        .maybeSingle();
      return (data as { password_set?: boolean } | null)?.password_set ?? false;
    },
  });
  return {
    passwordSet: query.data ?? null,
    loading: query.isLoading,
    markSet: () => qc.setQueryData(key, true),
  };
}

export function isXeroUser(meta: Record<string, unknown> | undefined) {
  return meta?.signup_source === "xero" || meta?.auth_method === "xero";
}
