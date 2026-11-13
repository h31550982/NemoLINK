/**
 * Spec 0075 — one resolver for "what goes to NEMO" for a ship: the org's
 * live overrides on top of the master record (specs 0061 / 0068), shared by
 * the ship dialog and the port-call report checklists.
 */

import { resolveShip } from '../src/canonical/ship-resolve';
import { applyParticularsToData } from '../src/canonical/ship-master-data';
import { withOverride } from '../src/canonical/ship-lanes';

const AT = '2026-09-25T10:00:00Z';
const master = applyParticularsToData({}, { grossWeight: 2500, flagState: 'FI' });
const identity = { name: 'CARISMA', mmsi: '230123456', callSign: 'OJAB' };

describe('resolveShip (spec 0075)', () => {
  it('without a fleet row the master values stand', () => {
    const r = resolveShip(master, null, identity);
    expect(r.name).toBe('CARISMA');
    expect(r.particulars.grossWeight).toBe(2500);
  });

  it("the org's override wins over the master, identity and particulars alike", () => {
    let fleet = withOverride({}, 'grossWeight', { value: 2600, author: 'ops', at: AT });
    fleet = withOverride(fleet, 'name', { value: 'Carisma', author: 'ops', at: AT });
    const r = resolveShip(master, fleet, identity);
    expect(r.particulars.grossWeight).toBe(2600);
    expect(r.name).toBe('Carisma');
    expect(r.particulars.flagState).toBe('FI');
  });

  it('an override set to empty removes the value from what goes', () => {
    const fleet = withOverride({}, 'flagState', { value: null, author: 'ops', at: AT });
    expect(resolveShip(master, fleet, identity).particulars.flagState).toBeUndefined();
  });
});
