# PencilProof optional accounts

PencilProof keeps the existing guest/device flow. Accounts are an optional convenience layer, not a prerequisite for scanning, checkout, payment, or audit use.

## Provider

The implementation uses Clerk's browser SDK for the customer-facing identity flow. Enable Google, Apple, Facebook, and passwordless email verification in the Clerk instance. Clerk owns provider linking and verified-identity rules; PencilProof never matches accounts by email.

Set these values as production secrets/variables in the Worker and build environment:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` — build-time public key
- `CLERK_JWKS_URL` — the exact Clerk JWKS endpoint for the instance
- `CLERK_ISSUER` — the exact Clerk JWT issuer URL
- `CLERK_AUDIENCE` — optional audience restriction when configured in Clerk

No OAuth client secret, Clerk secret key, Stripe key, or webhook secret belongs in Git.

## Storage and retention

`AccountStore` is a Durable Object with SQLite storage. It stores provider subject mappings, one-time 30-day entitlements, and reconstructed audit data. Original PDFs/photos are never stored by the account layer.

Guest entitlements are keyed by the server-derived hash of the existing `pp_device` cookie. On account session creation, the Worker migrates the guest entitlement and guest audit rows to the authenticated user. The migration is idempotent and preserves the original expiration timestamp, including legacy orders created before this feature.

Pass expiry and audit expiry are separate. Entitlements extend from the later of the current expiry or the new activation time; an early repurchase therefore preserves remaining time and adds 30 days. Audits are purged after 30 days from creation. Account deletion removes the user's saved audits, entitlements, and provider mapping.

## Operational rollout

1. Configure the Clerk instance and Worker variables above.
2. Enable the four requested providers in Clerk.
3. Deploy the Worker migration that creates `AccountStore`.
4. Verify guest purchase, account purchase, guest migration, cross-device access, expiry, early repurchase, deletion, and account isolation in staging before production.

If Clerk is not configured, the site remains guest-only and the existing paid flow continues to work.
