import { supabase } from "@/integrations/supabase/client";

/**
 * The one active diagram already linked to this XPM group (by group id, never
 * by name). Returns null when there is none or more than one, so those cases
 * still go through the review box first.
 */
export async function findLinkedXpmStructure(groupUuid: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("structures")
    .select("id")
    .eq("xpm_group_uuid", groupUuid)
    .eq("is_scenario", false)
    .is("archived_at", null)
    .limit(2);
  if (error || !data || data.length !== 1) return null;
  return data[0].id;
}

/** Query flag telling the editor to check XPM for updates in the background. */
export const XPM_CHECK_PARAM = "xpm";

export function editorUrlWithXpmCheck(structureId: string): string {
  return `/structures/${structureId}?${XPM_CHECK_PARAM}=check`;
}
