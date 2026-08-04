// Fetches the latest post from each vendor's official RSS/Atom feed and
// writes the result to data/updates.json. No API key, no cost — just public
// XML feeds published by each vendor.
//
// Requires: Node.js 18+ (built-in fetch).
//
// NOTE ON FEED URLS: vendors occasionally change their blog platforms, which
// changes feed URLs. If a vendor below starts failing, find its new feed URL
// (look for a small RSS icon on their blog, view page source for
// <link rel="alternate" type="application/rss+xml" href="...">, or try
// appending /feed or /rss to the blog's root URL) and update FEEDS below.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, "..", "data", "updates.json");

// Update this list to change which vendors are tracked, or swap in a more
// specific feed (e.g. a security-advisories-only feed instead of the general
// blog) if that's more useful for your TV screen.
const FEEDS = [
  { name: "Microsoft", url: "https://blogs.windows.com/feed/" },
  { name: "SAP",       url: "https://news.sap.com/feed/" },
  { name: "Veeam",     url: "https://www.veeam.com/blog/feed" },
  { name: "Cisco",     url: "https://blogs.cisco.com/feed" },
  { name: "VMware",    url: "https://blogs.vmware.com/feed" },
  { name: "AWS",       url: "https://aws.amazon.com/about-aws/whats-new/recent/feed/" },
  { name: "Dell",      url: "https://www.dell.com/en-us/blog/feed/" },
  { name: "Fortinet",  url: "https://www.fortinet.com/blog/rss" },
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
  if (t.includes("security") || t.includes("vulnerab") || t.includes("cve") || t.includes("advisory")) return "critical";
  if (t.includes("patch") || t.includes("hotfix") || t.includes("fix") || t.includes("update kb")) return "patch";
  if (t.includes("end of life") || t.includes("end-of-life") || t.includes("deprecat") || t.includes("retire")) return "eol";
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
      results.push({ title, link, date: toIsoDate(pubDate), summary: truncateWords(description, 20) });
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
      results.push({ title, link, date: toIsoDate(updated), summary: truncateWords(summary, 20) });
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
    title: truncateWords(latest.title, 12),
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
    return parsed.vendors || {};
  } catch {
    return {};
  }
}

async function main() {
  const existing = await loadExisting();
  const results = await Promise.allSettled(FEEDS.map(f => fetchVendorFeed(f.name, f.url)));

  const vendors = { ...existing };
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

  const output = {
    generatedAt: new Date().toISOString(),
    vendors
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
