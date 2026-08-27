# PencilProof social automation

PencilProof social automation runs as its own Cloudflare Worker in direct, zero-cost mode. It publishes and replies only through configured provider APIs, with strict time, interval, daily, and AI-call limits.

## Cost goal

The target is $0/month at normal PencilProof launch volume.

- Cloudflare Cron wakes the Worker every 30 minutes.
- A SQLite-backed Durable Object stores dedupe/rate-limit state.
- Workers AI uses `@cf/meta/llama-3.2-1b-instruct`, a small low-cost model.
- `SOCIAL_AI_MAX_CALLS_PER_DAY=12` caps the direct-network AI loop.
- `SOCIAL_FACEBOOK_AI_MAX_CALLS_PER_DAY=6` separately caps Facebook AI calls.
- X/Twitter is intentionally disabled because its API is pay-per-use.
- No paid social aggregator is required.

The AI-call caps are safety brakes, not billing guarantees. Keep the Cloudflare account on the Free plan if the objective is a hard $0 Cloudflare bill, and review Workers AI usage after activation.

## What it does

- wakes every 30 minutes with a Cloudflare Cron Trigger
- detects which direct social credentials are configured
- checks provider APIs and publishes only when the configured schedule and platform credentials allow it
- reports API reachability, recent post visibility, and last successful publish telemetry
- reports weekly promotional-post completion for Facebook, Instagram, and Threads
- reports token/API failures and automation errors
- exposes `/health` and `/status` without returning credentials or comment text
- exposes a GET-only `/audit` endpoint for read-only health checks

## Direct platforms

### Facebook Page

Supported now:

- read recent Page feed posts created by the Page
- read comments on those posts
- publish Page replies to comments
- publish text posts to the Page feed

Required:

- `FACEBOOK_PAGE_ID`
- `FACEBOOK_PAGE_ACCESS_TOKEN`

Automation is for a Facebook **Page**, not a normal personal profile. The Page Access Token must be created from a Meta app/user authorization that has the Page tasks and permissions needed for reading engagement, creating content, and moderating/replying.

### Threads

Supported now:

- read recent Threads posts
- read replies
- publish text posts
- reply to a specific Threads reply

Required secret:

- `THREADS_ACCESS_TOKEN`

The Meta app/token needs the Threads permissions necessary to read replies, manage replies, and publish content.

### Instagram

Supported now for Instagram Professional accounts:

- read recent media
- read comments
- reply to comments
- publish an image post when a public image URL is configured

Required:

- secret: `INSTAGRAM_ACCESS_TOKEN`
- variable/secret: `INSTAGRAM_USER_ID`
- for scheduled publishing only: `INSTAGRAM_IMAGE_URL`

If `INSTAGRAM_IMAGE_URL` is absent, Instagram remains active for monitoring and replies but is automatically excluded from scheduled publishing.

A Professional Instagram account can be linked to the Facebook Page and authorized through Meta's Facebook Login path.

### Bluesky

Supported now:

- read recent PencilProof posts
- read reply threads
- publish text posts
- publish replies

Required:

- `BLUESKY_HANDLE`
- `BLUESKY_APP_PASSWORD`

### LinkedIn

Supported now:

- read recent posts by a configured member/organization author
- read comments
- publish text-only posts
- create nested replies to comments

Required:

- `LINKEDIN_ACCESS_TOKEN`
- `LINKEDIN_AUTHOR_URN`

The LinkedIn developer app must have the appropriate Community Management API access and social-feed permissions for the account/page.

## Platforms intentionally not enabled

- **X/Twitter:** disabled in zero-cost mode because current API access is pay-per-use.
- **TikTok:** not enabled in the zero-cost worker; direct public posting requires TikTok's app/content-posting approval flow and is media-oriented.
- **Reddit:** disabled for PencilProof. Do not configure Reddit credentials or automation.

## Cloudflare secrets

Secrets must never be committed to GitHub. Add only the credentials for platforms PencilProof actually uses.

```bash
npx wrangler secret put FACEBOOK_PAGE_ID --config wrangler.social.jsonc
npx wrangler secret put FACEBOOK_PAGE_ACCESS_TOKEN --config wrangler.social.jsonc
npx wrangler secret put THREADS_ACCESS_TOKEN --config wrangler.social.jsonc
npx wrangler secret put INSTAGRAM_ACCESS_TOKEN --config wrangler.social.jsonc
npx wrangler secret put INSTAGRAM_USER_ID --config wrangler.social.jsonc
npx wrangler secret put LINKEDIN_ACCESS_TOKEN --config wrangler.social.jsonc
npx wrangler secret put LINKEDIN_AUTHOR_URN --config wrangler.social.jsonc
```

Never paste social passwords or access tokens into source code, GitHub issues, PR comments, or chat messages.

## Publishing boundary

Scheduled publishing and replies are enabled only when the corresponding variables are true, the platform is configured, and the interval, active-hour, daily, and AI limits allow the action. All generated posts use the PencilProof brand context and route campaign traffic through the public free-pilot entry point.

## Safety defaults

The AI prompts prohibit requests for sensitive personal information, guarantees, individualized legal/financial advice, dealer accusations, and claims that PencilProof negotiates or contacts dealerships.

Default limits:

- scheduled actions are limited by active hours, a 48-hour post interval, daily reply caps, and AI-call caps
- platform credentials remain encrypted Cloudflare secrets
- `/audit` is read-only and does not publish, reply, or mutate provider content

## Status endpoints

- `GET /health` reports automation mode, publish/reply flags, and which platforms have complete credentials.
- `GET /status` reports the latest direct-network status plus a separate Facebook status block.
- `GET /audit` performs read-only provider checks for Facebook, Instagram, and Threads, reports recent successful publish IDs/timestamps, weekly promotional-post completion, API/token failures, and automation errors. It has no publishing or reply code path.

Neither endpoint returns access tokens, passwords, comment bodies, or other credentials.

## Configuration

Defaults live in `wrangler.social.jsonc`:

- `SOCIAL_AUTOMATION_ENABLED=true`
- `SOCIAL_REPLY_ENABLED=true`
- `SOCIAL_PUBLISH_ENABLED=true`
- `SOCIAL_TIMEZONE=America/Los_Angeles`
- `SOCIAL_ACTIVE_START_HOUR=8`
- `SOCIAL_ACTIVE_END_HOUR=19`
- `SOCIAL_POST_INTERVAL_HOURS=48`
- `SOCIAL_REPLY_LOOKBACK_DAYS=14`
- `SOCIAL_MAX_REPLIES_PER_RUN=4`
- `SOCIAL_MAX_REPLIES_PER_DAY=12`
- `SOCIAL_AI_MAX_CALLS_PER_DAY=12`
- `SOCIAL_FACEBOOK_AI_MAX_CALLS_PER_DAY=6`
- `SOCIAL_AI_MODEL=@cf/meta/llama-3.2-1b-instruct`
- `META_API_VERSION=v24.0`
- `LINKEDIN_API_VERSION=202604`

The Worker remains inactive for each platform until that platform's required credentials are configured.
