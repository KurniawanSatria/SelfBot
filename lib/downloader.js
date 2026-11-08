const { spawn } = require("child_process");
const axios = require("axios");
const https = require("https");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");
const os = require("os");

const agent = new https.Agent({ rejectUnauthorized: true, maxVersion: "TLSv1.3", minVersion: "TLSv1.2" });

async function getCookies() {
  try {
    const response = await axios.get("https://www.pinterest.com/csrf_error/", { httpsAgent: agent });
    const setCookieHeaders = response.headers["set-cookie"];
    if (setCookieHeaders) {
      const cookies = setCookieHeaders.map((cookieString) => {
        const cookieParts = cookieString.split(";");
        return cookieParts[0].trim();
      });
      return cookies.join("; ");
    }
    return null;
  } catch {
    return null;
  }
}

async function pinterest(query) {
  try {
    const cookies = await getCookies();
    if (!cookies) return [];
    const url = "https://www.pinterest.com/resource/BaseSearchResource/get/";
    const params = { source_url: `/search/pins/?q=${query}`, data: JSON.stringify({ options: { isPrefetch: false, query: query, scope: "pins", no_fetch_context_on_resource: false }, context: {} }), _: Date.now() };
    const headers = {
      accept: "application/json, text/javascript, */*; q=0.01",
      "accept-encoding": "gzip, deflate",
      "accept-language": "en-US,en;q=0.9",
      cookie: cookies,
      dnt: "1",
      referer: "https://www.pinterest.com/",
      "sec-ch-ua": '"Not(A:Brand";v="99", "Microsoft Edge";v="133", "Chromium";v="133"',
      "sec-ch-ua-full-version-list": '"Not(A:Brand";v="99.0.0.0", "Microsoft Edge";v="133.0.3065.92", "Chromium";v="133.0.6943.142"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-model": '""',
      "sec-ch-ua-platform": '"Windows"',
      "sec-ch-ua-platform-version": '"10.0.0"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36 Edg/133.0.0.0",
      "x-app-version": "c056fb7",
      "x-pinterest-appstate": "active",
      "x-pinterest-pws-handler": "www/[username]/[slug].js",
      "x-pinterest-source-url": "/hargr003/cat-pictures/",
      "x-requested-with": "XMLHttpRequest",
    };
    const { data } = await axios.get(url, { httpsAgent: agent, headers, params });
    return data.resource_response.data.results.filter((v) => v.images?.orig).map((result) => ({ image: { url: result.images.orig.url }, caption: result.grid_title })).slice(0, 10);
  } catch {
    return [];
  }
}

