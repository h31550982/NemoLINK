// A thin proxy in front of Prism (dev tool only). Prism answers every
// request with the spec's example, so every port call it creates gets the
// same visit id, FI20260213-003 — and NEMOLink keeps one active call per
// visit id. Here a created call gets a fresh id, and an answer about one
// visit carries that visit's id, as live NEMO would.
import http from 'node:http';

const EXAMPLE_ID = 'FI20260213-003';
const PRISM = { host: '127.0.0.1', port: 4011 };
const issued = new Set();

function freshId() {
  const now = new Date();
  const day = now.toISOString().slice(0, 10).replace(/-/g, '');
  // Start from the time of day so ids differ across restarts too
  let n = Math.floor((now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds()) / 87);
  let id;
  do {
    id = `FI${day}-${String(n % 1000).padStart(3, '0')}`;
    n++;
  } while (issued.has(id));
  issued.add(id);
  return id;
}

http
  .createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const up = http.request(
        { ...PRISM, method: req.method, path: req.url, headers: { ...req.headers, host: `${PRISM.host}:${PRISM.port}` } },
        (pr) => {
          const out = [];
          pr.on('data', (c) => out.push(c));
          pr.on('end', () => {
            let text = Buffer.concat(out).toString('utf8');
            const path = (req.url ?? '').split('?')[0];
            const visit = /^\/v1\/portcalls\/([^/]+)/.exec(path)?.[1];
            let id = null;
            if (req.method === 'POST' && path === '/v1/portcalls' && pr.statusCode < 300) id = freshId();
            else if (visit) id = decodeURIComponent(visit);
            if (id) text = text.split(EXAMPLE_ID).join(id);
            const headers = { ...pr.headers };
            delete headers['content-length'];
            delete headers['transfer-encoding'];
            headers['content-length'] = Buffer.byteLength(text);
            res.writeHead(pr.statusCode ?? 502, headers);
            res.end(text);
          });
        },
      );
      up.on('error', (e) => {
        res.writeHead(502, { 'content-type': 'text/plain' });
        res.end(`nemo-mock proxy: ${e.message}`);
      });
      up.end(body);
    });
  })
  .listen(4010, '0.0.0.0', () => console.log('nemo-mock: visit-id proxy on 4010 → Prism on 4011'));
