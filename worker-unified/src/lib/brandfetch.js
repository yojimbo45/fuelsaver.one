/**
 * Shared Brandfetch logo resolution with permanent KV caching.
 *
 * Usage:
 *   import { resolveLogos } from '../lib/brandfetch.js';
 *   const logoMap = await resolveLogos(brands, brandDomains, env, 'UK');
 */

export async function resolveLogos(brands, brandDomains, env, countryCode) {
  const logoMap = {};
  const apiKey = env.BRANDFETCH_KEY;
  if (!apiKey) {
    console.log(`[${countryCode}] No BRANDFETCH_KEY, skipping logo resolution`);
    return logoMap;
  }

  for (const brand of brands) {
    const domain = brandDomains[brand];
    if (!domain) continue;

    const cacheKey = `${countryCode.toLowerCase()}-logo:${brand}`;

    const cached = await env.FUEL_KV.get(cacheKey);
    if (cached) {
      logoMap[brand] = cached;
      continue;
    }

    try {
      const res = await fetch(`https://api.brandfetch.io/v2/brands/${domain}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) {
        console.log(`[${countryCode}] Brandfetch ${res.status} for ${domain}`);
        continue;
      }
      const data = await res.json();
      let bestUrl = null;
      for (const logo of (data.logos || [])) {
        const formats = logo.formats || [];
        const pngOrJpg = formats.find((f) => f.format === 'png' || f.format === 'jpeg');
        const svg = formats.find((f) => f.format === 'svg');
        const pick = pngOrJpg || svg;
        if (pick?.src) {
          bestUrl = pick.src;
          if (logo.type === 'icon') break;
        }
      }
      if (bestUrl) {
        logoMap[brand] = bestUrl;
        await env.FUEL_KV.put(cacheKey, bestUrl); // permanent cache
        console.log(`[${countryCode}] Logo resolved: ${brand}`);
      }
    } catch (err) {
      console.log(`[${countryCode}] Brandfetch error for ${brand}: ${err.message}`);
    }
  }

  return logoMap;
}

/**
 * Helper: collect unique brands from stations, resolve logos, assign to stations.
 */
export async function assignLogos(stations, brandDomains, env, countryCode) {
  const uniqueBrands = new Set();
  for (const s of stations) {
    if (s.brand && s.brand !== 'Station') uniqueBrands.add(s.brand);
  }
  const logoMap = await resolveLogos([...uniqueBrands], brandDomains, env, countryCode);
  for (const s of stations) {
    s.logo = logoMap[s.brand] || null;
  }
  return Object.keys(logoMap).length;
}