async function ttsave(url) {
  try {
    const requestData = new URLSearchParams({ url: url, count: 12, cursor: 0, web: 1, hd: 1 });
    const response = await axios.post("https://tikwm.com/api/", requestData, { headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", Accept: "application/json, text/javascript, */*; q=0.01", "X-Requested-With": "XMLHttpRequest" } });
    const apiData = response.data;
    if (apiData.code !== 0) return { author: "Saturiaaa", status: 400, message: apiData.msg || "API request failed" };
    const data = apiData.data;
    const isSlide = data.images && data.images.length > 0;
    const isVideo = data.duration > 0 && (data.play || data.hdplay);
    let contentType;
    if (isSlide) {
      contentType = "slide";
    } else if (isVideo) {
      contentType = "video";
    } else {
      contentType = "unknown";
    }
    const result = {
      author: "Saturia",
      status: 200,
      data: {
        type: contentType,
        id: data.id,
        title: data.title,
        region: data.region,
        cover: `https://tikwm.com${data.cover}`,
        duration: data.duration,
        author: {
          id: data.author.id,
          username: data.author.unique_id,
          nickname: data.author.nickname,
          avatar: `https://tikwm.com${data.author.avatar}`,
        },
        stats: {
          play_count: data.play_count,
          digg_count: data.digg_count,
          comment_count: data.comment_count,
          share_count: data.share_count,
          download_count: data.download_count,
          collect_count: data.collect_count,
        },
        music: data.music_info ? {
          id: data.music_info.id,
          title: data.music_info.title,
          author: data.music_info.author,
          duration: data.music_info.duration,
          original: data.music_info.original,
          play_url: data.music_info.play,
        }
          : null,
        created_time: data.create_time,
      },
    };

    if (contentType === "video") {
      result.data.video = {
        play_url: `https://tikwm.com${data.play}`,
        watermark_play_url: `https://tikwm.com${data.wmplay}`,
        hd_play_url: `https://tikwm.com${data.hdplay}`,
        size: data.size,
        wm_size: data.wm_size,
        hd_size: data.hd_size,
      };
      result.data.music_url = `https://tikwm.com${data.music}`;
    } else if (contentType === "slide") {
      result.data.images = data.images.map((img) => {
        if (img.startsWith("http")) {
          return img;
        }
        return `https://tikwm.com${img}`;
      });
      result.data.music_url = `https://tikwm.com${data.music}`;
    }
    return result;
  } catch (error) {
    return {
      author: "Saturia",
      status: 500,
      message: "Error occurred while scraping",
      error: error.message,
    };
  }
}

async function instaDL(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await axios.post("https://api.zoraahub.com/fetch.php", { url }, { headers: { "content-type": "application/json", accept: "*/*", Referer: "https://downreels.com/" }, timeout: 15000 });
      const data = res.data;
      if (data.status !== "ok" || !Array.isArray(data.videos)) return [];
      return data.videos.map((item) => item.isVideo ? { video: { url: item.url } } : { image: { url: item.url } });
    } catch (err) {
      const status = err.response?.status;
      const retryable = [502, 503, 504].includes(status) || err.code === "ECONNABORTED";
      console.error(`[instaDL] Attempt ${attempt} failed:`, status || err.code || err.message);
      if (!retryable || attempt === retries) return [];
      await new Promise((r) => setTimeout(r, attempt * 1000));
    }
  }
  return [];
}

async function instagram(url) {
  const response = await fetch("https://api.downloadgram.org/media", { method: "POST", headers: { accept: "*/*", "content-type": "application/x-www-form-urlencoded", origin: "https://downloadgram.org", referer: "https://downloadgram.org/" }, body: new URLSearchParams({ url }) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  let body = await response.text();
  body = body.replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  const results = [];
  const blockRegex = /<div class="download-items__thumb">[\s\S]*?<i class="icon-sprite icon-i(photo|video)"><\/i>[\s\S]*?<\/div>\s*<div class="download-items__btn"><a\s+href="([^"]+)"/g;
  let match;
  while ((match = blockRegex.exec(body)) !== null) {
    const [, iconType, mediaUrl] = match;
    const key = iconType === "video" ? "video" : "image";
    results.push({ [key]: { url: mediaUrl } });
  }
  return results;
}

async function twitter(url) {
  const id = (String(url).match(/status\/(\d+)/) || [])[1];
  if (!id) return [];
  const handle = (String(url).match(/(?:x|twitter|vxtwitter|fxtwitter)\.com\/([A-Za-z0-9_]+)\/status\/\d+/i) || [])[1];
  const apis = [`https://api.vxtwitter.com/i/status/${id}`];
  if (handle) apis.push(`https://api.fxtwitter.com/${handle}/status/${id}`);
  for (const api of apis) {
    try {
      const { data } = await axios.get(api, { timeout: 15000 });
      const t = data?.tweet || data;
      const items = t?.media?.all || t?.media_extended || [];
      const out = [];
      for (const m of items) {
        if (!m?.url) continue;
        out.push(/video|gif/i.test(m.type || "") ? { video: { url: m.url } } : { image: { url: m.url } });
      }
      if (!out.length && Array.isArray(t?.mediaURLs)) for (const u of t.mediaURLs) out.push(/pbs\.twimg\.com\/media|\.(jpg|jpeg|png|webp)(\?|#|$)/i.test(u) ? { image: { url: u } } : { video: { url: u } });
      if (out.length) {
        if (t?.text) out[0].caption = t.text;
        return out;
      }
    } catch {}
  }
  return [];
}

module.exports = {
  pinterest,
  instagram,
  ttsave,
  instaDL,
  twitter,
};
