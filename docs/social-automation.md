# PencilProof social automation

PencilProof social automation runs as its own Cloudflare Worker in direct, zero-cost mode. It publishes and replies only through configured provider APIs, with strict time, interval, daily, and AI-call limits.

## Cost goal

The target is $0/month at normal PencilProof launch volume.

- Cloudflare Cron wakes the Worker every 30 minutes.
- A SQLite-backed Durable Object stores dedupe/rate-limit state.
- Workers AI uses `@cf/meta/llama-3.2-1b-instruct`, a small low-cost model.
- `SOCIAL_AI_MAX_CALLS_PER_DAY=12` caps the direct-network AI loop.
- `SOCIAL_FACEBOOK_AI_MAX_CALLS_PER_DAY=200` separately caps Facebook AI calls.
- X/Twitter is intentionally disabled because its API is pay-per-use.
- No paid social aggregator is required.

The AI-call caps are safety brakes, not billing guarantees. Keep the Cloudflare account on the Free plan if the objective is a hard $0 Cloudflare bill, and review Workers AI usage after activation.

## What it does

- wakes every 30 minutes with a Cloudflare Cron Trigger
- detects which direct social credentials are configured
- checks provider APIs and publishes only when the configured schedule and platform credentials allow it
- rotates strong, topic-specific hooks across dealership stories, finance lessons, objection handling, quote comparisons, and buyer Q&A sessions on every enabled platform
- ends posts with a useful reader question and a low-pressure invitation to try the free review; campaign links include platform and content-format attribution so visits can be measured
- reports API reachability, correct-account verification, recent post visibility, the latest post timestamp and permalink, and available provider metrics
- reports weekly promotional-post completion for Facebook, Instagram, and Threads
- reports token/API failures and automation errors
- exposes `/health` and a fresh `/status` operations dashboard without returning credentials, recipient addresses, message IDs, or comment text
- the browser status view shows each platform's latest recorded post time in Pacific time and a provider permalink when available
- `/status?format=json` remains the machine-readable status response for monitoring
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

Required:

- `THREADS_ACCESS_TOKEN`
- either `THREADS_USER_ID` or `THREADS_EXPECTED_USERNAME` (the production default is `pencilproof`)

The Meta app/token needs the Threads permissions necessary to read replies, manage replies, and publish content. When no numeric ID is stored, the verifier reads the token's `/me` identity and requires the returned username to match `THREADS_EXPECTED_USERNAME`. A responding token for a different account is reported as an account mismatch.

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

Scheduled publishing and replies are enabled only when the corresponding variables are true, the platform is configured, and the interval, active-hour, daily, and AI limits allow the action. All generated posts use the PencilProof brand context, rotate platform-specific content structures, and route campaign traffic through the public free-pilot entry point with `utm_source`, `utm_medium`, `utm_campaign`, and `utm_content` attribution.

## Safety defaults

The AI prompts prohibit requests for sensitive personal information, guarantees, individualized legal/financial advice, dealer accusations, and claims that PencilProof negotiates or contacts dealerships.

Default limits:

- scheduled actions are limited by active hours, the configured post interval, a two-post daily cap per publishing loop, daily reply caps, and AI-call caps
- platform credentials remain encrypted Cloudflare secrets
- `/audit` is read-only and does not publish, reply, or mutate provider content

## Operations status

- `GET /health` reports automation mode, publish/reply flags, and which platforms have complete credentials.
- `GET /status` and `GET /status.json` render and return the same stored operations snapshot. Normal status loads make zero Facebook, Instagram, Threads, Resend, or audit-service requests.
- The dashboard reports social automation heartbeat, connection verification, latest post timestamp and permalink, available post metrics, seven-day Resend activity, the local email-automation heartbeat, the seven-day traffic funnel, traffic sources, incidents, and recommended next actions.
- A separate operations cron (`7 * * * *`) runs hourly. It is not part of the 30-minute publishing/reply cron. It first checks both social automation heartbeats and reruns only a configured branch that is more than 75 minutes stale. Social-provider and business snapshot collection remains internally limited to once every six hours, with at most two read-only social-provider requests per collection. At that collection rate, all three Meta platforms are revisited about every 18 hours.
- The audit Worker snapshot uses the existing analytics and account stores and reads up to five 100-message Resend pages for the last seven days. It returns aggregate counts only; it does not return recipients, subjects, or message IDs.
- The existing on-demand sampler remains available for a deliberate read-only refresh. It uses at most two provider requests and a 30-minute cooldown, and never publishes, replies, sends email, changes credentials, or changes limits.
- The performance table preserves provider field names such as views, impressions, reach, likes, comments, replies, shares, and reposts. A numeric `0` is shown as `0`; a dash means the provider did not return that field; derived interactions identify their formula and source; provider or connection failures are shown as errors rather than blank or healthy metrics.
- Stored records are merged by platform and post ID, and the newest `fetchedAt` record wins. Older cached snapshots cannot replace a fresher scheduled measurement. Weekly promotion completion is evaluated using the `America/Los_Angeles` calendar week.

## Automatic repair boundary

- Transient Resend rate limits and server errors retry once with the same idempotency key, preventing a retry from intentionally creating a second email.
- Failed marketing-delivery claims are released so a later scheduled run can safely try again.
- Expired social verification leases are replaced automatically, and provider failures are retried by the next bounded collection cycle.
- If the primary 30-minute social cron misses a run while the independent operations cron still works, the watchdog invokes the existing guarded automation once. Normal cadence, active-hour, daily-post, reply, and AI limits still apply.
- Missing or invalid credentials, revoked permissions, and wrong-account bindings are reported as owner-action incidents. The Worker never guesses or overwrites credentials.

These endpoints return no access tokens, passwords, comment bodies, or other credentials.

## Configuration

Defaults live in `wrangler.social.jsonc`:

- `SOCIAL_AUTOMATION_ENABLED=true`
- `SOCIAL_REPLY_ENABLED=true`
- `SOCIAL_PUBLISH_ENABLED=true`
- `SOCIAL_TIMEZONE=America/Los_Angeles`
- `SOCIAL_ACTIVE_START_HOUR=8`
- `SOCIAL_ACTIVE_END_HOUR=19`
- `SOCIAL_POST_INTERVAL_HOURS=36` (the active window then permits the next post no later than 48 hours)
- `SOCIAL_MAX_POSTS_PER_DAY=2`
- `SOCIAL_REPLY_LOOKBACK_DAYS=14`
- `SOCIAL_MAX_REPLIES_PER_RUN=4`
- `SOCIAL_MAX_REPLIES_PER_DAY=12`
- `SOCIAL_AI_MAX_CALLS_PER_DAY=12`
- `SOCIAL_FACEBOOK_AI_MAX_CALLS_PER_DAY=200`
- `SOCIAL_AI_MODEL=@cf/meta/llama-3.2-1b-instruct`
- `META_API_VERSION=v24.0`
- `LINKEDIN_API_VERSION=202604`

The Worker remains inactive for each platform until that platform's required credentials are configured.
