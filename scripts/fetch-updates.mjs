// Fetches the latest post from each vendor's security-advisory / vulnerability
// feed and writes the result to data/updates.json. No API key, no cost — just
// public XML feeds published by each vendor.
//
// Requires: Node.js 18+ (built-in fetch).
//
// NOTE ON FEED URLS AND CONFIDENCE: security-advisory feeds are far less
// standardized than general company blogs, and several vendors have moved
// away from plain RSS toward API/portal-based disclosure systems. The list
// below is best-effort; each entry is commented with a rough confidence
// level. Check the Actions log after your first run — any vendor whose feed
// URL is wrong will fail loudly there and just keep showing its last known
// data instead of breaking the page. To find/replace a broken URL: look for
// an RSS icon on the vendor's security-advisories or PSIRT page, view page
// source for <link rel="alternate" type="application/rss+xml" href="...">,
// or check the vendor's developer/security documentation for a feed URL.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, "..", "data", "updates.json");

const FEEDS = [
  // Higher confidence — long-standing, documented advisory feeds.
  { name: "Cisco",     url: "https://tools.cisco.com/security/center/psirtrss20/CiscoSecurityAdvisory.xml" },
  { name: "Fortinet",  url: "https://filestore.fortinet.com/fortiguard/rss/ir.xml" },

  // Lower confidence — best-effort guess, verify once live. These four
  // returned 404 on the first real run and need a human to find the correct
  // URL (see the section below on how). Left pointing at the vendor's
  // general blog feed for now so the vendor at least shows *something*
  // rather than nothing, but this is not vulnerability-specific content.
  { name: "SAP",       url: "https://news.sap.com/feed/" },
  { name: "Veeam",     url: "https://www.veeam.com/blog/feed" },
  { name: "VMware",    url: "https://blogs.vmware.com/feed" },
  { name: "Dell",      url: "https://www.dell.com/en-us/blog/feed/" },

  // Also unverified, but the general-purpose feed (not security-specific)
  // is confirmed working from an earlier version of this script.
  { name: "Microsoft", url: "https://api.msrc.microsoft.com/update-guide/rss" },
  { name: "AWS",       url: "https://aws.amazon.com/about-aws/whats-new/recent/feed/" },
  { name: "Lenovo",    url: "https://news.lenovo.com/feed/" }
];

