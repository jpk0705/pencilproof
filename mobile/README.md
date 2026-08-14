# PencilProof mobile app

This Expo app is the shared iPhone and Android client for PencilProof. It uses the same Cloudflare Worker APIs, Clerk account, Stripe hosted checkout, and audit history as the website.

## Run locally

1. Copy `.env.example` to `.env` and set the Clerk publishable key from the PencilProof production instance.
2. Install dependencies with `pnpm install`.
3. Start the device client with `pnpm start`.
4. Scan the Expo QR code with Expo Go, or use an Android emulator / iOS simulator.

The current flow is:

`Take photo` or `Choose PDF or image` → review detected values → feedback survey → Stripe checkout → My Audits.

Google sign-in is ready to use. Apple sign-in is wired into the app but remains unavailable until Apple Developer membership is active and the Apple provider credentials are entered in Clerk.

## Production release preparation

Before an App Store or Google Play release, configure an EAS project, production bundle signing, app icons/splash assets, privacy disclosures, and store screenshots. The app does not ship to either store from this repository automatically; each store requires the account owner’s final review and submission.

Do not commit `.env`, Clerk secrets, Apple private keys, Stripe secrets, or Gemini keys.
