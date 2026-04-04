/**
 * Thailand — PTT SOAP API + Bangchak REST API (brand-specific prices)
 *           + OpenStreetMap (stations).
 *
 * Tier A: bulk-cached national prices refreshed via cron,
 *         station locations from OSM Overpass (grid-cached).
 *
 * Different brands have different prices. We fetch PTT and Bangchak
 * prices separately and assign based on station brand.
 */

import { filterByDistance, gridCell } from '../lib/geo.js';
import { json } from '../lib/response.js';
import { getGridCache, putGridCache } from '../lib/kv.js';
import { queryOverpass } from '../lib/overpass.js';

const COUNTRY = 'TH';

// ── Price APIs ─────────────────────────────────────────────────────

const BANGCHAK_API = 'https://oil-price.bangchak.co.th/ApiOilPrice2/en';
const PTT_SOAP_URL = 'https://orapiweb.pttor.com/oilservice/OilPrice.asmx';

// Map Bangchak OilName → fuel type ID
const BANGCHAK_FUEL_MAP = {
  'gasohol 95 s evo': 'gasohol95',
  'gasohol 91 s evo': 'gasohol91',
  'gasohol e20 s evo': 'e20',
  'hi premium diesel s': 'diesel_premium',
  'hi diesel s': 'diesel',
  'hi premium 97 gasohol 95': 'gasohol95_premium',
  'gasohol e85 s evo': 'e85',
};

// Map PTT product name → fuel type ID
const PTT_FUEL_MAP = {
  'gasohol 95': 'gasohol95',
  'gasohol 91': 'gasohol91',
  'gasohol e20': 'e20',
  'premium diesel': 'diesel_premium',
  'diesel': 'diesel',
  'super power gsh95': 'gasohol95_premium',
  'gasohol e85': 'e85',
  'gasoline 95': 'gasoline95',
  'diesel b20': 'diesel_b20',
};

// ── Brand mapping ──────────────────────────────────────────────────

const BRAND_MAP = {
  ptt: 'PTT', 'ป.ต.ท.': 'PTT', 'ปตท.': 'PTT', 'ปตท': 'PTT',
  'ptt station': 'PTT', or: 'PTT',
  bangchak: 'Bangchak', 'บางจาก': 'Bangchak',
  bangjak: 'Bangchak', // OSM alternate spelling
  shell: 'Shell', 'เชลล์': 'Shell',
  esso: 'Esso', 'เอสโซ่': 'Esso',
  caltex: 'Caltex', 'คาลเท็กซ์': 'Caltex',
  pt: 'PT', susco: 'Susco', 'ซัสโก้': 'Susco',
  tela: 'Tela',
  'เวิลด์แก๊ส': 'World Gas',
};

// Which brand group each brand belongs to for pricing
const BRAND_PRICE_GROUP = {
  'PTT': 'ptt',
  'Bangchak': 'bangchak',
  // All others get 'default' (average of PTT & Bangchak)
};

// ── Fetch PTT prices via SOAP ──────────────────────────────────────