function decodeEntities(str) {
  return str
    .replace(/<!\[CDATA\[/g, "")
    .replace(/\]\]>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

function stripHtml(str) {
  return str.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function truncateWords(str, maxWords) {
  const words = str.split(" ").filter(Boolean);
  if (words.length <= maxWords) return str;
  return words.slice(0, maxWords).join(" ") + "…";
}

function extractTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeEntities(match[1]) : "";
}

function extractAtomLink(block) {
  const match = block.match(/<link[^>]*href="([^"]+)"[^>]*\/?>/i);
  return match ? match[1] : "";
}

function toIsoDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function classify(text) {
  const t = text.toLowerCase();

  if (t.includes("end of life") || t.includes("end-of-life") || t.includes("deprecat") || t.includes("retire")) return "eol";

  const mentionsSecurity = t.includes("security") || t.includes("vulnerab") || t.includes("cve") || t.includes("advisory") || t.includes("exploit");

  if (mentionsSecurity) {
    // Distinguish true critical/high-severity vulnerabilities from routine,
    // lower-severity advisories — otherwise every item from a security feed
    // would land in "Critical" and the label loses meaning.
    const highSeverity = t.includes("critical") || t.includes("high severity") || t.includes("high-severity")
      || t.includes("cvss:3") && (t.includes(" 9.") || t.includes(" 10.")) // rough CVSS 9.x/10.x mention
      || t.includes("actively exploited") || t.includes("zero-day") || t.includes("zero day");
    return highSeverity ? "critical" : "patch";
  }

  if (t.includes("patch") || t.includes("hotfix") || t.includes("fix") || t.includes("update kb")) return "patch";
  return "feature";
}

function parseAllEntries(xml) {
  const results = [];

  // RSS 2.0 (<item>...</item>)
  const itemBlocks = xml.match(/<item[\s\S]*?<\/item>/gi);
  if (itemBlocks && itemBlocks.length) {
    for (const block of itemBlocks) {
      const title = stripHtml(extractTag(block, "title"));
      const link = stripHtml(extractTag(block, "link"));
      const pubDate = extractTag(block, "pubDate") || extractTag(block, "dc:date");
      const description = stripHtml(extractTag(block, "description") || extractTag(block, "content:encoded"));
      results.push({ title, link, date: toIsoDate(pubDate), summary: truncateWords(description, 80) });
    }
    return results;
  }

  // Atom (<entry>...</entry>)
  const entryBlocks = xml.match(/<entry[\s\S]*?<\/entry>/gi);
  if (entryBlocks && entryBlocks.length) {
    for (const block of entryBlocks) {
      const title = stripHtml(extractTag(block, "title"));
      const link = extractAtomLink(block);
      const updated = extractTag(block, "updated") || extractTag(block, "published");
      const summary = stripHtml(extractTag(block, "summary") || extractTag(block, "content"));
      results.push({ title, link, date: toIsoDate(updated), summary: truncateWords(summary, 80) });
    }
  }

  return results;
}

async function fetchVendorFeed(vendor, url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; JulpharITUpdatesBot/1.0; +https://github.com/)",
      "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*"
    }
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }
  const xml = await res.text();
  const entries = parseAllEntries(xml);
  if (!entries.length || !entries[0].title) {
    throw new Error(`Could not parse a feed entry from ${url}`);
  }

  const latest = entries[0];
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const count7d = entries.filter(e => e.date && new Date(e.date).getTime() >= sevenDaysAgo).length || 1;

  return {
    vendor,
    title: truncateWords(latest.title, 20),
    date: latest.date,
    summary: latest.summary,
    category: classify(latest.title + " " + latest.summary),
    url: latest.link,
    count7d
  };
}

