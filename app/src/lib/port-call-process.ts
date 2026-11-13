import type { Obligation, PortCall, PortCallDocument } from '../auth/auth';

export type ProgressState = 'completed' | 'in-progress' | 'not-started' | 'blocked';
export type ProcessAction =
  | { kind: 'report'; code: string }
  | { kind: 'noa'; step: 'reports' | 'facts' | 'send' }
  | { kind: 'document'; id: string }
  | { kind: 'review' }
  | { kind: 'edit' }
  | { kind: 'forms'; section: string };
export interface ProcessRow {
  id: string;
  label: string;
  state: ProgressState;
  action: ProcessAction;
  reason?: string;
}
export interface ProcessSection {
  id: string;
  title: string;
  rows: ProcessRow[];
  complete: boolean;
  upload?: boolean;
  cta?: { label: string; state: ProgressState; action: ProcessAction };
}

/** Match the ship's required uploads using the parser's form type or workbook name. */
export function uploadDocumentGroup(document: PortCallDocument): 'effects' | 'national' | 'other' {
  if (document.formType === 'fal4') return 'effects';
  if (document.formType === 'national-spreadsheet' || /national[\s_-]*spreadsheet/i.test(document.fileName)) return 'national';
  return 'other';
}

export function requiredUploadsPresent(documents: readonly PortCallDocument[]): boolean {
  return documents.some(d => uploadDocumentGroup(d) === 'effects') && documents.some(d => uploadDocumentGroup(d) === 'national');
}

/** Progress describes saved data and accepted reports, never the current date. */
export function reportProgress(report: Obligation | undefined, available = true): ProgressState {
  if (report?.state === 'sent' && !report.rejected) return 'completed';
  if (!available) return 'blocked';
  if (report && (report.filled > 0 || report.state === 'ready' || report.state === 'rejected' || report.rejected)) return 'in-progress';
  return 'not-started';
}

const DOCUMENT_GROUPS = [
  { key: 'crew', title: 'Crew and effects', types: ['nsw-crew', 'fal5', 'fal4'], codes: ['CWA', 'EFF', 'CWD'] },
  { key: 'passengers', title: 'Passengers', types: ['nsw-pax', 'fal6'], codes: ['PXA', 'PXD'] },
  { key: 'cargo', title: 'Cargo', types: ['fal2'], codes: ['CGA', 'CGD'] },
  { key: 'dangerous-goods', title: 'Dangerous goods', types: ['fal7'], codes: ['HZA', 'HZD'] },
  { key: 'stores', title: 'Ship stores', types: ['fal3'], codes: ['STA', 'STD'] },
  { key: 'waste', title: 'Waste', types: ['nsw-waste'], codes: ['WAS', 'WAR'] },
  { key: 'security', title: 'Security', types: ['nsw-security'], codes: ['SEC'] },
  { key: 'health', title: 'Health', types: ['nmsw-mdh'], codes: ['MDH'] },
  { key: 'general', title: 'General declaration', types: ['fal1'], codes: [] },
] as const;

const REPORT_NAMES: Record<string, string> = {
  VID: 'Port call (VID)', SID: 'SID (ship data)', SHP: 'SHP (ship data)', CRT: 'CRT (ship data)',
  ATA: 'Date and time of actual arrival', NOD: 'Overview of NOD', ATD: 'Date and time of actual departure',
  CWA: 'Crew list, arrival (CWA)', CWD: 'Crew list, departure (CWD)', EFF: 'Crew effects (EFF)',
  PXA: 'Passenger list, arrival (PXA)', PXD: 'Passenger list, departure (PXD)',
  CGA: 'Cargo declaration, arrival (CGA)', CGD: 'Cargo declaration, departure (CGD)',
  HZA: 'Dangerous goods, arrival (HZA)', HZD: 'Dangerous goods, departure (HZD)',
  STA: 'Ship stores, arrival (STA)', STD: 'Ship stores, departure (STD)',
  WAS: 'Waste notification (WAS)', WAR: 'Waste delivery receipt (WAR)',
  SEC: 'Security information (SEC)', MDH: 'Maritime declaration of health (MDH)',
};

/** The overview links and the report page headlines share these words. */
export function reportLinkLabel(code: string): string { return REPORT_NAMES[code] ?? code; }
export const NOA_LINK_LABELS = {
  reports: 'What goes to NEMO',
  facts: 'Ship, crew and voyage data',
  send: 'Overview and send',
} as const;
/** Reports of the departure side: they are filled after the arrival, before the NOD. */
export const DEPARTURE_REPORTS = new Set(['CWD', 'PXD', 'CGD', 'HZD', 'STD', 'WAR']);

