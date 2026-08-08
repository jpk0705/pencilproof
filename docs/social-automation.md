# PencilProof social automation

PencilProof social automation runs as its own Cloudflare Worker. The production design is **direct-API / zero-cost-first**: there is no Ayrshare, Buffer, Hootsuite, Zapier, or other paid social middleware in the runtime.

## Cost goal

The target is $0/month at normal PencilProof launch volume.

- Cloudflare Cron wakes the Worker every 30 minutes.
- A SQLite-backed Durable Object stores dedupe/rate-limit state.
- Workers AI uses `@cf/meta/llama-3.2-1b-instruct`, a small low-cost model.
- `SOCIAL_AI_MAX_CALLS_PER_DAY=12` caps the direct-network AI loop.
- `SOCIAL_FACEBOOK_AI_MAX_CALLS_PER_DAY=6` separately caps Facebook AI calls.
- X/Twitter is intentionally disabled in this mode because current API access is pay-per-use.
- No paid social aggregator is required.

The AI-call caps are safety brakes, not billing guarantees. Keep the Cloudflare account on the Free plan if the objective is a hard $0 Cloudflare bill, and review Workers AI usage after activation.

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

### Facebook Page

Supported now:

- read recent Page feed posts created by the Page
- read comments on those posts
- publish Page replies to comments
- publish text posts to the Page feed

Required Worker secrets:

- `FACEBOOK_PAGE_ID`
- `FACEBOOK_PAGE_ACCESS_TOKEN`

Meta setup:

- Use a Meta developer app and Facebook Login to authorize a person who can perform the needed tasks on the PencilProof Facebook Page.
- Request the Page permissions Meta currently lists for Page post/comment management: `pages_manage_engagement`, `pages_manage_posts`, and `pages_read_engagement`.
- Meta's current Pages API docs also list `pages_read_user_engagement` for Page post/comment access. Request it if the app dashboard requires it for comment reads or App Review.
- Store only the resulting Page access token in Cloudflare. Do not commit it or paste it into chat.

The current Page and Instagram app is **PencilProof Social** (Meta app ID `1617000713152705`).

Automation is for a Facebook **Page**, not a normal personal profile.

### Threads

Supported now:

- read recent Threads posts
- read replies
- publish text posts
- reply to a specific Threads reply

Required Worker secret:

- `THREADS_ACCESS_TOKEN`

Meta setup:

- Use the separate **PencilProof Threads** Meta app (app ID `1047346081125533`); Meta currently prevents the Threads use case from being combined with the Page/Instagram use cases in the same app.
- Request the current Threads permissions needed by this Worker: `threads_basic`, `threads_content_publish`, `threads_read_replies`, and `threads_manage_replies`.
- `threads_basic` is required for all Threads endpoints.
- `threads_content_publish` is required for publishing.
- `threads_read_replies` is required for GET calls to reply endpoints.
- `threads_manage_replies` is required for POST calls to reply endpoints.
- Use a long-lived token flow for production and refresh before expiry.

### Instagram

Supported now for Instagram Professional accounts:

- read recent media
- read comments
- reply to comments
- publish an image post when a public image URL is configured

Required Worker secrets:

- `INSTAGRAM_ACCESS_TOKEN`
- `INSTAGRAM_USER_ID`
- for scheduled publishing only: `INSTAGRAM_IMAGE_URL`

Meta setup:

- Use the current Instagram API with Instagram Login for an Instagram Professional account.
- Request the current Instagram business scopes: `instagram_business_basic`, `instagram_business_content_publish`, and `instagram_business_manage_comments`.
- Meta's Business Login docs say these names replace the older `business_basic`, `business_content_publish`, and `business_manage_comments` scope values.
- Exchange the short-lived access token for a long-lived Instagram user access token before production.

If `INSTAGRAM_IMAGE_URL` is absent, Instagram remains active for monitoring and replies but is automatically excluded from scheduled publishing.

### Bluesky

