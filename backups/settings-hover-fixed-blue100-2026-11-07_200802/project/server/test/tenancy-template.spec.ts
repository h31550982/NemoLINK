import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractTemplateDdl, validateSlug } from '../src/tenancy/template';

const schemaSql = readFileSync(join(__dirname, '..', '..', 'schema.sql'), 'utf8');

describe('extractTemplateDdl (spec 0010 AC 1)', () => {
  it('extracts the org_template section with all 13 tenant tables', () => {
    const ddl = extractTemplateDdl(schemaSql);
    const tables = [...ddl.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map(
      (m) => m[1],
    );
    expect(tables.sort()).toEqual(
      [
        'audit_event',
        'call_form_entry', // values typed into the NEMO tables (spec 0096)
        'declaration',
        'email_message',
        'field_resolution',
        'lane_data',
        'mapping_alias',
        'port_call',
        'port_call_document', // spec 0049
        'source_record',
        'submission',
        'fleet_ship', // the org's shortlist of the shared master list (spec 0068)
        'ship_certificate_file', // the org's copies of its ships' certificates (spec 0084)
        // no 'ship': ships are platform data since spec 0067 (ADR 0005)
      ].sort(),
    );
  });

  it('contains no platform-qualified or schema-creating statements, bar the ship FK', () => {
    const ddl = extractTemplateDdl(schemaSql);
    // The one sanctioned cross-schema reference (spec 0067 §1): port calls
    // point at the shared platform.ship record. Nothing else may.
    expect(ddl).toMatch(/ship_id\s+uuid REFERENCES platform\.ship\(id\)/);
    expect(ddl.replace(/platform\.ship\b/g, '')).not.toMatch(/platform\./);
    expect(ddl).not.toMatch(/CREATE SCHEMA/i);
    expect(ddl).not.toMatch(/search_path/);
  });

  it('errors on missing markers instead of partial extraction', () => {
    expect(() => extractTemplateDdl('CREATE TABLE x ();')).toThrow(/missing template marker/);
    expect(() =>
      extractTemplateDdl('SET search_path = org_template;\nCREATE TABLE x ();'),
    ).toThrow(/missing template end marker/);
  });

  it('errors on an empty template section', () => {
    expect(() =>
      extractTemplateDdl('SET search_path = org_template;\n\nRESET search_path;'),
    ).toThrow(/no tables/);
  });
});

describe('validateSlug (spec 0010 AC 1)', () => {
  it('accepts well-formed slugs', () => {
    for (const slug of ['demo', 'nauticai', 'org2', 'a_b_c']) {
      expect(() => validateSlug(slug)).not.toThrow();
    }
  });

  it('rejects malformed slugs', () => {
    for (const slug of ['Demo', '2org', 'a-b', 'a b', '', 'x'.repeat(41), "a';--"]) {
      expect(() => validateSlug(slug)).toThrow(/Invalid org slug/);
    }
  });

  it('rejects reserved names', () => {
    for (const slug of ['platform', 'org_template', 'public', 'information_schema', 'pg_temp']) {
      expect(() => validateSlug(slug)).toThrow(/reserved/);
    }
  });
});