/** The report codes the uploaded documents add to the call, in the order the page lists them. */
export function documentReportCodes(call: PortCall, documents: readonly PortCallDocument[]): string[] {
  return buildProcessSections(call, documents).filter(s => s.id.startsWith('documents-')).flatMap(s => s.rows.map(r => r.id));
}

export function buildProcessSections(
  call: PortCall,
  documents: readonly PortCallDocument[],
  reviewed: readonly string[] = [],
): ProcessSection[] {
  const at = (code: string) => call.obligations.find(o => o.code === code);
  const sent = (code: string) => reportProgress(at(code)) === 'completed';
  const hasVisit = !!call.visitId || sent('VID');
  const section = (id: string, title: string, rows: ProcessRow[]): ProcessSection => ({
    id, title, rows, complete: rows.length > 0 && rows.every(r => r.state === 'completed'),
  });
  const row = (code: string, label: string, available = hasVisit, reason?: string): ProcessRow => ({
    id: code, label, state: code === 'VID' && hasVisit ? 'completed' : reportProgress(at(code), available),
    action: { kind: 'report', code },
    ...(reason && !available && !sent(code) ? { reason } : {}),
  });
  const fileRows: ProcessRow[] = documents.map(d => ({
    id: `document-${d.id}`, label: d.fileName,
    state: d.parseStatus === 'parsed' && !d.shipConfirmNeeded && !(d.summary?.errorCount || d.summary?.warningCount) ? 'completed' : 'in-progress',
    action: { kind: 'document', id: d.id },
  }));
  const result: ProcessSection[] = [
    // The call itself, then its own VID section (user 2026-11-11).
    section('create', 'Create a new port call', [
      { id: 'call', label: 'Edit port call', state: 'completed', action: { kind: 'edit' } },
    ]),
    section('vid', 'Send to NEMO (VID)', [
      row('VID', reportLinkLabel('VID'), true),
      ...['SID', 'SHP', 'CRT'].map(code => row(code, reportLinkLabel(code), hasVisit, 'Send the VID to NEMO first.')),
    ]),
    { id: 'upload', title: 'Upload files', rows: fileRows, upload: true, complete: requiredUploadsPresent(documents) },
  ];

  for (const group of DOCUMENT_GROUPS) {
    const matching = documents.filter(d => d.section === group.key || (group.types as readonly string[]).includes(d.formType ?? ''));
    if (!matching.length) continue;
    const codes = group.codes.filter(code => matching.some(d => {
      if (d.context === 'arrival') return !DEPARTURE_REPORTS.has(code);
      if (d.context === 'departure') return DEPARTURE_REPORTS.has(code);
      return true;
    }));
    const reportRows = codes.map(code => row(code, reportLinkLabel(code), hasVisit, 'Create the port call in NEMO first.'));
    if (reportRows.length) result.push(section(`documents-${group.key}`, group.title, reportRows));
  }

  const noa = at('NOA');
  const factsComplete = !!noa && !noa.rejected && (noa.state === 'sent' || noa.state === 'ready');
  result.push(section('prearrival', 'Pre-arrival (NOA)', [
    { id: 'noa-reports', label: NOA_LINK_LABELS.reports, state: sent('NOA') || reviewed.includes('noa-reports') ? 'completed' : hasVisit ? 'not-started' : 'blocked', action: { kind: 'noa', step: 'reports' } },
    { id: 'noa-facts', label: NOA_LINK_LABELS.facts, state: factsComplete ? 'completed' : reportProgress(noa, hasVisit), action: { kind: 'noa', step: 'facts' } },
    { id: 'noa-send', label: NOA_LINK_LABELS.send, state: reportProgress(noa, hasVisit), action: { kind: 'noa', step: 'send' } },
  ]));
  result.push(section('arrival', 'Actual arrival (ATA)', [row('ATA', reportLinkLabel('ATA'), hasVisit && sent('NOA'))]));
  result.push(section('predeparture', 'Pre-departure notice (NOD)', [row('NOD', reportLinkLabel('NOD'), hasVisit, 'Create the port call in NEMO first.')]));
  result.push(section('departure', 'Actual departure notice (ATD)', [row('ATD', reportLinkLabel('ATD'), hasVisit && sent('ATA') && sent('NOD'))]));
  return result;
}
