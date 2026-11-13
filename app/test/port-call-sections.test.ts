import test from 'node:test';
import assert from 'node:assert/strict';
import { availableSections, reportSection, sectionLocation, sectionNeighbors, sendWasAccepted, stageSectionUploads, takeSectionUploads } from '../src/lib/port-call-sections.ts';

test('moving between sections preserves the port call and supports a direct document or report link', () => {
  const document = sectionLocation('black-pearl', 'document', 'crew-list');
  assert.equal(document.params.callId, 'black-pearl');
  assert.equal(document.params.itemId, 'crew-list');
  const facts = sectionLocation('black-pearl', reportSection('NOA'), undefined, { step: 'facts' });
  assert.equal(facts.params.section, 'pre-arrival');
  assert.equal(facts.query.step, 'facts');
  assert.equal(reportSection('SHP'), reportSection('CRT'));
  assert.equal(reportSection('CGA'), 'report');
});

test('previous and next navigation has boundaries and skips sections the user cannot edit', () => {
  assert.equal(sectionNeighbors('nemo', true, true).previous, undefined);
  assert.equal(sectionNeighbors('ship-data', true, true).previous, undefined);
  assert.equal(sectionNeighbors('ship-data', true, true).next?.id, 'upload');
  assert.equal(sectionNeighbors('upload', true, true).next?.id, 'documents');
  assert.equal(sectionNeighbors('documents', true, true).previous?.id, 'upload');
  assert.equal(sectionNeighbors('departure', true, true).next, undefined);
  assert.equal(sectionNeighbors('ship-data', true, false).next?.id, 'pre-arrival');
  assert.deepEqual(availableSections(false, true).map(section => section.id), ['upload', 'documents']);
  assert.deepEqual(availableSections(false, false), []);
  assert.equal(sectionNeighbors('document', false, true).next, undefined);
  assert.equal(sectionNeighbors('report', true, true).next?.id, 'pre-arrival');
});

test('files selected on the overview reach the correct call exactly once during page navigation', () => {
  const files = [new File(['crew data'], 'crew.csv')];
  stageSectionUploads('black-pearl', files);
  assert.deepEqual(takeSectionUploads('another-call'), []);
  assert.equal(takeSectionUploads('black-pearl'), files);
  assert.deepEqual(takeSectionUploads('black-pearl'), []);
});

test('automatic advance requires every sent report to be accepted, including bundled reports', () => {
  assert.equal(sendWasAccepted({ results: [] }), false);
  assert.equal(sendWasAccepted({ results: [{ accepted: false }] }), false);
  assert.equal(sendWasAccepted({ results: [{ accepted: true }, { accepted: false }] }), false);
  assert.equal(sendWasAccepted({ results: [{ accepted: true }, { accepted: true }] }), true);
});
