# Enterprise Technology Updates — TV dashboard

A TV-facing dashboard showing the latest vulnerabilities, patches, and
security advisories from Microsoft, SAP, Veeam, Cisco, VMware, AWS, Dell,
Fortinet, and Lenovo — built for an IT organization's patch-management
awareness, not general product marketing. A sliding featured card rotates
through each vendor's latest advisory, a vendor summary grid shows 7-day
advisory counts, a critical alerts panel surfaces anything high-severity,
and a scrolling ticker along the bottom carries full detail on everything at
once. Runs as a static site on GitHub Pages, with data refreshed in the
background by a scheduled GitHub Action — **no API key and no cost.**

## How it works

- **`scripts/fetch-updates.mjs`** — a small Node script that does two things:
  1. Reads each vendor's security-advisory / PSIRT feed, pulls out the
     latest entry, classifies it as Critical / Patch / End-of-life, and
     counts how many advisories fall in the last 7 days (drives the
     featured card, vendor summary, and critical alerts panel).
  2. Queries the **National Vulnerability Database (NVD)** — a free, public
     US government CVE database — for each vendor's actual CVE records from
     the last 7 days, with severity ratings. These feed the ticker
     specifically, since NVD covers every vendor consistently (unlike
     individual vendor feeds, which vary in reliability).

  No account, key, or paid API required for either part.
- **`.github/workflows/update-data.yml`** — a GitHub Actions workflow that
  runs that script every 30 minutes and commits the updated
  `data/updates.json` back to the repo.
- **`index.html`** — the static dashboard. It only ever reads
  `data/updates.json` over plain HTTP; refresh happens automatically in the
  background (the page re-checks the data file every 5 minutes) — there's
  no button to click, since nobody's expected to be at the TV to click one.

## About the NVD integration

The ticker now scrolls through, per vendor: its latest advisory/update from
its own feed, followed by up to 5 actual CVE records from NVD published in
the last 7 days (most severe and most recent first), each tagged with an
official severity rating — Critical, High, Medium, or Low.

This uses NVD's public API (`https://services.nvd.nist.gov/rest/json/cves/2.0`),
searching by vendor name against CVE descriptions. A few notes:

- **No API key needed** at this request volume — NVD allows 5 requests per
  rolling 30 seconds without one, and the script deliberately waits ~6.5
  seconds between each of the 9 vendor requests to stay under that limit.
  This adds roughly a minute to each workflow run.
- **Optional**: if you get a free API key from
  [nvd.nist.gov/developers/request-an-api-key](https://nvd.nist.gov/developers/request-an-api-key)
  (raises the rate limit, useful if you add more vendors later), add it as
  a repo secret named `NVD_API_KEY` and the workflow will pick it up
  automatically — nothing else to change.
- **Keyword matching, not exact CPE matching**: NVD is searched by vendor
  name as a keyword against CVE descriptions, which is simple and requires
  no per-product configuration, but can occasionally surface a CVE that
  mentions the vendor without being one of their own products. For a TV
  awareness screen this tradeoff is reasonable; it would need more precise
  (and more complex) CPE-based matching to fully eliminate.
- If NVD has no CVEs for a vendor in a given week, that vendor simply
  contributes no CVE items to the ticker that cycle — nothing breaks.

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

## Feed status (as of the first real run)

Security-advisory feeds are far less standardized than general company
blogs, and some vendors (Microsoft in particular) have moved away from
plain RSS toward API/portal-based disclosure systems. Here's what the first
live run actually confirmed:

- **Confirmed working, vulnerability/advisory-specific**: Cisco (PSIRT),
  Fortinet (FortiGuard IR advisories), Microsoft (MSRC update guide).
- **Confirmed working, but general blog/news — not vulnerability-specific**:
  SAP, Veeam, VMware, AWS, Dell, Lenovo. The guessed security-advisory URLs
  for these six 404'd or returned unparseable pages on the first run, so
  they're currently pointed back at each vendor's general blog feed
  (the same URLs from before this vulnerability-focused pass) so each vendor
  at least shows real content rather than nothing. If a proper public
  advisory feed exists for one of these vendors, swapping it in is a direct
  `FEEDS` array edit — see below.

After every workflow run, check the **Actions** log — any vendor whose feed
URL is wrong will fail loudly there (and that vendor's card will just show
its last known data instead of breaking anything else).

To find a dedicated security-advisory feed for one of the six above:
- Search "\<vendor name\> security advisories RSS" or "\<vendor name\> PSIRT feed".
- Look for a small RSS icon on their security-advisories/PSIRT page.
- View the page source and search for
  `<link rel="alternate" type="application/rss+xml" ...>` — the `href` is
  the feed URL.
- Some vendors publish advisories through a REST API or web portal rather
  than plain RSS/Atom — for those, this script's simple XML parser won't
  work, and pulling their data would need a small custom integration against
  that vendor's specific API instead.

Then update the `FEEDS` array at the top of `scripts/fetch-updates.mjs`.



## Customizing

- **Vendor list / feeds**: edit the `FEEDS` array in
  `scripts/fetch-updates.mjs`, and the `VENDORS` array in `index.html`
  (keep the vendor names in sync between the two — same order isn't
  required, just the same names).
- **General product news instead**: if you'd rather show general blog/product
  news instead of security advisories, swap the `FEEDS` URLs back to each
  vendor's main blog feed and loosen the severity logic in `classify()`.
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
