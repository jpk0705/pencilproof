# PencilProof

PencilProof is a privacy-first car finance Deal Audit. It rebuilds a dealer
quote from the numbers a buyer enters, compares the payment with and without
optional products, explains common finance-office products, highlights APR
and trade-equity differences, and creates a copy-ready list of questions for
the dealership.

## What it checks

- estimated amount financed and monthly payment
- dealer APR versus the customer’s desired APR
- vehicle service contracts (VSC), GAP, prepaid maintenance (PPM), protection
  products, and accessories
- estimated payment and full-term cost with and without entered products
- trade equity or negative equity
- full-term finance charge

Customers purchase one-time access through a Stripe Managed Payments payment
link, then use the analyzer in the browser. Deal inputs are not uploaded or
stored by PencilProof.

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
