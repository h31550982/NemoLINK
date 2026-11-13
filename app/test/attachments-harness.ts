/** Isolated UI fixture: every API request is handled here, with no server writes.
 *  ?dialog=1 checks the modal; ?section=waste&tone=check checks another table.
 *  ?empty=1 checks an empty drawer; ?width=1024 constrains the report width. */
import { createApp, h } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { Quasar, Notify, useQuasar } from 'quasar';
import '@fontsource/instrument-sans/500.css';
import '@fontsource/instrument-sans/600.css';
import '@quasar/extras/material-symbols-outlined/material-symbols-outlined.css';
import 'quasar/src/css/index.sass';
import '../src/css/app.scss';
import FormsWizardDialog from '../src/components/FormsWizardDialog.vue';
import { useAuth } from '../src/auth/auth';
import type { NemoTable, PortCall, PortCallDocument } from '../src/auth/auth';

const query = new URLSearchParams(location.search);
const sections = ['crew', 'passengers', 'stores', 'waste', 'security', 'health'] as const;
const labels = ['Crew and effects', 'Passengers', 'Ship stores', 'Waste', 'Security', 'Health'];
let docs: PortCallDocument[] = sections.map((section, i) => ({
  id: `doc-${section}`, portCallId: 'fixture', fileName: `${labels[i]} declaration.xlsx`,
  contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', byteSize: 62000 + i * 16000,
  sha256: '', formType: 'fal5', context: 'both', parseStatus: 'parsed', parseNote: null,
  summary: { formName: `${labels[i]} form` }, uploadedBy: 'fixture', created: '2026-11-09', section,
}));
function tables(): NemoTable[] {
  return sections.map((key, i) => ({
    key, label: labels[i]!, sheet: labels[i]!, rowNoun: 'crew members', fields: [], header: {},
    columns: [
      { key: 'family', de: 'DE-035-02', label: 'Family name', kind: 'text', required: true },
      { key: 'given', de: 'DE-035-03', label: 'Given name', kind: 'text', required: true },
      { key: 'rank', de: 'DE-035-14', label: 'Rank or rating', kind: 'text', required: true },
      { key: 'nationality', de: 'DE-035-04', label: 'Nationality', kind: 'text', required: true },
      { key: 'birth', de: 'DE-035-05', label: 'Date of birth', kind: 'date', required: true },
      { key: 'place', de: 'DE-035-06', label: 'Place of birth', kind: 'text' },
    ],
    rows: ['SPARROW, JACK', 'GIBBS, JOSHAMEE', 'BARBOSSA, HECTOR', 'SWANN, ELIZABETH', 'TURNER, WILLIAM', 'COTTON, JOSIAH', 'MARTY, MARTIN', 'ANAMARIA, ANA', 'RAGETTI, ANGUS'].map((label, n) => ({
      key: `${n}`, label, cells: {
        family: { value: label.split(', ')[0]! }, given: { value: label.split(', ')[1]! },
        rank: { value: '10100', reading: 'Captain / Master' }, nationality: { value: 'GBR', reading: 'United Kingdom' },
        birth: { value: '1970-06-09' }, place: { value: 'London' },
      },
    })),
    sources: query.has('empty') ? [] : [{ docId: `doc-${key}`, fileName: `${labels[i]} declaration.xlsx`, formName: `${labels[i]} form` }],
    counts: { error: query.get('tone') === 'error' ? 1 : 0, warning: query.get('tone') === 'check' ? 1 : 0, missing: 0, conflict: 0 },
  }));
}
if (query.has('empty')) docs = [];
window.fetch = async (input, init) => {
  const url = String(input);
  const body = (value: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }));
  if (url.endsWith('/auth/me')) return body({ user: { username: 'fixture', role: 'admin' } });
  if (url.endsWith('/form-tables')) return body({ tables: tables() });
  if (url.endsWith('/documents') && init?.method === 'POST') {
    const form = init.body as FormData;
    const file = form.get('file') as File;
    const doc = { id: `upload-${Date.now()}`, portCallId: 'fixture', fileName: file.name, contentType: file.type, byteSize: file.size, parseStatus: 'pdf', uploadedBy: 'fixture', section: form.get('section') ?? null } as PortCallDocument;
    docs.push(doc);
    return body({ document: doc }, 201);
  }
  if (url.endsWith('/remove')) { docs = docs.filter(d => !url.includes(`/${d.id}/`)); return body({ ok: true }); }
  if (url.endsWith('/documents')) return body({ documents: docs });
  return body({ message: `Unmocked fixture request: ${url}` }, 404);
};

const router = createRouter({ history: createMemoryHistory(), routes: [
  { path: '/portcalls/:callId', name: 'port-call', component: { render: () => null } },
  { path: '/portcalls/:callId/documents', name: 'port-call-section', component: { render: () => null } },
] });
await useAuth().fetchMe();
await router.push('/portcalls/fixture/documents');
const call = { id: 'fixture', shipName: 'Black Pearl', portName: 'Hamina (Fredrikshamn)', obligations: [] } as unknown as PortCall;
createApp({
  setup() {
    const $q = useQuasar();
    $q.iconMapFn = name => /^[a-z0-9_]+$/.test(name) ? { cls: 'material-symbols-outlined', content: name } : undefined;
    return () => h('main', { style: `max-width:${Number(query.get('width')) || 1240}px;margin:32px auto;padding:0 16px;background:var(--blue-100)` }, [
      h(FormsWizardDialog, { modelValue: true, page: !query.has('dialog'), call, docs, files: [], startAt: query.get('section') ?? 'crew' }),
    ]);
  },
}).use(router).use(Quasar, { plugins: { Notify } }).mount('#app');
