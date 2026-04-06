/**
 * Finland — polttoaine.net scraper.
 *
 * Locations: POST polttoaine.net/ajax.php (act=map) → stations with coordinates.
 * Prices: GET polttoaine.net/{CityName} → HTML table with fuel prices.
 * Matched by station ID.
 *
 * Tier B: proxy + grid-cache pattern.
 * Country code: FI
 */

import { filterByDistance, gridCell } from '../lib/geo.js';
import { json } from '../lib/response.js';
import { getGridCache, putGridCache } from '../lib/kv.js';

const COUNTRY = 'FI';
const AJAX_URL = 'https://polttoaine.net/ajax.php';
const BASE_URL = 'https://polttoaine.net';

/* polttoaine.net "tunnus" code → brand name */
const TUNNUS_BRAND = {
  '1': 'Neste', '4': 'Neste', '5': 'Neste', '6': 'Neste', '12': 'Neste',
  '2': 'ABC',
  '7': 'SEO',
  '8': 'Shell', '14': 'Shell',
  '9': 'St1',
  '10': 'Teboil', '13': 'Teboil',
  '11': 'Ysi5',
};

/* Finnish cities with approximate coords for nearest-city lookup.
   URL names use underscore encoding for Finnish characters (ä→a_, ö→o_). */
const CITIES = [
  { u: 'Helsinki', lat: 60.17, lng: 24.94 },
  { u: 'Espoo', lat: 60.21, lng: 24.66 },
  { u: 'Vantaa', lat: 60.29, lng: 25.04 },
  { u: 'Tampere', lat: 61.50, lng: 23.79 },
  { u: 'Turku', lat: 60.45, lng: 22.27 },
  { u: 'Oulu', lat: 65.01, lng: 25.47 },
  { u: 'Jyva_skyla_', lat: 62.24, lng: 25.75 },
  { u: 'Lahti', lat: 60.98, lng: 25.66 },
  { u: 'Kuopio', lat: 62.89, lng: 27.68 },
  { u: 'Pori', lat: 61.49, lng: 21.80 },
  { u: 'Joensuu', lat: 62.60, lng: 29.76 },
  { u: 'Lappeenranta', lat: 61.06, lng: 28.19 },
  { u: 'Kotka', lat: 60.47, lng: 26.95 },
  { u: 'Vaasa', lat: 63.10, lng: 21.62 },
  { u: 'Kouvola', lat: 60.87, lng: 26.70 },
  { u: 'Seina_joki', lat: 62.79, lng: 22.84 },
  { u: 'Rovaniemi', lat: 66.50, lng: 25.72 },
  { u: 'Ha_meenlinna', lat: 61.00, lng: 24.46 },
  { u: 'Kajaani', lat: 64.23, lng: 27.73 },
  { u: 'Kokkola', lat: 63.84, lng: 23.13 },
  { u: 'Imatra', lat: 61.17, lng: 28.77 },
  { u: 'Rauma', lat: 61.13, lng: 21.51 },
  { u: 'Savonlinna', lat: 61.87, lng: 28.88 },
  { u: 'Salo', lat: 60.39, lng: 23.13 },
  { u: 'Nokia', lat: 61.48, lng: 23.50 },
  { u: 'Lohja', lat: 60.25, lng: 24.07 },
  { u: 'Kaarina', lat: 60.41, lng: 22.37 },
  { u: 'Kangasala', lat: 61.47, lng: 24.07 },
  { u: 'Kirkkonummi', lat: 60.12, lng: 24.44 },
  { u: 'Varkaus', lat: 62.31, lng: 27.87 },
  { u: 'Kemi', lat: 65.74, lng: 24.56 },
  { u: 'Raisio', lat: 60.49, lng: 22.17 },
  { u: 'Naantali', lat: 60.47, lng: 22.03 },
  { u: 'Tuusula', lat: 60.40, lng: 25.03 },
  { u: 'Ja_rvenpa_a_', lat: 60.47, lng: 25.09 },
  { u: 'Nurmija_rvi', lat: 60.47, lng: 24.81 },
  { u: 'Sipoo', lat: 60.38, lng: 25.27 },
  { u: 'Riihima_ki', lat: 60.74, lng: 24.77 },
  { u: 'Forssa', lat: 60.81, lng: 23.63 },
  { u: 'Hanko', lat: 59.83, lng: 22.95 },
  { u: 'Kuusamo', lat: 65.97, lng: 29.19 },
  { u: 'Ma_ntsa_la_', lat: 60.63, lng: 25.32 },
  { u: 'Pirkkala', lat: 61.46, lng: 23.65 },
  { u: 'Lempa_a_la_', lat: 61.31, lng: 23.75 },
  { u: 'Kempele', lat: 64.91, lng: 25.51 },
  { u: 'Loviisa', lat: 60.46, lng: 26.23 },
  { u: 'Vihti', lat: 60.42, lng: 24.33 },
  { u: 'Ylivieska', lat: 64.07, lng: 24.54 },
  { u: 'Liminka', lat: 64.81, lng: 25.42 },
  { u: 'Nastola', lat: 60.95, lng: 25.93 },
  { u: 'Alaja_rvi', lat: 63.00, lng: 23.82 },
  { u: 'Ja_msa_', lat: 61.86, lng: 25.19 },
  { u: 'Kontiolahti', lat: 62.77, lng: 29.85 },
  { u: 'Ha_meenkyro_', lat: 61.64, lng: 23.20 },
  { u: 'Muhos', lat: 64.81, lng: 26.00 },
  { u: 'Ii', lat: 65.32, lng: 25.37 },
  { u: 'Iitti', lat: 60.89, lng: 26.33 },
  { u: 'Ilmajoki', lat: 62.73, lng: 22.58 },
  { u: 'Parkano', lat: 62.01, lng: 23.03 },
  { u: 'Nakkila', lat: 61.37, lng: 21.95 },
  { u: 'Liperi', lat: 62.53, lng: 29.38 },
  { u: 'Oulainen', lat: 64.27, lng: 24.82 },
  { u: 'Keuruu', lat: 62.26, lng: 24.71 },
  { u: 'Raasepori', lat: 60.03, lng: 23.52 },
];

