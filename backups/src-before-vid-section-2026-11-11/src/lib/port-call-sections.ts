/** Stable page names for the port-call workflow. */
export const PORT_CALL_SECTIONS = [
  { id: 'nemo', label: 'Port call in NEMO' },
  { id: 'ship-data', label: 'Ship data' },
  { id: 'upload', label: 'Upload files' },
  { id: 'documents', label: 'Review documents' },
  { id: 'pre-arrival', label: 'Pre-arrival (NOA)' },
  { id: 'arrival', label: 'Actual arrival (ATA)' },
  { id: 'pre-departure', label: 'Pre-departure (NOD)' },
  { id: 'departure', label: 'Actual departure (ATD)' },
] as const;

export function reportSection(code: string): string {
  if (code === 'VID') return 'nemo';
  if (['SID', 'SHP', 'CRT'].includes(code)) return 'ship-data';
  if (['NOA', 'DUE'].includes(code)) return 'pre-arrival';
  if (code === 'ATA') return 'arrival';
  if (code === 'NOD') return 'pre-departure';
  if (code === 'ATD') return 'departure';
  return 'report';
}

export function sectionLocation(callId: string, section: string, itemId?: string, query: Record<string, string> = {}) {
  return { name: 'port-call-section', params: { callId, section, ...(itemId ? { itemId } : {}) }, query };
}

/** A final send advances only when NEMO accepted every result. */
export function sendWasAccepted(receipt: { results: readonly { accepted: boolean }[] }): boolean {
  return receipt.results.length > 0 && receipt.results.every(result => result.accepted);
}

export function availableSections(canEdit: boolean, canUpload: boolean) {
  return PORT_CALL_SECTIONS.filter(section => ['upload', 'documents'].includes(section.id) ? canUpload : canEdit);
}

export function sectionNeighbors(section: string, canEdit: boolean, canUpload: boolean) {
  const sections = availableSections(canEdit, canUpload);
  const active = ['document', 'report'].includes(section) ? 'documents' : section;
  const index = sections.findIndex(item => item.id === active);
  const previous = index > 0 ? sections[index - 1] : undefined;
  // The beginning of the report flow leads back to the port-call overview.
  return { previous: previous?.id === 'nemo' ? undefined : previous, next: index >= 0 ? sections[index + 1] : sections[0] };
}

// Files remain in memory while the overview gives way to the section page.
const pendingUploads = new Map<string, File[]>();
export function stageSectionUploads(callId: string, files: File[]): void { pendingUploads.set(callId, files); }
export function takeSectionUploads(callId: string): File[] {
  const files = pendingUploads.get(callId) ?? [];
  pendingUploads.delete(callId);
  return files;
}