Supported now:

- read recent PencilProof posts
- read reply threads
- publish text posts
- publish replies

Required Worker secrets:

- `BLUESKY_HANDLE`
- `BLUESKY_APP_PASSWORD`

### LinkedIn

Supported now:

- read recent posts by a configured member/organization author
- read comments
- publish text-only posts
- create nested replies to comments

Required Worker secrets:

- `LINKEDIN_ACCESS_TOKEN`
- `LINKEDIN_AUTHOR_URN`

The LinkedIn developer app must have the appropriate Community Management API access and social-feed permissions for the account/page.

## Platforms intentionally not enabled

- **X/Twitter:** disabled in zero-cost mode because current API access is pay-per-use.
- **TikTok:** not enabled in the zero-cost Worker; direct public posting requires TikTok's app/content-posting approval flow and is media-oriented.
- **Reddit:** disabled for PencilProof. Do not configure Reddit credentials or automation.

## Cloudflare secrets

Secrets must never be committed to GitHub. Add only the credentials for platforms PencilProof actually uses.

```bash
npx wrangler secret put FACEBOOK_PAGE_ID --config wrangler.social.jsonc
npx wrangler secret put FACEBOOK_PAGE_ACCESS_TOKEN --config wrangler.social.jsonc
npx wrangler secret put THREADS_ACCESS_TOKEN --config wrangler.social.jsonc
npx wrangler secret put INSTAGRAM_ACCESS_TOKEN --config wrangler.social.jsonc
npx wrangler secret put INSTAGRAM_USER_ID --config wrangler.social.jsonc
npx wrangler secret put INSTAGRAM_IMAGE_URL --config wrangler.social.jsonc
npx wrangler secret put BLUESKY_HANDLE --config wrangler.social.jsonc
npx wrangler secret put BLUESKY_APP_PASSWORD --config wrangler.social.jsonc
npx wrangler secret put LINKEDIN_ACCESS_TOKEN --config wrangler.social.jsonc
npx wrangler secret put LINKEDIN_AUTHOR_URN --config wrangler.social.jsonc
```

Never paste social passwords or access tokens into source code, GitHub issues, PR comments, or chat messages.

## Optional publishing restriction

If credentials for several platforms are configured but scheduled posts should go only to selected networks, add a comma-separated Worker variable:

```jsonc
"SOCIAL_PUBLISH_PLATFORMS": "facebook,threads,instagram,linkedin"
```

Omitting this variable means all configured direct platforms that support the needed post format are eligible.

## Safety defaults

`SOCIAL_REPLY_ENABLED` and `SOCIAL_PUBLISH_ENABLED` are both `false` in `wrangler.social.jsonc`. Leave them off for the first credentialed deployment so the Worker can safely monitor without posting. Enable replies for a controlled comment test, then enable scheduled publishing only after the linked accounts, tokens, and test results have been reviewed.

The AI prompts prohibit requests for sensitive personal information, guarantees, individualized legal/financial advice, dealer accusations, and claims that PencilProof negotiates or contacts dealerships.

Default limits:

- maximum 4 automated replies per run
- maximum 12 automated replies per local day
- maximum 12 direct-network AI generations per local day
- maximum 6 Facebook AI generations per local day
- at most 1 scheduled post cycle per local day per state loop
- at least 48 hours between scheduled post cycles
- scheduled publishing only between 8 AM and 7 PM Pacific

## Status endpoints

- `GET /health` reports direct-zero-cost mode, automation/publish flags, and which platforms have complete credentials.
- `GET /status` reports the latest direct-network status plus a separate Facebook status block.

Neither endpoint returns access tokens, passwords, comment bodies, or other credentials.

## Configuration

Defaults live in `wrangler.social.jsonc`:

- `SOCIAL_AUTOMATION_ENABLED=true`
- `SOCIAL_REPLY_ENABLED=false`
- `SOCIAL_PUBLISH_ENABLED=false`
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
