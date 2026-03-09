# PF-Dashboard

Harvestr Dashboard for Signaturit Professional Services team.

## Structure

```
├── dashboard/              # Frontend dashboard (vanilla HTML/CSS/JS)
│   ├── index.html          # Main HTML
│   ├── css/styles.css      # Styles
│   └── js/app.js           # Application logic
├── supabase/
│   └── functions/
│       └── PFtool/         # Supabase Edge Function (CORS proxy for Harvestr API)
│           └── index.ts
```

## Supabase Edge Function — PFtool

CORS proxy that forwards requests to the Harvestr API (`https://api.harvestr.io/v1`).

### Deploy

```bash
supabase functions deploy PFtool
```

### Usage

Set the proxy URL in the dashboard to:
```
https://<your-project>.supabase.co/functions/v1/PFtool
```

The function forwards the `Authorization` header and proxies all paths:
- `GET /PFtool/feedback?limit=200` → `GET https://api.harvestr.io/v1/feedback?limit=200`
- `GET /PFtool/discovery/123/feedback` → `GET https://api.harvestr.io/v1/discovery/123/feedback`

## Dashboard

Open `dashboard/index.html` in a browser. Enter your Harvestr API token and optionally the proxy URL if you have CORS issues.

No build step, no dependencies — pure vanilla HTML/CSS/JS.
