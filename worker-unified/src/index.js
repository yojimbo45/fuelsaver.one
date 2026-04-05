import { handleOptions } from './lib/cors.js';
import { json } from './lib/response.js';
import { filterSpread } from './lib/geo.js';
import { getStations } from './lib/kv.js';
import { VEHICLES } from './data/vehicles.js';

// Tier A — bulk-cached countries (full dataset refresh via cron)
import * as france from './countries/france.js';
import * as spain from './countries/spain.js';
import * as italy from './countries/italy.js';
import * as uk from './countries/uk.js';
import * as switzerland from './countries/switzerland.js';
import * as chile from './countries/chile.js';
import * as mexico from './countries/mexico.js';
import * as argentina from './countries/argentina.js';
import * as denmark from './countries/denmark.js';
import * as australiaWA from './countries/australia-wa.js';
import * as malaysia from './countries/malaysia.js';
import * as croatia from './countries/croatia.js';
import * as slovenia from './countries/slovenia.js';
import * as portugal from './countries/portugal.js';
import * as thailand from './countries/thailand.js';
import * as indonesia from './countries/indonesia.js';
import * as ireland from './countries/ireland.js';
import * as greece from './countries/greece.js';
import * as romania from './countries/romania.js';
import * as hungary from './countries/hungary.js';
import * as czech from './countries/czech.js';
import * as turkey from './countries/turkey.js';

// Tier B — proxy + grid-cache (on-demand)
import * as tankerkoenig from './countries/tankerkoenig.js';
import * as austria from './countries/austria.js';
import * as southKorea from './countries/south-korea.js';
import * as australia from './countries/australia.js';
import * as newZealand from './countries/new-zealand.js';
import * as netherlands from './countries/netherlands.js';
import * as belgium from './countries/belgium.js';
import * as uae from './countries/uae.js';
import * as southAfrica from './countries/south-africa.js';
import * as luxembourg from './countries/luxembourg.js';
import * as india from './countries/india.js';
import * as japan from './countries/japan.js';
import * as estonia from './countries/estonia.js';
import * as latvia from './countries/latvia.js';
import * as lithuania from './countries/lithuania.js';
import * as poland from './countries/poland.js';
import * as finland from './countries/finland.js';
import * as norway from './countries/norway.js';

import * as sweden from './countries/sweden.js';

// Tier C — proxy
import * as brazil from './countries/brazil.js';

const TIER_A = {
  fr: france, es: spain, it: italy, uk: uk, ch: switzerland,
  cl: chile, mx: mexico, ar: argentina,
  dk: denmark, wa: australiaWA, my: malaysia,
  hr: croatia, si: slovenia, pt: portugal,
  th: thailand, id: indonesia, ie: ireland,
  ro: romania, hu: hungary, cz: czech,
  gr: greece, tr: turkey,
};

