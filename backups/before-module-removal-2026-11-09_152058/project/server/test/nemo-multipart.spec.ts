/**
 * The CRT attachment on the wire (2026-10-06): NEMO's UI hands back JPG and
 * PDF attachments as base64 text, so the bytes NEMOLink sends must be beyond
 * doubt. The form is serialized exactly as fetch sends it, and every
 * attachment part must carry the file byte for byte — no text re-encoding,
 * no base64 — under its own name and content type.
 */
import { createHash } from 'node:crypto';
import { formalityForm, type FormalityAttachment } from '../src/nemo-client/nemo-client.service';

const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

/** Every byte value plus CR/LF runs and a fake boundary — what a text step would mangle. */
function nasty(head: number[], tail: number[]): Buffer {
  const all = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
  return Buffer.concat([Buffer.from(head), all, Buffer.from('\r\n\r\n--formdata-undici-0\r\n'), all, Buffer.from(tail)]);
}

const FILES: FormalityAttachment[] = [
  { fileName: 'cl_crt.jpg', contentType: 'image/jpeg', content: nasty([0xff, 0xd8, 0xff, 0xe0], [0xff, 0xd9]) },
  { fileName: 'cert.pdf', contentType: 'application/pdf', content: Buffer.concat([Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1'), nasty([], []), Buffer.from('\n%%EOF')]) },
  { fileName: 'll.png', contentType: 'image/png', content: nasty([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], []) },
];

interface Part {
  headers: string;
  body: Buffer;
}

/** The body as fetch sends it, split into parts. */
async function wire(form: FormData): Promise<{ contentType: string; parts: Part[] }> {
  const res = new Response(form);
  const contentType = res.headers.get('content-type')!;
  const body = Buffer.from(await res.arrayBuffer());
  const boundary = Buffer.from(`--${/boundary=(.+)$/.exec(contentType)![1]}`);
  const parts: Part[] = [];
  let at = body.indexOf(boundary);
  while (at >= 0) {
    const next = body.indexOf(boundary, at + boundary.length);
    if (next < 0) break;
    const part = body.subarray(at + boundary.length + 2, next - 2); // CRLF after the boundary, before the next
    const split = part.indexOf('\r\n\r\n');
    parts.push({ headers: part.subarray(0, split).toString('utf8'), body: part.subarray(split + 4) });
    at = next;
  }
  return { contentType, parts };
}

describe('formalityForm — the multipart NEMO receives', () => {
  it('is multipart/form-data with the envelope as an application/json part', async () => {
    const envelope = { 'env:Envelope': { 'crt:CRT': {} } };
    const { contentType, parts } = await wire(formalityForm(envelope));
    expect(contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(parts).toHaveLength(1);
    expect(parts[0]!.headers).toContain('name="formalityData"');
    expect(parts[0]!.headers).toContain('Content-Type: application/json');
    expect(JSON.parse(parts[0]!.body.toString('utf8'))).toEqual(envelope);
  });

  it('carries each JPG, PDF and PNG byte for byte, as its own binary "attachments" part', async () => {
    const { parts } = await wire(formalityForm({ 'env:Envelope': {} }, FILES));
    expect(parts).toHaveLength(1 + FILES.length);
    FILES.forEach((file, i) => {
      const part = parts[i + 1]!;
      expect(part.headers).toContain(`name="attachments"; filename="${file.fileName}"`);
      expect(part.headers).toContain(`Content-Type: ${file.contentType}`);
      expect(part.headers).not.toMatch(/Content-Transfer-Encoding/i);
      expect(part.body.length).toBe(file.content.length);
      expect(sha(part.body)).toBe(sha(file.content));
    });
  });
});