function nearestCities(lat, lng, n) {
  return CITIES
    .map((c) => ({ ...c, d: (lat - c.lat) ** 2 + (lng - c.lng) ** 2 }))
    .sort((a, b) => a.d - b.d)
    .slice(0, n);
}

/* ── Fetch station locations via AJAX ─────────────────────────── */

async function fetchLocations(lat, lng) {
  try {
    const res = await fetch(AJAX_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': `${BASE_URL}/`,
        'User-Agent': 'Mozilla/5.0 (compatible; FuelSaver/1.0)',
      },
      body: `act=map&lat=${lat}&lon=${lng}`,
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/* ── Fetch prices from a city page ────────────────────────────── */

async function fetchCityPrices(cityUrl) {
  try {
    const res = await fetch(`${BASE_URL}/${cityUrl}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FuelSaver/1.0)' },
    });
    if (!res.ok) return new Map();
    const html = await res.text();
    return parsePriceTable(html);
  } catch {
    return new Map();
  }
}

/**
 * Parse the polttoaine.net HTML price table.
 * Each data row:  <tr ...><td>...[<a href="...id=XXX">]...name...</td>
 *                 <td>date</td><td>95E10</td><td>98E</td><td>diesel</td></tr>
 * Returns Map<stationId, { e95, e98, diesel }>
 */
function parsePriceTable(html) {
  const prices = new Map();
  // Match rows that contain station data (have Hinnat cells)
  const rowRe = /<tr\s[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>[^<]*<\/td>\s*<td[^>]*class="Hinnat[^"]*"[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*class="Hinnat[^"]*"[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*class="Hinnat[^"]*"[^>]*>([\s\S]*?)<\/td>/g;

  let m;
  while ((m = rowRe.exec(html)) !== null) {
    const cellHtml = m[1];
    // Skip average row
    if (cellHtml.includes('Keskihinnat')) continue;

    // Extract station ID from map link
    const idMatch = cellHtml.match(/id=(\d+)/);
    if (!idMatch) continue;
    const id = idMatch[1];

    // Parse prices (strip HTML tags and * prefix)
    const p95 = parsePrice(m[2]);
    const p98 = parsePrice(m[3]);
    const di = parsePrice(m[4]);

    const obj = {};
    if (p95) obj.e95 = p95;
    if (p98) obj.e98 = p98;
    if (di) obj.diesel = di;
    if (Object.keys(obj).length) prices.set(id, obj);
  }
  return prices;
}

function parsePrice(html) {
  const text = html.replace(/<[^>]*>/g, '').replace(/\*/g, '').trim();
  const n = parseFloat(text);
  return n > 0 && n < 10 ? n : null;
}

/* ── Parse station name: "Brand, Area Address" ────────────────── */

function parseName(nimi) {
  const parts = (nimi || '').split(',');
  const brand = (parts[0] || '').trim();
  const rest = parts.slice(1).join(',').trim();
  // Rest is "Area Address" — split on first space group after area name
  const addrMatch = rest.match(/^(\S+)\s+(.+)$/);
  return {
    brand,
    city: addrMatch ? addrMatch[1] : rest,
    address: addrMatch ? addrMatch[2] : '',
  };
}

/* ── Main handler ─────────────────────────────────────────────── */

export async function handleQuery(url, env) {
  const lat = parseFloat(url.searchParams.get('lat'));
  const lng = parseFloat(url.searchParams.get('lng'));
  const radiusKm = parseFloat(url.searchParams.get('radius') || '15');

  const grid = gridCell(lat, lng);
  const cacheKey = `cache:${COUNTRY}:${grid.lat}:${grid.lng}`;

  const cached = await getGridCache(cacheKey, env);
  if (cached && cached.length) {
    const filtered = filterByDistance(cached, lat, lng, radiusKm);
    return json({ stations: filtered, count: filtered.length });
  }

  // Fetch locations + prices from nearest cities in parallel
  const cities = nearestCities(grid.lat, grid.lng, 4);
  const [locations, ...cityPricesArr] = await Promise.all([
    fetchLocations(grid.lat, grid.lng),
    ...cities.map((c) => fetchCityPrices(c.u)),
  ]);

  // Merge price maps
  const priceMap = new Map();
  for (const cp of cityPricesArr) {
    for (const [id, p] of cp) {
      priceMap.set(id, p);
    }
  }

  // Build station objects — only include stations with prices
  const stations = [];
  for (const s of locations) {
    const p = priceMap.get(s.id);
    if (!p) continue;

    const info = parseName(s.nimi);
    stations.push({
      id: `FI-pa-${s.id}`,
      brand: TUNNUS_BRAND[s.tunnus] || info.brand,
      name: s.nimi,
      address: info.address,
      city: info.city,
      lat: parseFloat(s.lat),
      lng: parseFloat(s.lon),
      country: COUNTRY,
      prices: p,
      updatedAt: null,
    });
  }

  if (stations.length) await putGridCache(cacheKey, stations, env, 600);

  const filtered = filterByDistance(stations, lat, lng, radiusKm);
  return json({ stations: filtered, count: filtered.length });
}
