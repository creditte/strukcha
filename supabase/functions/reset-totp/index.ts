import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing auth header");

    // Verify the calling user
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) throw new Error("Unauthorized");

    // Use admin client to list and unenroll factors
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: factorsData, error: listErr } = await adminClient.auth.admin.mfa.listFactors({ userId: user.id });
    if (listErr) throw listErr;

    console.log("[reset-totp] Raw factors response:", JSON.stringify(factorsData));

    // Handle both possible response shapes
    const allFactors = factorsData?.factors ?? factorsData?.totp ?? [];
    const totp = allFactors.filter((f: any) => f.factor_type === "totp" || f.type === "totp");
    
    console.log("[reset-totp] TOTP factors to delete:", JSON.stringify(totp.map((f: any) => ({ id: f.id, type: f.factor_type || f.type }))));

    for (const f of totp) {
      const fid = f.id;
      if (!fid || typeof fid !== "string") {
        console.log("[reset-totp] Skipping factor with invalid id:", JSON.stringify(f));
        continue;
      }
      console.log("[reset-totp] Deleting factor:", fid);
      const { error: delErr } = await adminClient.auth.admin.mfa.deleteFactor({
        userId: user.id,
        factorId: fid,
      });
      if (delErr) {
        console.log("[reset-totp] Delete error for", fid, ":", delErr.message);
        throw delErr;
      }
    }

    return new Response(JSON.stringify({ ok: true, removed: totp.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
