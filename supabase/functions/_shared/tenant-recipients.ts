import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export interface TenantRecipient {
  email: string
  name?: string
}

/** Workspace owner — default for billing/subscription notices. */
export async function getTenantOwnerRecipient(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<TenantRecipient | null> {
  const { data } = await supabase
    .from('tenant_users')
    .select('email, display_name')
    .eq('tenant_id', tenantId)
    .eq('role', 'owner')
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!data?.email) return null
  return { email: data.email, name: data.display_name ?? undefined }
}

/** Users who manage billing, or the owner if none are designated. */
export async function getTenantBillingRecipients(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<TenantRecipient[]> {
  const { data: billingUsers } = await supabase
    .from('tenant_users')
    .select('email, display_name')
    .eq('tenant_id', tenantId)
    .eq('can_manage_billing', true)
    .eq('status', 'active')

  if (billingUsers?.length) {
    return billingUsers
      .filter((u) => u.email)
      .map((u) => ({ email: u.email!, name: u.display_name ?? undefined }))
  }

  const owner = await getTenantOwnerRecipient(supabase, tenantId)
  return owner ? [owner] : []
}

export async function getTenantUserRecipient(
  supabase: SupabaseClient,
  tenantUserId: string,
): Promise<(TenantRecipient & { tenant_id?: string; role?: string }) | null> {
  const { data } = await supabase
    .from('tenant_users')
    .select('email, display_name, tenant_id, role')
    .eq('id', tenantUserId)
    .maybeSingle()

  if (!data?.email) return null
  return {
    email: data.email,
    name: data.display_name ?? undefined,
    tenant_id: data.tenant_id,
    role: data.role,
  }
}
