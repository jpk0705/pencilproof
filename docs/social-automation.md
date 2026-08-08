# PencilProof social automation

PencilProof social automation runs as its own Cloudflare Worker. The production design is **direct-API / zero-cost-first**: there is no Ayrshare, Buffer, Hootsuite, Zapier, or other paid social middleware in the runtime.

## Cost goal

The target is $0/month at normal PencilProof launch volume.

- Cloudflare Cron wakes the Worker every 30 minutes.
- A SQLite-backed Durable Object stores dedupe/rate-limit state.
- Workers AI uses `@cf/meta/llama-3.2-1b-instruct`, a small low-cost model.
- `SOCIAL_AI_MAX_CALLS_PER_DAY=12` stops new AI generations after the local daily cap.
- X/Twitter is intentionally disabled in this mode because its API is pay-per-use.
- No paid social aggregator is required.

The AI-call cap is a safety brake, not a billing guarantee. Keep the Cloudflare account on the Free plan if the objective is a hard $0 Cloudflare bill, and review Workers AI usage after activation.

## What it does

- wakes every 30 minutes with a Cloudflare Cron Trigger
- detects which direct social credentials are configured
- scans recent PencilProof posts for new replies/comments
- uses Workers AI to decide whether a comment merits a reply
- posts concise educational replies when appropriate
- deduplicates handled comments in a Durable Object
- rate-limits replies per run and per local day
- can create one educational PencilProof post every 48 hours during configured active hours
- tracks per-platform daily publish keys to avoid duplicate scheduled posts
- exposes `/health` and `/status` without returning credentials or comment text

## Direct platforms

### Bluesky

Supported now:

- read recent PencilProof posts
- read reply threads
- publish text posts
- publish replies

Cloudflare secrets/variables required:

- `BLUESKY_HANDLE`
- `BLUESKY_APP_PASSWORD`

An App Password should be used instead of the account's main password.

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

### LinkedIn

Supported now:

- read recent posts by a configured member/organization author
- read comments
- publish text-only posts
- create nested replies to comments

Required:

- secret: `LINKEDIN_ACCESS_TOKEN`
- variable/secret: `LINKEDIN_AUTHOR_URN` such as an organization URN

The LinkedIn developer app must have the appropriate Community Management API access and social-feed permissions for the account/page.

## Platforms intentionally not enabled

- **X/Twitter:** disabled in zero-cost mode because current API access is pay-per-use.
- **TikTok:** not enabled in the zero-cost worker; direct public posting requires TikTok's app/content-posting approval flow and is media-oriented.
- **Facebook Pages:** not wired into this first direct release. It can be added as another Meta adapter after the Page/app permissions are established, without bringing Ayrshare back.
- **Reddit:** not enabled because commercial Data API terms/access should be reviewed before automating a business account.

## Cloudflare secrets

Secrets must never be committed to GitHub. Add only the credentials for platforms PencilProof actually uses. Examples:

```bash
npx wrangler secret put BLUESKY_HANDLE --config wrangler.social.jsonc
npx wrangler secret put BLUESKY_APP_PASSWORD --config wrangler.social.jsonc
npx wrangler secret put THREADS_ACCESS_TOKEN --config wrangler.social.jsonc
npx wrangler secret put INSTAGRAM_ACCESS_TOKEN --config wrangler.social.jsonc
npx wrangler secret put INSTAGRAM_USER_ID --config wrangler.social.jsonc
npx wrangler secret put LINKEDIN_ACCESS_TOKEN --config wrangler.social.jsonc
npx wrangler secret put LINKEDIN_AUTHOR_URN --config wrangler.social.jsonc
```

`INSTAGRAM_IMAGE_URL` can be stored as a secret or normal Worker variable because it is not a credential.

## Optional publishing restriction

If credentials for several platforms are configured but scheduled posts should go only to selected networks, add a comma-separated Worker variable:

```jsonc
"SOCIAL_PUBLISH_PLATFORMS": "bluesky,threads,linkedin"
```

Omitting this variable means all configured direct platforms that support the needed post format are eligible.

## Safety defaults

The AI prompts prohibit requests for sensitive personal information, guarantees, individualized legal/financial advice, dealer accusations, and claims that PencilProof negotiates or contacts dealerships.

Default limits:

- maximum 4 automated replies per run
- maximum 12 automated replies per local day
- maximum 12 AI generations per local day
- at most 1 scheduled post cycle per local day
- at least 48 hours between scheduled post cycles
- scheduled publishing only between 8 AM and 7 PM Pacific

## Status endpoints

- `GET /health` reports direct-zero-cost mode, automation/publish flags, and which platforms have complete credentials.
- `GET /status` reports the latest run counts, configured platforms, publishing platforms, AI calls, and warning count.

Neither endpoint returns access tokens, App Passwords, comment bodies, or other credentials.

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
- `SOCIAL_AI_MODEL=@cf/meta/llama-3.2-1b-instruct`
- `META_API_VERSION=v24.0`
- `LINKEDIN_API_VERSION=202604`

The Worker remains inactive until at least one platform has its required direct credentials configured.