async function loadExisting() {
  try {
    const raw = await fs.readFile(OUTPUT_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return { vendors: parsed.vendors || {}, nvd: parsed.nvd || {} };
  } catch {
    return { vendors: {}, nvd: {} };
  }
}

// ---- NVD (National Vulnerability Database) integration ----
// Public API, no key required at this request volume. Used to supplement
// the ticker with actual CVE records for each vendor over the last 7 days —
// this is a much more consistent and authoritative source than individual
// vendor blogs/feeds, since NVD covers every vendor the same way.
// Docs: https://nvd.nist.gov/developers/vulnerabilities
const NVD_API_URL = "https://services.nvd.nist.gov/rest/json/cves/2.0";

// NVD's keywordSearch does a text match against CVE descriptions. Some
// vendor names are too short/ambiguous on their own (e.g. "AWS" can appear
// as a substring in unrelated contexts), so a few vendors get a fuller
// search term here instead of their display name.
const NVD_SEARCH_TERMS = {
  "Microsoft": "Microsoft",
  "SAP": "SAP",
  "Veeam": "Veeam",
  "Cisco": "Cisco",
  "VMware": "VMware",
  "AWS": "Amazon Web Services",
  "Dell": "Dell",
  "Fortinet": "Fortinet",
  "Lenovo": "Lenovo"
};

// NVD allows 5 requests per rolling 30 seconds without an API key. With 9
// vendors fetched one at a time, spacing requests out comfortably avoids
// tripping that limit. If you get a free API key from
// https://nvd.nist.gov/developers/request-an-api-key, you can raise this
// limit and pass the key via the NVD_API_KEY environment variable/secret.
const NVD_REQUEST_DELAY_MS = 6500;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function severityFromCve(cve) {
  const metrics = cve.metrics || {};
  const v31 = metrics.cvssMetricV31?.[0]?.cvssData;
  const v30 = metrics.cvssMetricV30?.[0]?.cvssData;
  const v2 = metrics.cvssMetricV2?.[0];
  if (v31?.baseSeverity) return { severity: v31.baseSeverity, score: v31.baseScore };
  if (v30?.baseSeverity) return { severity: v30.baseSeverity, score: v30.baseScore };
  if (v2?.baseSeverity) return { severity: v2.baseSeverity, score: v2.cvssData?.baseScore };
  return { severity: null, score: null };
}

async function fetchNvdCvesForVendor(vendor) {
  const searchTerm = NVD_SEARCH_TERMS[vendor] || vendor;
  const pubEndDate = new Date();
  const pubStartDate = new Date(pubEndDate.getTime() - 7 * 24 * 60 * 60 * 1000);

  const params = new URLSearchParams({
    keywordSearch: searchTerm,
    pubStartDate: pubStartDate.toISOString(),
    pubEndDate: pubEndDate.toISOString(),
    resultsPerPage: "20"
  });

  const headers = {
    "User-Agent": "Mozilla/5.0 (compatible; JulpharITUpdatesBot/1.0; +https://github.com/)"
  };
  if (process.env.NVD_API_KEY) {
    headers["apiKey"] = process.env.NVD_API_KEY;
  }

  const res = await fetch(`${NVD_API_URL}?${params.toString()}`, { headers });
  if (!res.ok) {
    throw new Error(`NVD HTTP ${res.status} for ${vendor}`);
  }
  const data = await res.json();
  const vulns = data.vulnerabilities || [];
  const totalCount = typeof data.totalResults === "number" ? data.totalResults : vulns.length;

  const items = vulns.map(v => {
    const cve = v.cve;
    const descriptions = cve.descriptions || [];
    const enDesc = descriptions.find(d => d.lang === "en")?.value || "";
    const { severity } = severityFromCve(cve);
    return {
      id: cve.id,
      title: truncateWords(stripHtml(enDesc), 35),
      date: toIsoDate(cve.published),
      severity: severity || "UNKNOWN",
      url: `https://nvd.nist.gov/vuln/detail/${cve.id}`
    };
  });

  // Most severe and most recent first; cap the ticker's item list so it
  // doesn't get overwhelmed by a single vendor in a bad week — but the
  // *count* shown in the summary strip reflects the true 7-day total, not
  // just this capped sample.
  const severityRank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, UNKNOWN: 4 };
  items.sort((a, b) => {
    const rankDiff = (severityRank[a.severity] ?? 4) - (severityRank[b.severity] ?? 4);
    if (rankDiff !== 0) return rankDiff;
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  });

  return { count: totalCount, items: items.slice(0, 5) };
}

async function fetchAllNvdData(existingNvd) {
  const nvd = { ...existingNvd };
  const vendorNames = Object.keys(NVD_SEARCH_TERMS);

  for (let i = 0; i < vendorNames.length; i++) {
    const vendor = vendorNames[i];
    try {
      nvd[vendor] = await fetchNvdCvesForVendor(vendor);
    } catch (err) {
      console.error(`Failed to fetch NVD data for ${vendor}:`, err.message || err);
      // keep whatever was there before (already the default via spread above)
    }
    if (i < vendorNames.length - 1) {
      await sleep(NVD_REQUEST_DELAY_MS);
    }
  }

  return nvd;
}

async function main() {
  const existing = await loadExisting();
  const results = await Promise.allSettled(FEEDS.map(f => fetchVendorFeed(f.name, f.url)));

  const vendors = { ...existing.vendors };
  let failures = 0;

  results.forEach((r, i) => {
    const vendorName = FEEDS[i].name;
    if (r.status === "fulfilled" && r.value) {
      vendors[vendorName] = r.value;
    } else {
      failures++;
      console.error(`Failed to fetch feed for ${vendorName}:`, r.reason?.message || r.reason);
    }
  });

  console.log("Fetching NVD vulnerability data (rate-limited, this takes about a minute)...");
  const nvd = await fetchAllNvdData(existing.nvd);

  const output = {
    generatedAt: new Date().toISOString(),
    vendors,
    nvd
  };

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2) + "\n", "utf-8");

  console.log(`Wrote ${Object.keys(vendors).length} vendor updates to ${OUTPUT_PATH}.`);
  if (failures > 0) {
    console.warn(`${failures} of ${FEEDS.length} vendor feeds failed this run (kept previous data for those). See errors above — likely a stale feed URL that needs updating.`);
  }
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
