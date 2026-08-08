# PencilProof social automation

This Worker runs PencilProof's unattended social-media posting and reply loop independently from the audit/payment Worker.

## What it does

- wakes up every 15 minutes with a Cloudflare Cron Trigger
- reads the currently linked social accounts from Ayrshare
- scans recent PencilProof posts on supported networks for new comments
- uses Workers AI to decide whether a comment merits a reply
- posts concise, educational replies when appropriate
- deduplicates handled comments in a SQLite-backed Durable Object
- rate-limits replies per run and per day
- can publish one AI-generated educational PencilProof post every 48 hours during configured active hours
- uses Ayrshare idempotency keys to reduce duplicate-post risk
- skips X/Twitter unless BYO X API credentials are configured

## Safety defaults

`SOCIAL_PUBLISH_ENABLED` is `false` in `wrangler.social.jsonc` until the linked accounts have been reviewed. Reply automation is enabled, but the Worker does nothing at all when `AYRSHARE_API_KEY` is absent.

The AI prompts prohibit requests for sensitive personal information, guarantees, individualized legal/financial advice, dealer accusations, and claims that PencilProof negotiates or contacts dealerships.

## One-time setup

1. Create or use an Ayrshare account and link the PencilProof social accounts in its dashboard.
2. Confirm that your Ayrshare plan supports post history and comment/reply management for the networks you want monitored.
3. Store the Ayrshare API key as a Cloudflare Worker secret for `pencilproof-social`:

   ```bash
   npx wrangler secret put AYRSHARE_API_KEY --config wrangler.social.jsonc
   ```

4. If using an Ayrshare User Profile rather than the Primary Profile, also store its Profile Key:

   ```bash
   npx wrangler secret put AYRSHARE_PROFILE_KEY --config wrangler.social.jsonc
   ```

5. If X/Twitter is linked, Ayrshare requires BYO X credentials. Store both:

   ```bash
   npx wrangler secret put AYRSHARE_X_API_KEY --config wrangler.social.jsonc
   npx wrangler secret put AYRSHARE_X_API_SECRET --config wrangler.social.jsonc
   ```

6. Optionally restrict publishing to selected linked networks with a comma-separated non-secret variable, for example:

   ```jsonc
   "SOCIAL_PUBLISH_PLATFORMS": "instagram,facebook,linkedin,threads"
   ```

7. After checking the linked accounts, change `SOCIAL_PUBLISH_ENABLED` to `true` and merge/deploy.

## Recommended rollout

Start with replies only for 24-48 hours. Review logs and public replies. Then enable scheduled publishing. The default limits are deliberately conservative: at most 4 replies per run, 12 per local day, and 1 automated post per local day with a 48-hour minimum interval.

## Supported behavior

The unified adapter can auto-publish to linked Bluesky, Facebook, Instagram, LinkedIn, Telegram, Threads, and X accounts. It monitors/replies to comments on Facebook, Instagram, LinkedIn, TikTok, and X posts. Some networks expose different comment capabilities through their APIs; unsupported networks are skipped instead of failing the run.

## Status endpoint

The deployed Worker exposes:

- `GET /health` - reports whether the automation/publishing flags are enabled
- `GET /status` - reports the latest run counts and linked/publishable platform names without returning credentials or comment text

## Configuration

Defaults live in `wrangler.social.jsonc`:

- `SOCIAL_AUTOMATION_ENABLED=true`
- `SOCIAL_REPLY_ENABLED=true`
- `SOCIAL_PUBLISH_ENABLED=false`
- `SOCIAL_TIMEZONE=America/Los_Angeles`
- `SOCIAL_ACTIVE_START_HOUR=8`
- `SOCIAL_ACTIVE_END_HOUR=19`
- `SOCIAL_POST_INTERVAL_HOURS=48`
- `SOCIAL_REPLY_LOOKBACK_DAYS=14`
- `SOCIAL_MAX_REPLIES_PER_RUN=4`
- `SOCIAL_MAX_REPLIES_PER_DAY=12`

Credentials are always Cloudflare secrets and must never be committed to GitHub.
