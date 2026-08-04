# Enterprise Technology Updates — TV dashboard

A TV-facing dashboard showing the latest technical updates from Microsoft,
SAP, Veeam, Cisco, VMware, AWS, Dell, Fortinet, and Lenovo. A sliding
featured card rotates through each vendor's update, a vendor summary grid
shows 7-day activity counts, a critical alerts panel surfaces anything
security-related, and a scrolling ticker along the bottom carries full
detail on everything at once. Runs as a static site on GitHub Pages, with
data refreshed in the background by a scheduled GitHub Action —
**no API key and no cost.**

## How it works

- **`scripts/fetch-updates.mjs`** — a small Node script that reads each
  vendor's official public RSS/Atom feed (their blog or release-notes feed),
  pulls out the latest post, and counts how many entries fall in the last 7
  days. No account, key, or paid API involved.
- **`.github/workflows/update-data.yml`** — a GitHub Actions workflow that
  runs that script every 30 minutes and commits the updated
  `data/updates.json` back to the repo.
- **`index.html`** — the static dashboard. It only ever reads
  `data/updates.json` over plain HTTP; refresh happens automatically in the
  background (the page re-checks the data file every 5 minutes) — there's
  no button to click, since nobody's expected to be at the TV to click one.

## Setup

1. **Create the repo.** Push these files to a new GitHub repository.

2. **Enable GitHub Pages.**
   Repo → **Settings → Pages** → Source: **Deploy from a branch** → Branch:
   `main`, folder `/ (root)` → Save.
   GitHub will give you a URL like `https://<username>.github.io/<repo>/`.

3. **Run the workflow once manually** so there's data to show right away.
   Repo → **Actions** tab → **Update IT vendor data** → **Run workflow**.
   After it finishes (a few seconds), `data/updates.json` will be populated
   and Pages will pick up the change within a minute or two.

4. **Open the Pages URL on the TV's browser**, ideally in full-screen/kiosk
   mode (most smart TV browsers and mini-PCs have a "kiosk" or "app mode"
   flag — e.g. Chrome's `--kiosk` launch option).

That's it — no secrets, no billing setup.

## A note on the feed URLs

Vendors occasionally restructure their blogs, which can change or break a
feed URL. The feeds in `scripts/fetch-updates.mjs` were current as of this
writing, but check the **Actions** tab after each run — if a vendor's feed
fails, the log will say so and the dashboard just keeps showing that
vendor's last known update instead of breaking.

To find a fresh feed URL for a vendor:
- Look for a small RSS icon on their blog/newsroom page.
- View the page source and search for
  `<link rel="alternate" type="application/rss+xml" ...>` — the `href` is
  the feed URL.
- Try appending `/feed` or `/rss` to the blog's root URL.

Then update the `FEEDS` array at the top of `scripts/fetch-updates.mjs`.

## Customizing

- **Vendor list / feeds**: edit the `FEEDS` array in
  `scripts/fetch-updates.mjs`, and the `VENDORS` array in `index.html`
  (keep the vendor names in sync between the two — same order isn't
  required, just the same names).
- **Security-only feeds**: several vendors publish a dedicated security
  advisories feed separate from their general blog (e.g. Cisco PSIRT, Fortinet
  PSIRT) — swap those in if that's more relevant for your screen than general
  product news.
- **Refresh cadence**: change the cron schedule in
  `.github/workflows/update-data.yml` (GitHub won't run scheduled workflows
  more often than every 5 minutes, and may delay runs further under load).
- **Featured card timing**: change `SLIDE_MS` near the top of the script in
  `index.html` to speed up or slow down how often the featured card advances.
- **Colors / brand**: the two brand colors (`--primary`, `--secondary`) are
  defined once at the top of `index.html`'s `<style>` block — change them
  there and everything using them (header, ticker, accents, buttons) updates
  together.
- **Logo**: there's no logo in the header currently. To add one, place an
  image file in the repo and add an `<img>` tag inside `.header-left` in
  `index.html`.

## If you later want AI-summarized updates instead of raw feed posts

An earlier version of this script used the Anthropic API with web search to
have Claude find and summarize the single most significant update per
vendor, rather than just pulling the latest blog post. That's a better fit
if you want editorial judgment about *significance*, not just recency — but
it requires an Anthropic API key and has a small per-run cost. Ask if you'd
like that version instead or alongside this one.
