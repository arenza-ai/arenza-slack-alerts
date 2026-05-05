// Arenza → Slack alert webhook handler.
//
// Receives webhook events from app.arenza.ai/settings/notifications,
// verifies the HMAC signature, filters by severity + event type, and
// posts a Slack Block Kit alert via @slack/web-api.

import express, { Request, Response } from 'express';
import { WebClient, type Block, type KnownBlock } from '@slack/web-api';
import crypto from 'crypto';
import { formatAlert, channelForBrand } from './format-alert';

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const ARENZA_TOKEN = required('ARENZA_TOKEN');
const ARENZA_WEBHOOK_SECRET = required('ARENZA_WEBHOOK_SECRET');
const SLACK_BOT_TOKEN = required('SLACK_BOT_TOKEN');
const SLACK_DEFAULT_CHANNEL = required('SLACK_DEFAULT_CHANNEL');
const MIN_SEVERITY = (process.env.MIN_SEVERITY ?? 'medium').toLowerCase();
const WATCH_EVENT_TYPES = (
  process.env.WATCH_EVENT_TYPES ?? 'wrong_claim_detected,sov_drop'
).split(',').map(s => s.trim());

const SEVERITY_RANK: Record<string, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

const slack = new WebClient(SLACK_BOT_TOKEN);

const app = express();

// We need the raw body for HMAC verification, so use a verify hook.
app.use(
  express.json({
    verify: (req: Request, _res, buf) => {
      (req as Request & { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, service: 'arenza-slack-alerts', token_set: !!ARENZA_TOKEN });
});

app.post('/webhook', async (req: Request, res: Response) => {
  const signature = req.header('X-Arenza-Signature') ?? '';
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;

  if (!rawBody) {
    return res.status(400).json({ error: 'missing_raw_body' });
  }

  if (!verifySignature(rawBody, signature, ARENZA_WEBHOOK_SECRET)) {
    return res.status(401).json({ error: 'invalid_signature' });
  }

  const event = req.body as ArenzaWebhookEvent;

  // Filter: event type
  if (!WATCH_EVENT_TYPES.includes(event.type)) {
    return res.status(200).json({ ok: true, skipped: 'event_type_not_watched' });
  }

  // Filter: severity
  const eventSeverity = (event.severity ?? 'medium').toLowerCase();
  if ((SEVERITY_RANK[eventSeverity] ?? 1) < (SEVERITY_RANK[MIN_SEVERITY] ?? 1)) {
    return res.status(200).json({ ok: true, skipped: 'below_min_severity' });
  }

  try {
    const channel = channelForBrand(event.brand_id) ?? SLACK_DEFAULT_CHANNEL;
    const blocks = formatAlert(event) as (Block | KnownBlock)[];

    await slack.chat.postMessage({
      channel,
      blocks,
      text: `Arenza alert: ${event.type} for brand ${event.brand_id}`, // fallback for notifications
    });

    return res.status(200).json({ ok: true, posted_to: channel });
  } catch (err) {
    console.error('[arenza-slack-alerts] post failed', err);
    return res.status(500).json({ error: 'slack_post_failed' });
  }
});

function verifySignature(body: Buffer, signature: string, secret: string): boolean {
  // Header format: "sha256=<hex>"
  const match = /^sha256=([a-f0-9]{64})$/i.exec(signature);
  if (!match) return false;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
  const sigBuf = Buffer.from(match[1], 'hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expectedBuf);
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`[arenza-slack-alerts] missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

export interface ArenzaWebhookEvent {
  type: string;
  brand_id: string;
  brand_name?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  detected_at?: string;
  payload?: Record<string, unknown>;
}

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[arenza-slack-alerts] listening on :${PORT}`);
    console.log(`[arenza-slack-alerts] watching events: ${WATCH_EVENT_TYPES.join(', ')}`);
    console.log(`[arenza-slack-alerts] min severity: ${MIN_SEVERITY}`);
  });
}

export { app };
