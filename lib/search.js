const API_URL = "https://ydc-index.io/v1/search";
const CONTENTS_URL = "https://ydc-index.io/v1/contents";
const API_KEY = process.env.YDC_API_KEY || "";
const TIMEOUT = Number(process.env.SEARCH_TIMEOUT_MS || 20000);
const MAX_RESULTS = 5;
const MAX_SNIPPET = 400;
const MAX_PAGE_CHARS = Number(process.env.SEARCH_MAX_PAGE_CHARS || 6000);

function isReady() {
  return Boolean(API_KEY);
}

function clip(text) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  return value.length > MAX_SNIPPET ? `${value.slice(0, MAX_SNIPPET)}...` : value;
}

async function search(query, options = {}) {
  const q = String(query || "").trim();
  if (!q) throw new Error("query is empty");
  if (!API_KEY) throw new Error("YDC_API_KEY is not set");

  const count = Math.min(Math.max(Number(options.count) || MAX_RESULTS, 1), 10);
  const body = {
    query: q,
    count,
    safesearch: options.safesearch || "moderate",
    knowledge: "core",
  };
  if (options.freshness) body.freshness = options.freshness;
  if (options.country) body.country = options.country;
  if (options.language) body.language = options.language;

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "X-API-Key": API_KEY,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) {
    throw new Error(`Search HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
  }
  const data = await res.json();
  const web = Array.isArray(data.results?.web) ? data.results.web : [];
  return web.map((item) => ({
    title: clip(item.title),
    url: item.url,
    snippet: clip((item.snippets && item.snippets[0]) || item.description),
  }));
}

function format(results) {
  if (!results.length) return "No results found.";
  return results
    .map((r, i) => `${i + 1}. ${r.title}\n${r.url}\n${r.snippet}`)
    .join("\n\n");
}

function isPrivateHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const [a, b] = host.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) return true;
  return false;
}

async function fetchPage(url, format = "markdown", timeout = 60) {
  const target = String(url || "").trim();
  if (!target) throw new Error("url is empty");
  if (!/^https?:\/\//i.test(target)) throw new Error("url must start with http(s)://");
  if (!API_KEY) throw new Error("YDC_API_KEY is not set");
  let hostname;
  try {
    hostname = new URL(target).hostname;
  } catch {
    throw new Error("url is not valid");
  }
  if (isPrivateHost(hostname)) throw new Error("url points to a private or local address");

  const res = await fetch(CONTENTS_URL, {
    method: "POST",
    headers: {
      "X-API-Key": API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ urls: [target], formats: [format], crawl_timeout: timeout }),
    signal: AbortSignal.timeout((timeout + 15) * 1000),
  });
  if (!res.ok) {
    throw new Error(`Contents HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
  }
  const data = await res.json();
  const items = Array.isArray(data) ? data : data.results || [data];
  const first = items.find((item) => item && (item.markdown || item.html || item.text)) || items[0];
  if (!first) throw new Error("empty response");
  const content = first.markdown || first.html || first.text || "";
  if (!content) throw new Error("no readable content");
  return String(content).slice(0, MAX_PAGE_CHARS);
}

module.exports = { search, fetchPage, format, isReady };
