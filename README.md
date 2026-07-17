# PencilProof

PencilProof is a privacy-first car finance deal analyzer. It rebuilds a dealer
quote from the numbers a buyer enters, checks the payment math, highlights
optional products and APR differences, and creates a copy-ready list of
questions for the dealership.

## What it checks

- estimated amount financed and monthly payment
- dealer APR versus an outside approval
- service contracts, GAP, protection products, and accessories
- trade equity or negative equity
- full-term finance charge

The calculator runs in the browser. Deal inputs are not uploaded or stored.

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
