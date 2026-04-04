/**
 * UK — CMA-mandated retailer open data feeds.
 *
 * Aggregates price data from 7 major UK fuel retailers that publish
 * daily prices in a standard JSON format per CMA requirements.
 *
 * Country code: UK
 */

import { filterByDistance } from '../lib/geo.js';
import { json } from '../lib/response.js';
import { getStations, putStations } from '../lib/kv.js';
import { assignLogos } from '../lib/brandfetch.js';

// CMA-mandated retailer feeds
const RETAILER_FEEDS = [
  { name: 'Asda', url: 'https://storelocator.asda.com/fuel_prices_data.json' },
  { name: 'Shell', url: 'https://www.shell.co.uk/fuel-prices-data.html' },
  { name: 'Esso', url: 'https://fuelprices.esso.co.uk/latestdata.json' },
  { name: 'Morrisons', url: 'https://www.morrisons.com/fuel-prices/fuel.json' },
  { name: 'Sainsburys', url: 'https://api.sainsburys.co.uk/v1/exports/latest/fuel_prices_data.json' },
  { name: 'BP', url: 'https://www.bp.com/en_gb/united-kingdom/home/fuelprices/fuel_prices_data.json' },
  { name: 'Tesco', url: 'https://www.tesco.com/fuel_prices/fuel_prices_data.json' },
];

// Brand → website domain for Brandfetch logo resolution
const BRAND_DOMAINS = {
  'BP': 'bp.com',
  'Shell': 'shell.com',
  'Esso': 'esso.co.uk',
  'Tesco': 'tesco.com',
  "Sainsbury's": 'sainsburys.co.uk',
  'Asda': 'asda.com',
  'Morrisons': 'morrisons.com',
  'Texaco': 'texaco.com',
  'Murco': 'murco.co.uk',
  'Jet': 'jet.co.uk',
  'Gulf': 'gulfoil.com',
  'Applegreen': 'applegreenstores.com',
  'SGN': 'sgn.co.uk',
  'Harvest': 'harvest-energy.com',
  'Certas': 'certasenergy.co.uk',
};

// CMA standard fuel keys -> normalised keys
const FUEL_MAP = {
  'e10': 'unleaded',       // E10 (standard unleaded since 2021)
  'e5': 'super_unleaded',  // E5 (super / premium unleaded)
  'b7': 'diesel',          // B7 (standard diesel)
  'sdv': 'diesel',         // Super diesel variant (fallback if B7 missing)
};

// ─── Query handler (Tier A pattern) ────────────────────────────────
export async function handleQuery(url, env) {
  const lat = parseFloat(url.searchParams.get('lat'));
  const lng = parseFloat(url.searchParams.get('lng'));
  const radiusKm = parseFloat(url.searchParams.get('radius') || '15');

  const allStations = await getStations('UK', env);
  if (!allStations) return json({ error: 'Data not yet cached, try again later' }, 503);

  const filtered = filterByDistance(allStations, lat, lng, radiusKm);
  return json({ stations: filtered, count: filtered.length });
}

// ─── Refresh: fetch all retailer feeds, normalise, store in KV ─────
export async function refresh(env) {
  const results = await Promise.allSettled(
    RETAILER_FEEDS.map(async (feed) => {
      try {
        const res = await fetch(feed.url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; FuelSaver/1.0)',
            'Accept': 'application/json, text/html, */*',
          },
        });
        if (!res.ok) {
          console.warn(`[UK] ${feed.name} feed returned ${res.status}`);
          return [];
        }
        const data = await res.json();
        return parseCMAFeed(data, feed.name);
      } catch (e) {
        console.warn(`[UK] ${feed.name} feed failed:`, e.message);
        return [];
      }
    })
  );

  const stations = [];
  let feedsOk = 0;
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.length > 0) {
      stations.push(...r.value);
      feedsOk++;
    }
  }

  const logoCount = await assignLogos(stations, BRAND_DOMAINS, env, 'UK');

  await putStations('UK', stations, env);
  console.log(`[UK] Refreshed ${stations.length} stations from ${feedsOk} feeds, ${logoCount} brand logos`);
}

// ─── CMA standard format parser ─────────────────────────────────────
// All retailers use the same schema:
// { last_updated, stations: [{ site_id, brand, address, postcode,
//   location: { latitude, longitude }, prices: { E10: 138.9, B7: 157.9, ... } }] }
function parseCMAFeed(data, fallbackBrand) {
  const list = data?.stations || [];
  return list
    .map((s) => {
      const sLat = parseFloat(s.location?.latitude);
      const sLng = parseFloat(s.location?.longitude);
      if (isNaN(sLat) || isNaN(sLng)) return null;

      // Skip if outside UK/Ireland bounding box
      if (sLat < 49 || sLat > 61 || sLng < -11 || sLng > 2) return null;

      // Map CMA fuel keys (E10, E5, B7, SDV) to our keys
      const prices = {};
      for (const [rawKey, val] of Object.entries(s.prices || {})) {
        const normKey = FUEL_MAP[rawKey.toLowerCase()];
        if (!normKey) continue;
        const numVal = parseFloat(val);
        if (isNaN(numVal) || numVal <= 0 || numVal > 300) continue;
        // Don't overwrite if already set (e.g. B7 diesel takes priority over SDV)
        if (prices[normKey] == null) {
          prices[normKey] = numVal;
        }
      }

      if (Object.keys(prices).length === 0) return null;

      return {
        id: s.site_id || `${fallbackBrand}-${sLat}-${sLng}`,
        brand: s.brand || fallbackBrand,
        address: s.address || '',
        city: s.postcode || '',
        lat: sLat,
        lng: sLng,
        prices,
        updatedAt: data.last_updated || null,
      };
    })
    .filter(Boolean);
}
