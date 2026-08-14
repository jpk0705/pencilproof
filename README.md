# PencilProof

PencilProof is a privacy-first car finance Full Quote Audit. It rebuilds a dealer
quote from the numbers a buyer enters, compares the payment with and without
optional products, explains common finance-office products, highlights APR
and trade-equity differences, and creates a copy-ready list of questions for
the dealership.

## What it checks

- estimated amount financed and monthly payment
- dealer APR versus the customer’s desired APR
- vehicle service contracts (VSC), GAP, prepaid maintenance (PPM), tire and
  wheel protection (T&W), and accessories or other dealer add-ons
- estimated payment and full-term cost with and without entered products
- trade equity or negative equity
- full-term finance charge

Customers purchase one-time access through a Stripe Managed Payments payment
link, then use the audit tool in the browser. Deal inputs are processed locally
first. Ambiguous documents may use the optional server-side vision importer for
one-time extraction, and are not intentionally stored as user documents.

## Important limitation

PencilProof is an educational calculator, not a broker, lender, law firm, or
financial adviser. It does not contact dealerships or negotiate transactions.
Users should verify every figure with the dealer and lender before signing.

## Development

This project requires Node.js 22 or newer.

```bash
npm ci
npx next dev
```

Pushes to `main` automatically build and deploy the static site through GitHub
Pages.

## Automated email campaigns

The Worker has a twice-weekly U.S.-focused campaign trigger for users who create
an account or provide an email address. It rotates unfinished-audit reminders,
30-Day Pass offers, PencilProof benefits, promotions, and practical car-buying
information through Resend. Every campaign includes a clear unsubscribe link,
and unsubscribed addresses are kept on a suppression list.

Configure these through Cloudflare secrets/variables; never commit them:

- `RESEND_API_KEY` — secret Resend API key
- `MARKETING_FROM_EMAIL` — verified sender, such as `PencilProof <hello@pencilproof.com>`
- `MARKETING_REPLY_TO` — optional reply-to address
- `MARKETING_BUSINESS_ADDRESS` — required mailing address included in email footers

The schedule is Tuesday and Friday at 17:00 UTC. The scheduler remains inactive
until the required email settings are present.