const HANDLERS = {
  ...TIER_A,
  de: tankerkoenig,
  lu: luxembourg,
  at: austria,
  kr: southKorea,
  au: australia,
  br: brazil,
  nz: newZealand,
  nl: netherlands,
  be: belgium,
  ae: uae,
  za: southAfrica,
  in: india,
  jp: japan,
  ee: estonia,
  lv: latvia,
  lt: lithuania,
  pl: poland,
  fi: finland,
  no: norway,
  se: sweden,
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return handleOptions();
    }

    const url = new URL(request.url);

    // Logo proxy — fetches brand logos with CORS headers, cached in KV
    if (url.pathname.startsWith('/logo/')) {
      return handleLogo(url.pathname.slice(6), env);
    }

    // Image proxy — proxies external image URLs with CORS headers + KV cache
    // Used for logos from APIs that don't send CORS (e.g., Chilean API)
    if (url.pathname === '/img-proxy') {
      return handleImageProxy(url.searchParams.get('url'), env);
    }

    // Manual cron trigger endpoint
    if (url.pathname === '/cron') {
      const report = {};
      const results = await Promise.allSettled(
        Object.entries(TIER_A).map(async ([code, mod]) => {
          const start = Date.now();
          await mod.refresh(env);
          report[code] = { ok: true, ms: Date.now() - start };
        })
      );
      for (const [i, r] of results.entries()) {
        if (r.status === 'rejected') {
          const code = Object.keys(TIER_A)[i];
          report[code] = { ok: false, error: String(r.reason) };
        }
      }
      return json({ ok: true, report });
    }

    // One-time Mapbox brand crawl for France
    if (url.pathname === '/api/fr/build-brands') {
      try {
        const result = await france.buildBrands(env);
        return json({ ok: true, ...result });
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }

    // Google Places supplementary brand crawl (targets only unmatched stations)
    if (url.pathname === '/api/fr/build-brands-google') {
      try {
        const result = await france.buildBrandsGoogle(env);
        return json({ ok: true, ...result });
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }

    // Foursquare supplementary brand crawl (merges into existing brand DB)
    if (url.pathname === '/api/fr/build-brands-fsq') {
      try {
        const result = await france.buildBrandsFoursquare(env);
        return json({ ok: true, ...result });
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }

    // Spain brand enrichment endpoints
    if (url.pathname === '/api/es/build-brands-fsq') {
      try {
        const result = await spain.buildBrandsFoursquare(env);
        return json({ ok: true, ...result });
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }
    if (url.pathname === '/api/es/build-brands-google') {
      try {
        const result = await spain.buildBrandsGoogle(env);
        return json({ ok: true, ...result });
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }

    // Chile brand enrichment endpoints
    if (url.pathname === '/api/cl/build-brands-fsq') {
      try {
        const result = await chile.buildBrandsFoursquare(env);
        return json({ ok: true, ...result });
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }
    if (url.pathname === '/api/cl/build-brands-google') {
      try {
        const result = await chile.buildBrandsGoogle(env);
        return json({ ok: true, ...result });
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }

    // Speed test — measures worker processing time (KV read + filter), independent of client location
    if (url.pathname === '/speed') {
      const cf = request.cf || {};
      const tests = {};
      for (const [code, handler] of Object.entries(TIER_A)) {
        const testUrl = new URL(`${url.origin}/api/${code}?lat=48.85&lng=2.35&radius=10`);
        const start = performance.now();
        try {
          const res = await handler.handleQuery(testUrl, env, code);
          const body = await res.json();
          tests[code.toUpperCase()] = {
            ms: Math.round(performance.now() - start),
            count: body.count || 0,
          };
        } catch (e) {
          tests[code.toUpperCase()] = { ms: Math.round(performance.now() - start), error: e.message };
        }
      }
      return json({
        edgeLocation: cf.colo || 'unknown',
        country: cf.country || 'unknown',
        city: cf.city || 'unknown',
        tests,
      });
    }

    // Vehicle search API
    if (url.pathname === '/api/vehicles') {
      return handleVehicles(url);
    }

    const match = url.pathname.match(/^\/api\/([a-z]{2})$/);

    if (!match) {
      return json({ error: 'Not found. Use /api/{country_code}' }, 404);
    }

    const countryCode = match[1];
    const handler = HANDLERS[countryCode];

    if (!handler) {
      return json({ error: `Unsupported country: ${countryCode}` }, 400);
    }

    const lat = parseFloat(url.searchParams.get('lat'));
    const lng = parseFloat(url.searchParams.get('lng'));
    if (isNaN(lat) || isNaN(lng)) {
      return json({ error: 'lat and lng query params are required' }, 400);
    }

    try {
      // Spread mode: spatially distributed sampling for low-zoom overviews (Tier A only)
      const spread = url.searchParams.get('spread') === 'true';
      if (spread && TIER_A[countryCode]) {
        const radiusKm = parseFloat(url.searchParams.get('radius') || '15');
        const stations = await getStations(countryCode.toUpperCase(), env);
        if (!stations) return json({ error: 'Data not yet cached, try again later' }, 503);
        const filtered = filterSpread(stations, lat, lng, radiusKm);
        return json({ stations: filtered, count: filtered.length });
      }

      return await handler.handleQuery(url, env, countryCode);
    } catch (e) {
      console.error(`[${countryCode.toUpperCase()}] Error:`, e);
      return json({ error: e.message }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    console.log('[Cron] Starting bulk refresh for all Tier A countries...');

    const results = await Promise.allSettled(
      Object.entries(TIER_A).map(async ([code, mod]) => {
        const start = Date.now();
        await mod.refresh(env);
        console.log(`[Cron] ${code.toUpperCase()} refreshed in ${Date.now() - start}ms`);
      })
    );

    for (const [i, r] of results.entries()) {
      if (r.status === 'rejected') {
        const code = Object.keys(TIER_A)[i];
        console.error(`[Cron] ${code.toUpperCase()} FAILED:`, r.reason);
      }
    }
  },
};

// ─── Vehicle search ─────────────────────────────────────────────────

function handleVehicles(url) {
  const q = (url.searchParams.get('q') || '').toLowerCase().trim();
  const year = parseInt(url.searchParams.get('year')) || null;

  let results = VEHICLES;

  // Filter by year if provided
  if (year) {
    results = results.filter(v => {
      const [from, to] = v.years.split('-').map(Number);
      return year >= from && year <= to;
    });
  }

  // Search by query (matches make or model)
  if (q) {
    results = results.filter(v =>
      v.make.toLowerCase().includes(q) ||
      v.model.toLowerCase().includes(q) ||
      `${v.make} ${v.model}`.toLowerCase().includes(q)
    );
  }

  return json({
    count: results.length,
    vehicles: results.slice(0, 50),
  });
}

// ─── Logo proxy ──────────────────────────────────────────────────────
import { CORS_HEADERS } from './lib/cors.js';

// Brandfetch API keys — rotated when one runs out of credits
const BRANDFETCH_KEYS = [
  'YZ7RNm+jFb1vT90nDK+3Ro9lETa9J/xGXGEj045MoUI=',
  'lHTaIBGNQZhX0nKEZZhy0U-0tD0E1g7048jq0GvH5wWurNYRj8G-MNbIQcpRJaII8H8LZZ1b9ne0ku56He54TQ',
  'DB_E8mwZQg89a3fZ1Agvy-zTg1uLZV-d8Y8ffEuJPHtq-4r62-sF9CnY2GNlmue6OdKlcdF9kjaq4CvcjOlwlg',
  'EE7fKTOY-gtsdHbzELay8tgEiVTYDXUbeHdxBIhirxGZ55UV2ipn_6ssuYbjwkk0yZcBNPbEcqk7d8tMbXlD3A',
  'Hf1PyCkb3WR__RFgzHjtrEDR_li1xzWjB1Km2Be39U-KV6j1qCLpOQLHlZdMaCqKRFC2KoMIF3hdXuSi71LBog',
  'EUIaIIR-Rg7I6K2vh_jJyaS1dukGh-wL3gkOQ7PGBxYHlpXAp5oxIDgYDXnfmVOpKq14Nyr-KAHiyF2Yjk6BDg',
];

async function fetchBrandfetchLogo(domain) {
  for (const key of BRANDFETCH_KEYS) {
    try {
      const res = await fetch(`https://api.brandfetch.io/v2/brands/${domain}`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (res.status === 401 || res.status === 403 || res.status === 429) continue; // out of credits, try next key
      if (!res.ok) return null; // brand not found
      const data = await res.json();
      // Find the best logo: prefer icon, then logo, pick PNG/JPEG over SVG
      const allLogos = [...(data.logos || [])];
      let bestUrl = null;
      for (const logo of allLogos) {
        const formats = logo.formats || [];
        // Prefer icon type, then logo type
        const pngOrJpg = formats.find((f) => f.format === 'png' || f.format === 'jpeg');
        const svg = formats.find((f) => f.format === 'svg');
        const pick = pngOrJpg || svg;
        if (pick && pick.src) {
          bestUrl = pick.src;
          if (logo.type === 'icon') break; // icon is ideal, stop searching
        }
      }
      if (!bestUrl) return null;
      // Fetch the actual image
      const imgRes = await fetch(bestUrl);
      if (!imgRes.ok) return null;
      const buf = await imgRes.arrayBuffer();
      if (buf.byteLength < 100) return null;
      return buf;
    } catch {
      continue;
    }
  }
  return null;
}

async function handleLogo(domain, env) {
  if (!domain || domain.length > 100) {
    return new Response(null, { status: 400 });
  }

  const cacheKey = `logo:${domain}`;

  // Check KV cache
  const cached = await env.FUEL_KV.get(cacheKey, { type: 'arrayBuffer' });
  if (cached) {
    return new Response(cached, {
      headers: {
        'Content-Type': detectImageType(new Uint8Array(cached)),
        'Cache-Control': 'public, max-age=604800',
        ...CORS_HEADERS,
      },
    });
  }

  let imgData = null;

  // 1. Brandfetch (best quality, rotates keys on credit exhaustion)
  imgData = await fetchBrandfetchLogo(domain);

  // 2. Uplead (consistent 128px PNG)
  if (!imgData) {
    imgData = await fetchImage(`https://logo.uplead.com/${domain}`, 500);
  }

  // 3. Google favicons as last resort
  if (!imgData) {
    imgData = await fetchImage(
      `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://${domain}&size=256`,
      100
    );
  }

  if (!imgData) {
    return new Response(null, { status: 404, headers: CORS_HEADERS });
  }

  // Cache permanently — logos don't change
  await env.FUEL_KV.put(cacheKey, imgData);

  return new Response(imgData, {
    headers: {
      'Content-Type': detectImageType(new Uint8Array(imgData)),
      'Cache-Control': 'public, max-age=604800',
      ...CORS_HEADERS,
    },
  });
}

function detectImageType(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes[0] === 0xFF && bytes[1] === 0xD8) return 'image/jpeg';
  if (bytes[0] === 0x3C || (bytes[0] === 0xEF && bytes[1] === 0xBB)) return 'image/svg+xml';
  if (bytes[0] === 0x00 && bytes[1] === 0x00) return 'image/x-icon';
  return 'image/png';
}

async function fetchImage(url, minBytes = 500) {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok || res.status === 404) return null;
    const buf = await res.arrayBuffer();
    // Skip tiny images (16x16 favicons, error pages)
    if (buf.byteLength < minBytes) return null;
    return buf;
  } catch {
    return null;
  }
}

// ─── Image proxy (CORS wrapper for external logos) ───────────────────
async function handleImageProxy(imageUrl, env) {
  if (!imageUrl) return new Response(null, { status: 400, headers: CORS_HEADERS });

  const cacheKey = `imgproxy:${imageUrl}`;
  const cached = await env.FUEL_KV.get(cacheKey, { type: 'arrayBuffer' });
  if (cached) {
    return new Response(cached, {
      headers: {
        'Content-Type': detectImageType(new Uint8Array(cached)),
        'Cache-Control': 'public, max-age=31536000',
        ...CORS_HEADERS,
      },
    });
  }

  const imgData = await fetchImage(imageUrl, 100);
  if (!imgData) return new Response(null, { status: 404, headers: CORS_HEADERS });

  // Cache permanently
  await env.FUEL_KV.put(cacheKey, imgData);

  return new Response(imgData, {
    headers: {
      'Content-Type': detectImageType(new Uint8Array(imgData)),
      'Cache-Control': 'public, max-age=31536000',
      ...CORS_HEADERS,
    },
  });
}
