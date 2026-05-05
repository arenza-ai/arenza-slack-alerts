// Slack Block Kit formatter for Arenza webhook events.
//
// Each handler maps an event type to a Block Kit `blocks` array.
// Edit BRAND_CHANNEL_MAP below to route per-brand to per-client channels.

import type { ArenzaWebhookEvent } from './index';

// Per-brand channel routing. Empty by default; agencies should populate.
const BRAND_CHANNEL_MAP: Record<string, string> = {
  // 'brand-uuid-acme': '#client-acme',
  // 'brand-uuid-globex': '#client-globex',
};

const ALL_LLMS = ['ChatGPT', 'Claude', 'Gemini', 'Perplexity', 'Copilot', 'Grok'];

export function channelForBrand(brandId: string): string | undefined {
  return BRAND_CHANNEL_MAP[brandId];
}

export function formatAlert(event: ArenzaWebhookEvent): unknown[] {
  switch (event.type) {
    case 'wrong_claim_detected':
      return formatWrongClaim(event);
    case 'sov_drop':
      return formatSovDrop(event);
    case 'mention_rate_change':
      return formatMentionRateChange(event);
    default:
      return formatGeneric(event);
  }
}

function formatWrongClaim(event: ArenzaWebhookEvent): unknown[] {
  const p = event.payload ?? {};
  const llm = (p.llm as string) ?? 'unknown LLM';
  const claim = (p.claim as string) ?? '(no claim text)';
  const correct = (p.correct as string) ?? '(no canonical fact)';
  const linkedClaimId = (p.linked_claim_id as string) ?? '';
  const brandName = event.brand_name ?? event.brand_id;

  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: `[Wrong claim] ${brandName} on ${llm}` },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Severity*\n${event.severity ?? 'medium'}` },
        { type: 'mrkdwn', text: `*LLM*\n${llm}` },
      ],
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Wrong claim*\n>${claim}` },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Canonical fact*\n>${correct}` },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Open in Arenza' },
          url: `https://app.arenza.ai/brands/${event.brand_id}/claims/${linkedClaimId}`,
          style: 'primary',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Draft correction' },
          url: `https://app.arenza.ai/brands/${event.brand_id}/claims/${linkedClaimId}/draft`,
        },
      ],
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Probed across ${ALL_LLMS.join(' · ')} · powered by arenza.ai`,
        },
      ],
    },
  ];
}

function formatSovDrop(event: ArenzaWebhookEvent): unknown[] {
  const p = event.payload ?? {};
  const delta = ((p.share_of_voice_delta_pct as number) ?? 0).toFixed(1);
  const current = ((p.share_of_voice as number) ?? 0).toFixed(1);
  const previous = ((p.share_of_voice_previous as number) ?? 0).toFixed(1);
  const worst = (p.worst_llm_change as { llm?: string; delta_pct?: number } | undefined) ?? {};
  const brandName = event.brand_name ?? event.brand_id;

  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: `[SoV drop] ${brandName} ${delta}% WoW` },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Current SoV*\n${current}%` },
        { type: 'mrkdwn', text: `*Previous week*\n${previous}%` },
        {
          type: 'mrkdwn',
          text: `*Worst LLM*\n${worst.llm ?? 'unknown'} (${(worst.delta_pct ?? 0).toFixed(1)}%)`,
        },
        { type: 'mrkdwn', text: `*Severity*\n${event.severity ?? 'medium'}` },
      ],
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Open in Arenza' },
          url: `https://app.arenza.ai/brands/${event.brand_id}`,
          style: 'primary',
        },
      ],
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Across ${ALL_LLMS.join(' · ')} · powered by arenza.ai`,
        },
      ],
    },
  ];
}

function formatMentionRateChange(event: ArenzaWebhookEvent): unknown[] {
  const p = event.payload ?? {};
  const llm = (p.llm as string) ?? 'unknown LLM';
  const rateNow = ((p.mention_rate as number) ?? 0) * 100;
  const ratePrev = ((p.mention_rate_previous as number) ?? 0) * 100;
  const brandName = event.brand_name ?? event.brand_id;

  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `[Mention rate] ${brandName} on ${llm}: ${ratePrev.toFixed(0)}% -> ${rateNow.toFixed(0)}%`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${llm}'s mention rate for *${brandName}* shifted from ${ratePrev.toFixed(0)}% to ${rateNow.toFixed(0)}%.`,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Tracked across ${ALL_LLMS.join(' · ')} · <https://app.arenza.ai/brands/${event.brand_id}|Open in Arenza>`,
        },
      ],
    },
  ];
}

function formatGeneric(event: ArenzaWebhookEvent): unknown[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Arenza event*: \`${event.type}\` for brand \`${event.brand_id}\``,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Severity: ${event.severity ?? 'medium'} · <https://app.arenza.ai/brands/${event.brand_id}|Open>`,
        },
      ],
    },
  ];
}
