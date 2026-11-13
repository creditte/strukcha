/** Preserve source wording, not a mapped type. Empty/name-only mentions supply no label. */
export function xpmBusinessStructureFields(label?: string | null): { xpm_business_structure_label?: string } {
  return label?.trim() ? { xpm_business_structure_label: label } : {};
}