/**
 * Minimal transactional email for the editorial backend.
 *
 * The reader app owns the big email edition; the newsroom only needs to send the
 * occasional internal note (e.g. the weekly reliability digest). This supports
 * Resend first and Mailgun as a fallback, matching the suite's providers, and is
 * a no-op (ok:false) when neither is configured, so a caller degrades gracefully
 * rather than throwing.
 *
 * Env:
 *   EMAIL_FROM          e.g. "Discernt Newsroom <contact@dot1.media>"
 *   RESEND_API_KEY      (preferred)
 *   MAILGUN_API_KEY + MAILGUN_DOMAIN   (fallback)
 */

export interface SendEmailInput {
  to: string[];
  subject: string;
  html: string;
  text?: string;
}
export interface SendEmailResult {
  ok: boolean;
  provider?: 'resend' | 'mailgun';
  error?: string;
}

const FROM = () => process.env.EMAIL_FROM || 'Discernt Newsroom <contact@dot1.media>';

async function sendResend(input: SendEmailInput, timeoutMs: number): Promise<SendEmailResult | null> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ from: FROM(), to: input.to, subject: input.subject, html: input.html, text: input.text }),
    });
    if (!res.ok) return { ok: false, provider: 'resend', error: `resend ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}` };
    return { ok: true, provider: 'resend' };
  } catch (e: any) {
    return { ok: false, provider: 'resend', error: `resend: ${e?.message || e}` };
  } finally {
    clearTimeout(timer);
  }
}

async function sendMailgun(input: SendEmailInput, timeoutMs: number): Promise<SendEmailResult | null> {
  const key = process.env.MAILGUN_API_KEY;
  const domain = process.env.MAILGUN_DOMAIN;
  if (!key || !domain) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const form = new URLSearchParams();
    form.set('from', FROM());
    for (const t of input.to) form.append('to', t);
    form.set('subject', input.subject);
    form.set('html', input.html);
    if (input.text) form.set('text', input.text);
    const res = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        authorization: 'Basic ' + Buffer.from(`api:${key}`).toString('base64'),
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
    if (!res.ok) return { ok: false, provider: 'mailgun', error: `mailgun ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}` };
    return { ok: true, provider: 'mailgun' };
  } catch (e: any) {
    return { ok: false, provider: 'mailgun', error: `mailgun: ${e?.message || e}` };
  } finally {
    clearTimeout(timer);
  }
}

/** Send an email via Resend, else Mailgun. Returns ok:false (never throws) when
 *  no provider is configured or the send fails. */
export async function sendEmail(input: SendEmailInput, timeoutMs = 12000): Promise<SendEmailResult> {
  const to = (input.to || []).map((t) => t.trim()).filter(Boolean);
  if (to.length === 0) return { ok: false, error: 'no recipients' };
  const payload = { ...input, to };
  const viaResend = await sendResend(payload, timeoutMs);
  if (viaResend?.ok) return viaResend;
  const viaMailgun = await sendMailgun(payload, timeoutMs);
  if (viaMailgun?.ok) return viaMailgun;
  return viaResend || viaMailgun || { ok: false, error: 'no email provider configured (set RESEND_API_KEY or MAILGUN_API_KEY + MAILGUN_DOMAIN)' };
}
