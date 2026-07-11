/**
 * Vidrock.ru — custom 4reels server
 *
 * Strategy (based on community tip):
 * 1. Fetch the vidrock.ru embed page for the TMDB id
 * 2. Extract the proxied m3u8 URL that vidrock returns in its player config
 * 3. Re-proxy that m3u8 ourselves with the right headers — avoids the
 *    double-proxy latency and lets us serve the stream directly from our domain
 *
 * The m3u8 proxy:
 *  GET /api/stream/proxy?url=<encoded_m3u8_url>
 *  - Fetches the playlist, rewrites relative segment URLs to go through
 *    our proxy too, and returns it with correct HLS headers
 *  - Segment requests: GET /api/stream/segment?url=<encoded_ts_url>
 */
'use strict';

const axios     = require('axios');
const NodeCache = require('node-cache');

const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

// Headers that mimic a real browser hitting vidrock — required for their server
const BROWSER_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0 Safari/537.36',
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer':         'https://vidrock.ru/',
  'Origin':          'https://vidrock.ru',
};

const HLS_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0 Safari/537.36',
  'Accept':          '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer':         'https://vidrock.ru/',
  'Origin':          'https://vidrock.ru',
};

/**
 * Step 1 — Get the embed page and extract the m3u8 URL
 * Vidrock stores the stream URL in a JS variable like:
 *   file: "https://..."   or   source: "https://...m3u8"
 */
async function extractM3u8(tmdbId) {
  const cacheKey = `vidrock:${tmdbId}`;
  const cached   = cache.get(cacheKey);
  if (cached) return cached;

  const embedUrl = `https://vidrock.ru/embed/movie/${tmdbId}`;

  let html;
  try {
    const res = await axios.get(embedUrl, {
      headers: BROWSER_HEADERS,
      timeout: 12000,
      maxRedirects: 5,
    });
    html = res.data;
  } catch (err) {
    throw new Error(`Vidrock fetch failed: ${err.message}`);
  }

  // Try multiple extraction patterns — vidrock may use jwplayer or plyr config
  const patterns = [
    /file\s*:\s*["']([^"']+\.m3u8[^"']*?)["']/i,
    /source\s*:\s*["']([^"']+\.m3u8[^"']*?)["']/i,
    /src\s*:\s*["']([^"']+\.m3u8[^"']*?)["']/i,
    /"url"\s*:\s*"([^"]+\.m3u8[^"]*?)"/i,
    /hls\s*:\s*["']([^"']+\.m3u8[^"']*?)["']/i,
    /["']([^"']*\/index\.m3u8[^"']*?)["']/i,
    /["']([^"']*\/master\.m3u8[^"']*?)["']/i,
    /["']([^"']+\.m3u8)["']/i,
  ];

  let m3u8Url = null;
  for (const pat of patterns) {
    const match = html.match(pat);
    if (match?.[1]) {
      m3u8Url = match[1];
      break;
    }
  }

  if (!m3u8Url) {
    throw new Error('Could not find m3u8 stream in vidrock response. The embed page structure may have changed.');
  }

  // Make absolute if relative
  if (m3u8Url.startsWith('/')) {
    m3u8Url = 'https://vidrock.ru' + m3u8Url;
  }

  cache.set(cacheKey, m3u8Url);
  return m3u8Url;
}

/**
 * Step 2 — Fetch the m3u8 playlist and rewrite segment/sub-playlist URLs
 * to go through our own proxy endpoint, so the browser never hits the
 * vidrock CDN directly (avoids CORS + auth failures)
 */
async function fetchAndRewriteM3u8(m3u8Url, proxyBase) {
  let text;
  try {
    const res = await axios.get(m3u8Url, {
      headers:      HLS_HEADERS,
      timeout:      10000,
      responseType: 'text',
    });
    text = res.data;
  } catch (err) {
    throw new Error(`m3u8 fetch failed: ${err.message}`);
  }

  // Compute the base URL for resolving relative paths
  const base = m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1);

  // Rewrite each line that is a URI (segment or sub-playlist)
  const lines = text.split('\n').map(line => {
    line = line.trim();
    if (!line || line.startsWith('#')) return line; // metadata — keep as-is

    // Resolve relative URLs
    let absUrl = line.startsWith('http') ? line : base + line;

    // Determine whether this is a sub-playlist or a segment
    if (absUrl.includes('.m3u8')) {
      // Sub-playlist (quality variant) — proxy through m3u8 route
      return `${proxyBase}/api/stream/proxy?url=${encodeURIComponent(absUrl)}`;
    } else {
      // Segment (.ts, .aac, etc.) — proxy through segment route
      return `${proxyBase}/api/stream/segment?url=${encodeURIComponent(absUrl)}`;
    }
  });

  return lines.join('\n');
}

module.exports = { extractM3u8, fetchAndRewriteM3u8, HLS_HEADERS };
