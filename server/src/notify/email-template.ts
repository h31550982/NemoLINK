/**
 * House-style transactional email (docs/specs/0012, restyled per spec 0014):
 * single column, max-width 560, inline CSS only, no external images or
 * fonts — renders cleanly in mobile clients AND Outlook (table-based
 * layout, spacer rows instead of margins) and never phones home. Navy
 * NEMOLink header, facts as boxed label-above-value rows, centered CTA,
 * plain-text alternative for every message.
 */

export interface BrandedEmailInput {
  /** Heading line inside the card */
  title: string;
  /** Paragraphs, already-safe text (escaped here) */
  paragraphs: string[];
  /** Facts rendered as boxed rows: small uppercase label above a bold value */
  facts?: Array<{ label: string; value: string }>;
  cta?: { text: string; url: string };
  /** Monospaced blocks under the facts — raw JSON for support (spec 0081). */
  blocks?: Array<{ label: string; text: string }>;
}

const NAVY = '#0b2a4a';
const ACCENT = '#1976d2';

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function brandedEmail(input: BrandedEmailInput): {
  htmlBody: string;
  textBody: string;
} {
  const factRows = (input.facts ?? [])
    .map(
      (f, i) => `${i > 0 ? '<tr><td style="height:6px;font-size:0;line-height:0;">&nbsp;</td></tr>' : ''}
      <tr><td style="background:#ffffff;border:1px solid #e2e7ec;padding:9px 14px;">
        <div style="font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:#6b7683;">${escapeHtml(f.label)}</div>
        <div style="font-size:15px;font-weight:700;color:#1c2733;padding-top:2px;">${escapeHtml(f.value)}</div>
      </td></tr>`,
    )
    .join('');
  const factsHtml = factRows
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
              style="margin:14px 0 4px;background:#eef1f4;">
        <tr><td style="padding:10px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${factRows}</table>
        </td></tr>
      </table>`
    : '';
  const ctaHtml = input.cta
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 6px;">
        <tr><td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0">
            <tr><td style="border-radius:6px;background:${ACCENT};" align="center">
              <a href="${escapeHtml(input.cta.url)}"
                 style="display:inline-block;padding:12px 34px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;">
                ${escapeHtml(input.cta.text)}</a>
            </td></tr>
          </table>
        </td></tr>
      </table>`
    : '';

  const htmlBody = `<!doctype html>
<html><body style="margin:0;padding:0;background:#eef1f4;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f4;">
  <tr><td align="center" style="padding:20px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="max-width:560px;background:#ffffff;border-radius:8px;overflow:hidden;
                  font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
      <tr><td style="background:${NAVY};padding:16px 24px;">
        <span style="color:#ffffff;font-size:17px;font-weight:700;letter-spacing:.4px;">nauticAi</span>
        <span style="color:#9db8d2;font-size:17px;font-weight:400;"> NEMOLink</span>
      </td></tr>
      <tr><td style="padding:22px 24px;">
        <h1 style="margin:0 0 10px;font-size:18px;color:#1c2733;">${escapeHtml(input.title)}</h1>
        ${input.paragraphs
          .map(
            (p) =>
              `<p style="margin:0 0 10px;font-size:14px;line-height:1.5;color:#3a4756;">${escapeHtml(p)}</p>`,
          )
          .join('')}
        ${factsHtml}
        ${(input.blocks ?? [])
          .map(
            (b) =>
              `<div style="margin:14px 0 4px;font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:#6b7683;">${escapeHtml(b.label)}</div>` +
              `<pre style="margin:0;padding:10px 12px;background:#eef1f4;border:1px solid #e2e7ec;font-family:Consolas,Menlo,monospace;font-size:11px;line-height:1.4;color:#1c2733;white-space:pre-wrap;word-break:break-all;">${escapeHtml(b.text)}</pre>`,
          )
          .join('')}
        ${ctaHtml}
      </td></tr>
      <tr><td style="padding:12px 24px;border-top:1px solid #e5e9ee;">
        <p style="margin:0;font-size:12px;color:#8a95a3;">
          nauticAi NEMOLink — Finnish Maritime Single Window integration.
          This is an automated notification.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  const textLines = [
    'nauticAi NEMOLink',
    '',
    input.title,
    '',
    ...input.paragraphs,
    '',
    ...(input.facts ?? []).map((f) => `${f.label}: ${f.value}`),
    ...(input.blocks ?? []).flatMap((b) => ['', `${b.label}:`, b.text]),
    ...(input.cta ? ['', `${input.cta.text}: ${input.cta.url}`] : []),
  ];
  return { htmlBody, textBody: textLines.join('\n') };
}