async function fetchPttPrices() {
  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <CurrentOilPrice xmlns="http://www.pttor.com">
      <Language>en</Language>
    </CurrentOilPrice>
  </soap:Body>
</soap:Envelope>`;

  const res = await fetch(PTT_SOAP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': 'https://orapiweb.pttor.com/CurrentOilPrice',
    },
    body: soapBody,
  });
  if (!res.ok) return null;

  const xml = await res.text();
  const prices = {};

  // Parse XML — extract <PRODUCT> and <PRICE> pairs
  const fuelBlocks = xml.split('&lt;FUEL&gt;').slice(1);
  for (const block of fuelBlocks) {
    const productMatch = block.match(/&lt;PRODUCT&gt;(.+?)&lt;\/PRODUCT&gt;/);
    const priceMatch = block.match(/&lt;PRICE&gt;(.+?)&lt;\/PRICE&gt;/);
    if (productMatch && priceMatch) {
      const product = productMatch[1].toLowerCase().trim();
      const price = parseFloat(priceMatch[1]);
      const fuelId = PTT_FUEL_MAP[product];
      if (fuelId && !isNaN(price)) {
        prices[fuelId] = { price };
      }
    }
  }

  return Object.keys(prices).length > 0 ? prices : null;
}

// ── Fetch Bangchak prices via REST ─────────────────────────────────

async function fetchBangchakPrices() {
  const res = await fetch(BANGCHAK_API);
  if (!res.ok) return null;

  const data = await res.json();
  const entry = Array.isArray(data) ? data[0] : data;
  if (!entry || !entry.OilList) return null;

  const oilList = typeof entry.OilList === 'string' ? JSON.parse(entry.OilList) : entry.OilList;
  const prices = {};
  for (const item of oilList) {
    const name = (item.OilName || '').toLowerCase().trim();
    const fuelId = BANGCHAK_FUEL_MAP[name];
    if (fuelId && item.PriceToday != null) {
      prices[fuelId] = { price: parseFloat(item.PriceToday) };
    }
  }
  return Object.keys(prices).length > 0 ? prices : null;
}

// ── Station mapping ────────────────────────────────────────────────

function mapElements(elements) {
  return elements.map((el) => {
    const elLat = el.lat || el.center?.lat;
    const elLng = el.lon || el.center?.lon;
    if (!elLat || !elLng) return null;

    const tags = el.tags || {};
    const rawBrand = (tags.brand || tags.operator || tags.name || 'Station').trim();
    const brand = BRAND_MAP[rawBrand.toLowerCase()] || BRAND_MAP[rawBrand] || rawBrand;

    return {
      id: `TH-${el.id}`,
      brand,
      name: tags.name || brand,
      address: [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' '),
      city: tags['addr:city'] || tags['addr:suburb'] || '',
      lat: elLat,
      lng: elLng,
      country: COUNTRY,
      prices: {},    // prices applied at query time, not cached
      updatedAt: null,
    };
  }).filter(Boolean);
}

/** Apply brand-specific prices to stations at query time. */
function applyPrices(stations, brandPrices) {
  return stations.map((s) => {
    const group = BRAND_PRICE_GROUP[s.brand] || 'default';
    const prices = brandPrices[group] || brandPrices.default || {};
    return { ...s, prices };
  });
}

// ── Refresh (cron) ─────────────────────────────────────────────────

export async function refresh(env) {
  try {
    const [pttPrices, bangchakPrices] = await Promise.all([
      fetchPttPrices(),
      fetchBangchakPrices(),
    ]);

    // Build brand-keyed price store
    const store = {};

    if (pttPrices) store.ptt = pttPrices;
    if (bangchakPrices) store.bangchak = bangchakPrices;

    // Default = average of PTT and Bangchak for each fuel type
    if (pttPrices && bangchakPrices) {
      const allFuelIds = new Set([...Object.keys(pttPrices), ...Object.keys(bangchakPrices)]);
      store.default = {};
      for (const fuelId of allFuelIds) {
        const p1 = pttPrices[fuelId]?.price;
        const p2 = bangchakPrices[fuelId]?.price;
        if (p1 != null && p2 != null) {
          store.default[fuelId] = { price: Math.round((p1 + p2) / 2 * 100) / 100 };
        } else {
          store.default[fuelId] = { price: p1 || p2 };
        }
      }
    } else {
      store.default = bangchakPrices || pttPrices || {};
    }

    await env.FUEL_KV.put('prices:TH', JSON.stringify(store));
    console.log('[TH] Refreshed brand prices:', Object.keys(store));
  } catch (e) {
    console.error('[TH] Price refresh failed:', e);
  }
}

// ── Query handler ──────────────────────────────────────────────────

export async function handleQuery(url, env) {
  const lat = parseFloat(url.searchParams.get('lat'));
  const lng = parseFloat(url.searchParams.get('lng'));
  const radiusKm = parseFloat(url.searchParams.get('radius') || '15');

  const brandPrices = await env.FUEL_KV.get('prices:TH', { type: 'json' }) || {};

  const grid = gridCell(lat, lng);
  const cacheKey = `cache:${COUNTRY}:${grid.lat}:${grid.lng}`;

  let stations = await getGridCache(cacheKey, env);
  if (!stations) {
    const radiusM = Math.min(radiusKm * 1000, 25000);
    const elements = await queryOverpass(grid.lat, grid.lng, radiusM);
    stations = mapElements(elements);
    await putGridCache(cacheKey, stations, env, 3600);
  }

  // Apply brand prices at query time (not baked into cache)
  const priced = applyPrices(stations, brandPrices);
  const filtered = filterByDistance(priced, lat, lng, radiusKm);
  return json({ stations: filtered, count: filtered.length });
}
