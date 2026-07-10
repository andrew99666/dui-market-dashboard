# Deployment Guide

## Prerequisites

- Node.js 22 LTS (or a current supported Node.js release) and npm.
- Access to the target VPS and the DNS/TLS configuration for `data.thecallblueprint.com`.

This project does not perform DNS changes, TLS issuance, or VPS uploads.

## Build

From the project root, install the locked dependencies and verify the application:

```powershell
npm ci
npm test
npm run build
```

Deploy the generated `dist/` directory. The place index is emitted as a same-origin static JSON asset during the Vite build, so keep every file in `dist/assets/` with the deployment.

## Nginx

Suggested document root: `/var/www/data.thecallblueprint.com`.

Upload the contents of `dist/` to that directory, then assign ownership to the web-service user and allow read/execute access:

```sh
sudo chown -R www-data:www-data /var/www/data.thecallblueprint.com
sudo find /var/www/data.thecallblueprint.com -type d -exec chmod 755 {} \;
sudo find /var/www/data.thecallblueprint.com -type f -exec chmod 644 {} \;
```

Example server block:

```nginx
server {
    listen 80;
    server_name data.thecallblueprint.com;

    root /var/www/data.thecallblueprint.com;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /assets/ {
        try_files $uri =404;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    location = /index.html {
        add_header Cache-Control "no-cache";
    }
}
```

Enable the site, validate the configuration, and reload Nginx using the VPS operator's standard process. Add the HTTPS listener and certificates after DNS is configured.

## Data Refresh

Run Google Ads collection only from the research workstation. The collector reads credentials from an external `google-ads.yaml` file (by default, `$HOME/google-ads.yaml`); do not commit credentials, OAuth refresh tokens, or developer tokens, and never run this collector on the VPS.

For a targeted verification run, provide an exact city/state pair (case-insensitive):

```powershell
python scripts/fetch_google_ads_keyword_metrics.py --config $HOME/google-ads.yaml --input data/source/city-geo-targets.csv --output data/source/phoenix-keyword-metrics-raw.csv --city Phoenix --state Arizona
```

For the full refresh, collect raw metrics, deduplicate them, then refresh the dashboard data:

1. Run `python scripts/fetch_google_ads_keyword_metrics.py --config $HOME/google-ads.yaml --input data/source/city-geo-targets.csv --output data/source/dui-expanded-keyword-metrics-raw.csv` on the research workstation.
2. Replace the canonical CSV at `data/source/city-metrics.csv` with the deduplicated result.
3. Regenerate data with `npm run data:prepare -- --refreshed-at YYYY-MM-DD`.
4. Run `npm test` and `npm run build`.
5. Replace the deployed contents with the new `dist/` output.

The dashboard methodology uses Google Ads Keyword Planner historical metrics. Census geography attribution covers the 2025 Places Gazetteer plus researched Woodbridge/Edison county-subdivision fallbacks.
