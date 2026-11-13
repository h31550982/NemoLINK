/**
 * The place in the port, picked in the NOA wizard (user 2026-09-30): the
 * port area and berth rows are editable, from the port's own list; an area
 * clears a berth outside it, a berth sets its area.
 */
import { BadRequestException } from '@nestjs/common';
import { PortCallNemoController } from '../src/admin/admin.controllers';
import { noaLedger } from '../src/canonical/noa-ledger';
import { noaSnapshot } from './noa-fixture';

const CALL = '0457030f-0000-4000-8000-000000000001';
const USER = { orgSlug: 'fleetco', role: 'admin' } as never;
const AREAS = [
  { code: 'FIRAU-BB', name: 'Petäjäs', isps: true, berths: [{ code: 'FIRAU-BB-BB1', name: 'Petäjäs 1' }] },
  { code: 'FIRAU-BE', name: 'Hakuni', isps: true, berths: [{ code: 'FIRAU-BE-BE2', name: 'Hakuni 2' }] },
];

function controller(berth: string | null) {
  const portCalls = {
    snapshotFor: jest.fn().mockResolvedValue({ row: { portLocode: 'FIRAU', berth } }),
    portAreas: jest.fn().mockResolvedValue(AREAS),
    updateManual: jest.fn().mockResolvedValue(undefined),
  };
  const c = new PortCallNemoController({} as never, portCalls as never, {} as never, {} as never);
  const save = (key: string, value: string | null) => c.noaField({ user: USER } as never, CALL, { key, value });
  return { portCalls, save };
}

describe('NOA place rows (port area, berth)', () => {
  it('are editable code rows, area before berth', () => {
    const rows = noaLedger(noaSnapshot(), null, {
      agentId: null, agencyName: null, mobile: null, email: null,
      businessId: null, street: null, postcode: null, city: null, countryCode: null,
    });
    const place = rows.filter((r) => r.codelist === 'portArea' || r.codelist === 'berth');
    expect(place.map((r) => [r.key, r.editable, r.owner])).toEqual([
      ['callCore:portArea', true, 'callCore'],
      ['callCore:berth', true, 'callCore'],
    ]);
  });

  it('a berth sets its area too', async () => {
    const { portCalls, save } = controller(null);
    await save('callCore:berth', 'FIRAU-BE-BE2');
    expect(portCalls.updateManual).toHaveBeenCalledWith(USER, CALL, { portAreaCode: 'FIRAU-BE', berth: 'FIRAU-BE-BE2' });
  });

  it('an area replaces a berth outside it — with its only berth — and keeps one inside', async () => {
    const outside = controller('FIRAU-BB-BB1');
    await outside.save('callCore:portArea', 'FIRAU-BE');
    expect(outside.portCalls.updateManual).toHaveBeenCalledWith(USER, CALL, { portAreaCode: 'FIRAU-BE', berth: 'FIRAU-BE-BE2' });

    const inside = controller('FIRAU-BB-BB1');
    await inside.save('callCore:portArea', 'FIRAU-BB');
    expect(inside.portCalls.updateManual).toHaveBeenCalledWith(USER, CALL, { portAreaCode: 'FIRAU-BB' });
  });

  it('clearing the area clears the berth', async () => {
    const { portCalls, save } = controller('FIRAU-BB-BB1');
    await save('callCore:portArea', null);
    expect(portCalls.updateManual).toHaveBeenCalledWith(USER, CALL, { portAreaCode: null, berth: null });
  });

  it('refuses a code that is not the port’s, and the other call fields', async () => {
    const { portCalls, save } = controller(null);
    await expect(save('callCore:berth', 'FIHEL-ES-1')).rejects.toThrow(BadRequestException);
    await expect(save('callCore:eta', '2026-10-01T10:00:00Z')).rejects.toThrow('not edited here');
    expect(portCalls.updateManual).not.toHaveBeenCalled();
  });
});
