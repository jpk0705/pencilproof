# Private analytics dashboard

The dashboard at `/analytics` uses HTTP Basic Authentication. Both the dashboard
HTML and `/api/analytics/summary` require the same credentials; public browsers
can still submit anonymous event receipts to `/api/analytics/event`.

Configure these as Cloudflare Worker secrets. Do not put their values in
`wrangler.jsonc`, source files, or committed `.env` files:

```sh
npx wrangler secret put ANALYTICS_DASHBOARD_USERNAME --config wrangler.jsonc
npx wrangler secret put ANALYTICS_DASHBOARD_PASSWORD --config wrangler.jsonc
```

Private analytics are intentionally not copied into GitHub Actions artifacts or
other external reports. The dashboard supports `7d`, `14d`, `1m`, `3m`, `6m`,
and `1y` through the range selector.
