# VPS Dashboard Update

Run these commands from the cloned dashboard repository on the VPS:

```sh
git fetch origin
git checkout main
git pull --ff-only origin main
npm ci
npm run build
sudo rsync -a --delete dist/ /var/www/data.thecallblueprint.com/
sudo chown -R www-data:www-data /var/www/data.thecallblueprint.com
sudo find /var/www/data.thecallblueprint.com -type d -exec chmod 755 {} \;
sudo find /var/www/data.thecallblueprint.com -type f -exec chmod 644 {} \;
sudo nginx -t
sudo systemctl reload nginx
```

Deploy every file from `dist/`, including all hashed files in `dist/assets/`; the Census place index is a hashed static asset required by city search.

The refreshed data handoff is committed in:

- `data/handoff/dui-seven-keyword-city-metrics.csv`
- `data/handoff/dui-seven-keyword-metrics-audit.csv`
- `data/handoff/dui-seven-keyword-manifest.json`

Do not copy Google Ads credentials, developer tokens, OAuth refresh tokens, or local `google-ads.yaml` files to the VPS. The deployed dashboard is static and does not need Google Ads access.
