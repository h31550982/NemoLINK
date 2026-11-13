import test from 'node:test';
import assert from 'node:assert/strict';
import type { Obligation, PortCall, PortCallDocument } from '../src/auth/auth.ts';
import { buildProcessSections, reportProgress } from '../src/lib/port-call-process.ts';

const obligation = (code: string, state: Obligation['state'], more: Partial<Obligation> = {}) => ({ code, state, filled: 0, missing: [], total: 4, ...more }) as Obligation;
const call = (obligations: Obligation[] = [], visitId: string | null = null) => ({ id: 'test-call', obligations, visitId }) as PortCall;
const document = (more: Partial<PortCallDocument> = {}) => ({ id: 'doc-1', fileName: 'manifest.xlsx', formType: 'fal2', context: 'arrival', parseStatus: 'parsed', summary: { errorCount: 0, warningCount: 0 }, ...more }) as PortCallDocument;

test('the document review phase is third and waits for an upload', () => {
  const sections = buildProcessSections(call(), []);
  assert.deepEqual(sections.map(s => s.id), ['create', 'upload', 'documents-review', 'prearrival', 'arrival', 'predeparture', 'departure']);
  assert.equal(sections[0]?.rows[0]?.state, 'not-started');
  assert.equal(sections[0]?.rows[1]?.state, 'blocked');
  assert.equal(sections[2]?.title, 'Review documents and add missing data');
  assert.deepEqual(sections[2]?.cta, { label: 'Review documents', state: 'blocked', action: { kind: 'review' } });
  assert.equal(sections[2]?.complete, false);
});

test('accepted reports stay completed even when a prerequisite is no longer available', () => {
  assert.equal(reportProgress(obligation('ATD', 'sent'), false), 'completed');
  assert.equal(reportProgress(obligation('NOA', 'sent', { rejected: { at: '2026-11-09' } })), 'in-progress');
  assert.equal(reportProgress(obligation('NOA', 'missing', { filled: 2 })), 'in-progress');
});

test('departure waits for accepted arrival and pre-departure notices', () => {
  const waiting = buildProcessSections(call([obligation('ATA', 'sent')], 'visit'), []);
  assert.equal(waiting.at(-1)?.rows[0]?.state, 'blocked');
  const ready = buildProcessSections(call([obligation('ATA', 'sent'), obligation('NOD', 'sent')], 'visit'), []);
  assert.equal(ready.at(-1)?.rows[0]?.state, 'not-started');
});

test('cargo uploads create one section and respect arrival/departure context', () => {
  const docs = [document(), document({ id: 'doc-2' })];
  const sections = buildProcessSections(call([], 'visit'), docs);
  const cargo = sections.filter(s => s.id === 'documents-cargo');
  assert.equal(cargo.length, 1);
  assert.deepEqual(cargo[0]?.rows.map(r => r.id), ['CGA']);
  assert.deepEqual(sections.find(s => s.id === 'upload')?.rows.map(r => r.id), ['document-doc-1', 'document-doc-2']);
  assert.equal(sections.filter(s => s.id !== 'upload').some(s => s.rows.some(r => r.action.kind === 'document')), false);
  assert.equal(sections.find(s => s.id === 'upload')?.complete, true);
  assert.equal(sections.find(s => s.id === 'documents-review')?.complete, true);
  assert.equal(buildProcessSections(call(), []).some(s => s.id === 'documents-cargo'), false);
});

test('unrecognized cargo-named files are not presented as parsed cargo', () => {
  const sections = buildProcessSections(call(), [document({ fileName: 'cargo.xlsx', formType: null, parseStatus: 'unrecognized' })]);
  assert.equal(sections.some(s => s.id === 'documents-cargo'), false);
  assert.equal(sections.find(s => s.id === 'upload')?.rows[0]?.label, 'cargo.xlsx');
  assert.equal(sections.find(s => s.id === 'documents-review')?.cta?.state, 'in-progress');
});

test('documents with unresolved checks or an unconfirmed ship are not completed', () => {
  const sections = buildProcessSections(call([], 'visit'), [document({ shipConfirmNeeded: true })]);
  assert.equal(sections.find(s => s.id === 'upload')?.rows[0]?.state, 'in-progress');
  assert.equal(sections.find(s => s.id === 'documents-review')?.complete, false);
});

test('reviewing the NOA overview does not pretend the report has been sent', () => {
  const sections = buildProcessSections(call([obligation('NOA', 'ready', { filled: 4 })], 'visit'), [], ['noa-reports']);
  const noa = sections.find(s => s.id === 'prearrival');
  assert.deepEqual(noa?.rows.map(r => r.state), ['completed', 'completed', 'in-progress']);
  assert.equal(noa?.complete, false);
});
