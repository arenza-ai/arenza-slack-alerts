# arenza-slack-alerts

> **Slack bot** that pings your team the moment **ChatGPT, Claude, Gemini, Perplexity, Copilot, or Grok** misquotes your brand. Webhook → signature-verified Express handler → Block Kit alert. Built on **Arenza** AI visibility data.

[Arenza](https://arenza.ai) is a GEO (Generative Engine Optimization) measurement platform that probes the 6 leading AI assistants on a recurring schedule and surfaces hallucinations, share-of-voice drops, competitor displacement, and ROI-ranked opportunities. This repo is a small Node service that listens to Arenza's webhooks, enriches the payload via the Arenza MCP client, and posts a formatted alert into Slack — one channel per client brand if you're an agency, one channel total if you're a single-brand team.

## Why webhook → Slack matters for an agency

An agency operator running 10–20 client brands cannot afford to refresh a dashboard every morning. The economics only work when every brand has its own Slack channel and the dashboard pushes into it the second something happens.

Concrete examples of "the second something happens":

- **Wrong-claim hallucination caught**: ChatGPT just told 50,000 weekly users that your client's flagship product launched in 2019 (it launched in 2024). A canonical-fact correction page on the brand site, indexed in ~48h, removes it from the next probe round. The 24-hour delay between detection and ticket-creation is what kills the fix loop.
- **SoV drop > 10% week-over-week**: a competitor shipped a viral comparison post and Perplexity is now citing it 3× more than your brand's equivalent page. Catching this on Tuesday morning instead of next Monday's standup is the difference between a one-week dip and a one-month dip.
- **New listicle gap**: Gemini just started recommending a category list ("best X for Y") that your brand isn't on. Submission to the listicle's source domain, today, beats the competitor doing the same submission tomorrow.

This bot makes those three events show up in `#client-acme-geo` within ~30 seconds of Arenza's probe completing.

## Prerequisites

1. **Node 18+** (`node --version`)
2. **A Slack workspace** where you can install a bot (admin permission helpful, not required)
3. **An Arenza Pro account** with webhooks enabled at [app.arenza.ai/settings/notifications](https://app.arenza.ai/settings/notifications). Webhooks ship in the Pro tier and above (Free tier is dashboard-only).

## Quick path: deploy to Vercel / Railway / Fly

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fnaiqiao%2Farenza-slack-alerts&env=ARENZA_TOKEN,SLACK_BOT_TOKEN,SLACK_DEFAULT_CHANNEL,ARENZA_WEBHOOK_SECRET)
[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template?template=https%3A%2F%2Fgithub.com%2Fnaiqiao%2Farenza-slack-alerts)
[![Run on Fly.io](https://fly.io/img/launch.svg)](https://fly.io/launch?repo=https%3A%2F%2Fgithub.com%2Fnaiqiao%2Farenza-slack-alerts)

1. Click a deploy button.
2. Set the four required env vars (see [.env.example](./.env.example)).
3. Copy the deployed URL (e.g. `https://arenza-slack-alerts-xxx.vercel.app/webhook`).
4. Paste it into Arenza: [app.arenza.ai/settings/notifications](https://app.arenza.ai/settings/notifications) → "Add webhook" → URL = the deployed URL, secret = the same value you set for `ARENZA_WEBHOOK_SECRET`.
5. Click "Send test event" — a Slack alert should land in your default channel within 5 seconds.

## Long path: clone, configure, run locally

```bash
git clone https://github.com/arenza-ai/arenza-slack-alerts.git
cd arenza-slack-alerts
npm install
cp .env.example .env
# edit .env with real values
npm run dev   # starts on port 3000
```

Expose it to the internet for testing:

```bash
# in another terminal
npx ngrok http 3000
# copy the https URL → paste into Arenza webhook settings
```

Production:

```bash
npm run build
npm start
```

Or containerize:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY dist ./dist
CMD ["node", "dist/index.js"]
```

## Slack app manifest format + manual install

If the one-click "Install to Slack" buttons don't fit your workspace policy, install manually:

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From an app manifest**.
2. Pick your workspace.
3. Paste the contents of [`slack-app-manifest.json`](./slack-app-manifest.json).
4. Click **Create**, then **Install to Workspace**.
5. Copy the **Bot User OAuth Token** (starts with `xoxb-`) into `SLACK_BOT_TOKEN`.
6. Invite the bot to the channel you set in `SLACK_DEFAULT_CHANNEL` with `/invite @arenza-alerts`.

The manifest grants the bot `chat:write` (post messages) and `chat:write.public` (post to public channels without joining). No user-data scopes — the bot only sends.

## Customization

### Severity threshold

In [.env](./.env.example), set `MIN_SEVERITY=high` to suppress `low` and `medium` alerts. Severity is set by Arenza per event:

- `low` — informational (new probe round complete)
- `medium` — moderate change (SoV drift 5–10%, 1–3 new wrong claims)
- `high` — actionable (SoV drop > 10%, new wrong claim from a top-3 LLM)
- `critical` — immediate (multiple hallucinations from same LLM, competitor surge)

### Mention-rate alerts

By default the bot alerts on `wrong_claim` and `sov_drop` events. To also alert on mention-rate changes per LLM (ChatGPT / Claude / Gemini / Perplexity / Copilot / Grok), add `mention_rate_change` to `WATCH_EVENT_TYPES` in `.env`.

### Daily summary mode

Set `MODE=daily-summary` to batch all events from the previous 24h into a single 9 AM digest instead of real-time. The bot will buffer events in-memory (or Redis if `REDIS_URL` is set) and flush via cron.

### Per-brand channel routing

Edit [`src/format-alert.ts`](./src/format-alert.ts) — the `channelForBrand(brandId)` helper maps brand IDs to Slack channel names. Defaults to `SLACK_DEFAULT_CHANNEL`. For agency setups, populate the map:

```ts
const BRAND_CHANNEL_MAP: Record<string, string> = {
  'brand-uuid-acme': '#client-acme',
  'brand-uuid-globex': '#client-globex',
};
```

## Architecture

```
                         ┌──────────────────────────┐
                         │  app.arenza.ai           │
                         │  (probe round completes) │
                         └────────────┬─────────────┘
                                      │
                                      │  POST /webhook
                                      │  X-Arenza-Signature: sha256=...
                                      │  body: { type, brand_id, payload }
                                      │
                         ┌────────────▼─────────────┐
                         │  Express /webhook        │
                         │  1. Verify HMAC          │
                         │  2. Filter by severity   │
                         │  3. Filter by event type │
                         └────────────┬─────────────┘
                                      │
                         ┌────────────▼─────────────┐
                         │  arenza-mcp-client       │
                         │  enrich payload          │
                         │  (brand name, top opp,   │
                         │  per-LLM mention rate)   │
                         └────────────┬─────────────┘
                                      │
                         ┌────────────▼─────────────┐
                         │  format-alert.ts         │
                         │  Slack Block Kit message │
                         └────────────┬─────────────┘
                                      │
                         ┌────────────▼─────────────┐
                         │  @slack/web-api          │
                         │  chat.postMessage        │
                         │  channel: per-brand      │
                         └──────────────────────────┘
```

The HMAC verification uses Node's built-in `crypto.timingSafeEqual` to prevent timing-attack leakage. The signature header format matches Arenza's webhook spec (`sha256=<hex>`).

## Local dev with the test event

```bash
npm run dev
# in another terminal:
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -H "X-Arenza-Signature: sha256=$(echo -n '{\"type\":\"wrong_claim_detected\",\"brand_id\":\"test\",\"payload\":{}}' | openssl dgst -sha256 -hmac "$ARENZA_WEBHOOK_SECRET" | awk '{print $2}')" \
  -d '{"type":"wrong_claim_detected","brand_id":"test","payload":{"llm":"ChatGPT","claim":"Brand X launched in 2019","correct":"Brand X launched in 2024"}}'
```

A formatted Slack alert should land in `SLACK_DEFAULT_CHANNEL` within a second.

## Troubleshooting

### "Invalid signature" returned 401

- `ARENZA_WEBHOOK_SECRET` in your environment must exactly match the value you set in [app.arenza.ai/settings/notifications](https://app.arenza.ai/settings/notifications). Trailing whitespace breaks HMAC.

### Slack returns `not_in_channel`

- The bot must be invited to the target channel. Run `/invite @arenza-alerts` in Slack.

### Webhook is firing but no Slack message

- Check `MIN_SEVERITY` — if set to `high`, `low`/`medium` events are dropped silently. Lower it to `low` to see everything.
- Tail server logs: `npm run dev` prints every webhook received and what it did with it.

### Vercel cold starts feel slow

- Vercel's free tier idles serverless functions after ~10s. The first webhook after idle takes ~1.5s to respond. Vercel Pro keeps functions warm; Railway/Fly always-on dyno is another option.

## Related projects

The four tutorial repos in this series:

- [arenza-claude-tutorial](https://github.com/arenza-ai/arenza-claude-tutorial) — Claude Desktop + Claude Code
- [arenza-cursor-quickstart](https://github.com/arenza-ai/arenza-cursor-quickstart) — Cursor IDE
- [arenza-n8n-template](https://github.com/arenza-ai/arenza-n8n-template) — n8n weekly digest workflows
- **arenza-slack-alerts** (this repo) — Slack bot for real-time webhook alerts

The eight existing SDK / client repos:

- [awesome-geo](https://github.com/arenza-ai/awesome-geo)
- [arenza-mcp-client-ts](https://github.com/arenza-ai/arenza-mcp-client-ts)
- [arenza-mcp-client-python](https://github.com/arenza-ai/arenza-mcp-client-python)
- [arenza-cli](https://github.com/arenza-ai/arenza-cli)
- [arenza-langchain](https://github.com/arenza-ai/arenza-langchain)
- [arenza-llamaindex](https://github.com/arenza-ai/arenza-llamaindex)
- [arenza-vercel-ai-sdk](https://github.com/arenza-ai/arenza-vercel-ai-sdk)
- [arenza-zapier-actions](https://github.com/arenza-ai/arenza-zapier-actions)

## Resources

- Arenza homepage: https://arenza.ai
- Guides: https://arenza.ai/guides
- AI-assistant brand reference: https://arenza.ai/llms.txt + https://arenza.ai/llms-full.txt
- Webhook settings: https://app.arenza.ai/settings/notifications
- MCP server: https://mcp.arenza.ai
- Dashboard: https://app.arenza.ai

## License

MIT — see [LICENSE](./LICENSE). Authored by the Arenza team.
