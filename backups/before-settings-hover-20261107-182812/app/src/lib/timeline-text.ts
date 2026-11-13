/**
 * Port-call timeline in plain words (docs/specs/0035, moved out of the page
 * when the block became its own component, spec 0048). One row per audit
 * action of specs 0026–0046.
 */
import type { TimelineEvent } from '../auth/auth';
import { fmtStamp } from './time';

export function timelineIcon(e: TimelineEvent): string {
  switch (e.action) {
    case 'created':
      return e.details['manual'] ? 'edit_calendar' : 'input';
    case 'plan_updated':
      return 'update';
    case 'arrival_suggested':
    case 'departure_suggested':
      return 'hourglass_top';
    case 'arrival_confirmed':
      return 'anchor';
    case 'departure_confirmed':
      return 'sailing';
    case 'arrival_suggestion_rejected':
    case 'departure_suggestion_rejected':
      return 'block';
    case 'updated':
      return 'edit';
    case 'cancelled':
      return 'block';
    case 'nemo_port_call_created':
      return 'cloud_done';
    case 'nemo_port_call_refused':
      return 'cloud_off';
    case 'nemo_formality_sent':
      return e.details['accepted'] ? 'cloud_done' : 'cloud_off';
    default:
      return 'history';
  }
}

export function timelineText(e: TimelineEvent): string {
  const d = e.details;
  const times = [
    d['eta'] ? `ETA ${fmtStamp(String(d['eta']))}` : '',
    d['etd'] ? `ETD ${fmtStamp(String(d['etd']))}` : '',
  ]
    .filter(Boolean)
    .join(', ');
  switch (e.action) {
    case 'created':
      return d['manual']
        ? `Port call created manually${times ? ` — ${times}` : ''}`
        : `Plan received from ${String(d['source'])}${times ? ` — ${times}` : ''}`;
    case 'plan_updated':
      return `Plan updated from ${String(d['source'])}${times ? ` — ${times}` : ''}`;
    case 'plan_stale':
      return `Older plan from ${String(d['source'])} archived, not applied`;
    case 'plan_ignored_cancelled':
      return `Plan from ${String(d['source'])} ignored — the call is cancelled`;
    case 'arrival_suggested':
      return `Arrival ${fmtStamp(String(d['value']))} reported by ${String(d['source'])} — awaiting confirmation`;
    case 'departure_suggested':
      return `Departure ${fmtStamp(String(d['value']))} reported by ${String(d['source'])} — awaiting confirmation`;
    case 'arrival_confirmed':
      return `Arrival ${fmtStamp(String(d['value']))} confirmed${d['adjusted'] ? ' (time adjusted)' : ''}`;
    case 'departure_confirmed':
      return `Departure ${fmtStamp(String(d['value']))} confirmed${d['adjusted'] ? ' (time adjusted)' : ''}`;
    case 'arrival_suggestion_rejected':
      return `Reported arrival ${fmtStamp(String(d['value']))} rejected`;
    case 'departure_suggestion_rejected':
      return `Reported departure ${fmtStamp(String(d['value']))} rejected`;
    case 'updated': {
      const fields = Object.keys((d['changes'] as Record<string, unknown>) ?? {});
      return fields.length ? `Edited: ${fields.join(', ')}` : 'Saved with no changes';
    }
    case 'cancelled':
      return d['reason'] ? `Cancelled — ${String(d['reason'])}` : 'Cancelled';
    // The NEMO log (spec 0078)
    case 'nemo_port_call_created':
      return `Created in NEMO as ${String(d['visitId'] ?? '—')}${d['route'] === 'ui-backend' ? ' (through the NEMO UI backend)' : ''}`;
    case 'nemo_port_call_refused':
      return d['shipUnknown']
        ? 'NEMO refused the port call — it does not know the ship'
        : `NEMO refused the port call${d['words'] ? ` — ${String(d['words'])}` : ''}`;
    case 'nemo_formality_sent':
      return `${String(d['formalityType'] ?? 'Report')} ${d['update'] ? 'updated in' : 'sent to'} NEMO — ${
        d['accepted'] ? 'accepted' : `rejected${d['words'] ? `: ${String(d['words'])}` : ''}`
      }`;
    default:
      return e.action.replaceAll('_', ' ');
  }
}
