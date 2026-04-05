import { filterByDistance, haversine, gridCell } from '../lib/geo.js';
import { json } from '../lib/response.js';
import { getStations, putStations } from '../lib/kv.js';

const COUNTRY = 'FR';
const API_URL =
  'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/exports/json';

const MAPBOX_CATEGORY_URL =
  'https://api.mapbox.com/search/searchbox/v1/category/gas_station';

const PRICE_FIELDS = {
  sp95_prix: 'SP95',
  sp98_prix: 'SP98',
  e10_prix: 'E10',
  gazole_prix: 'Gazole',
  e85_prix: 'E85',
  gplc_prix: 'GPLc',
};

// Normalize common French brand variants for consistency
const BRAND_NORMALIZE = {
  total: 'TotalEnergies',
  totalenergies: 'TotalEnergies',
  'total energies': 'TotalEnergies',
  'total access': 'TotalEnergies Access',
  'totalenergies access': 'TotalEnergies Access',
  shell: 'Shell',
  esso: 'Esso',
  'esso express': 'Esso Express',
  bp: 'BP',
  avia: 'AVIA',
  'intermarché': 'Intermarché',
  intermarche: 'Intermarché',
  'e.leclerc': 'E.Leclerc',
  leclerc: 'E.Leclerc',
  carrefour: 'Carrefour',
  'carrefour market': 'Carrefour Market',
  'carrefour contact': 'Carrefour Contact',
  auchan: 'Auchan',
  'super u': 'Super U',
  'système u': 'Système U',
  'systeme u': 'Système U',
  'u express': 'U Express',
  casino: 'Casino',
  netto: 'Netto',
  elan: 'Elan',
  agip: 'Agip',
  'q8': 'Q8',
  tamoil: 'Tamoil',
  dyneff: 'Dyneff',
  'carrefour express': 'Carrefour Express',
  'oil france': 'Oil!',
  'oil!': 'Oil!',
  'station total': 'TotalEnergies',
  'relais total': 'TotalEnergies',
  srd: 'SRD',
  'delek france': 'Delek',
  delek: 'Delek',
};

// Names that are NOT real brands — filter these out so they don't override real matches
const BRAND_BLACKLIST = new Set([
  'gonflage', 'station service', 'station essence', 'parking',
  'garage', 'lavage', 'aire de service', 'relais', 'station',
]);

// Station-specific brand overrides (keyed by French gov station ID)
const STATION_OVERRIDES = {
  '94700005': 'Esso', // 5 Avenue Léon Blum, Maisons-Alfort
};

// Stations to exclude — closed, non-existent, or bad data from French gov API
const STATION_BLACKLIST = new Set([
  '45250003', // TERRES DU MARCHAIS BARNAULT, Briare — doesn't exist
]);

function normalizeBrand(raw) {
  if (!raw) return null;
  const key = raw.toLowerCase().trim();
  // Skip non-brand names
  if (BRAND_BLACKLIST.has(key)) return null;
  // Exact match
  if (BRAND_NORMALIZE[key]) return BRAND_NORMALIZE[key];
  // Partial match: check if the name starts with or contains a known brand
  for (const [brand, canonical] of Object.entries(BRAND_NORMALIZE)) {
    if (key.startsWith(brand + ' ') || key.startsWith(brand + '-')) {
      return canonical;
    }
  }
  return raw.trim();
}

// ─── Normalize a single station from the French gov API ──────────────
function normalize(r) {
  const lat = r.geom?.lat;
  const lng = r.geom?.lon;
  if (lat == null || lng == null) return null;

  const prices = {};
  let updatedAt = null;
  for (const [field, key] of Object.entries(PRICE_FIELDS)) {
    const val = parseFloat(r[field]);
    if (!isNaN(val) && val > 0) {
      prices[key] = val;
      const maj = r[field.replace('_prix', '_maj')];
      if (maj && (!updatedAt || maj > updatedAt)) updatedAt = maj;
    }
  }
  if (Object.keys(prices).length === 0) return null;

  return {
    id: String(r.id || ''),
    brand: 'Station',
    address: r.adresse || '',
    city: r.ville || '',
    lat: parseFloat(lat),
    lng: parseFloat(lng),
    prices,
    updatedAt,
    is24h: r.horaires_automate_24_24 === 'Oui',
  };
}

// ─── Match brands from the stored brand lookup to stations ───────────
// Uses a spatial grid index so we only check nearby brands, not all 13k+.
function enrichWithStoredBrands(stations, brandLookup) {
  if (!brandLookup || !brandLookup.length) return stations;

  // Build spatial index: group brands into 0.01-degree cells (~1.1km)
  const grid = new Map();
  for (const b of brandLookup) {
    const key = `${Math.round(b.lat * 100)}:${Math.round(b.lng * 100)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(b);
  }

  return stations.map((s) => {
    const cellLat = Math.round(s.lat * 100);
    const cellLng = Math.round(s.lng * 100);

    // Check the station's cell and all 8 neighbors (covers ~3.3km radius)
    let bestBrand = null;
    let bestDist = 0.5; // 500m threshold
    for (let dLat = -1; dLat <= 1; dLat++) {
      for (let dLng = -1; dLng <= 1; dLng++) {
        const nearby = grid.get(`${cellLat + dLat}:${cellLng + dLng}`);
        if (!nearby) continue;
        for (const b of nearby) {
          const d = haversine(s.lat, s.lng, b.lat, b.lng);
          if (d < bestDist) {
            bestDist = d;
            bestBrand = b.brand;
          }
        }
      }
    }
    // Station-specific overrides take priority
    if (STATION_OVERRIDES[s.id]) return { ...s, brand: STATION_OVERRIDES[s.id] };
    return bestBrand ? { ...s, brand: bestBrand } : s;
  });
}

// ─── Cron: fetch all stations + enrich with stored brands ────────────
export async function refresh(env) {
  const res = await fetch(API_URL);
  if (!res.ok) throw new Error(`France API ${res.status}`);

  const raw = await res.json();
  let stations = raw.map(normalize).filter(Boolean)
    .filter((s) => !STATION_BLACKLIST.has(s.id));

  // Load pre-built brand database from KV (populated by buildBrands)
  const brandLookup = await env.FUEL_KV.get('brands:FR', { type: 'json' });
  if (brandLookup && brandLookup.length) {
    stations = enrichWithStoredBrands(stations, brandLookup);
    const matched = stations.filter((s) => s.brand !== 'Station').length;
    console.log(`[FR] Fetched ${raw.length}, normalized ${stations.length}, brand-matched ${matched}`);
  } else {
    console.log(`[FR] Fetched ${raw.length}, normalized ${stations.length} (no brand DB yet — run /api/fr/build-brands)`);
  }

  await putStations(COUNTRY, stations, env);
}

// ─── Query: just read from KV, filter, return ────────────────────────
export async function handleQuery(url, env) {
  const lat = parseFloat(url.searchParams.get('lat'));
  const lng = parseFloat(url.searchParams.get('lng'));
  const radiusKm = parseFloat(url.searchParams.get('radius') || '15');
  const allStations = await getStations(COUNTRY, env);
  if (!allStations) return json({ error: 'Data not yet cached, try again later' }, 503);

  const filtered = filterByDistance(allStations, lat, lng, radiusKm);
  return json({ stations: filtered, count: filtered.length });
}

// ─── One-time Mapbox brand crawl ─────────────────────────────────────
// Call GET /api/fr/build-brands to populate the brand database in KV.
// This queries Mapbox for every grid cell that has French stations,
// collecting {lat, lng, brand} for all fuel stations found.
export async function buildBrands(env) {
  const mapboxToken = env.MAPBOX_TOKEN;
  if (!mapboxToken) throw new Error('MAPBOX_TOKEN not configured');

  // Load all French stations to know which grid cells to query
  const allStations = await getStations(COUNTRY, env);
  if (!allStations || !allStations.length) {
    throw new Error('No French stations in KV. Run /cron first to fetch station data.');
  }

  // Group stations into 0.05-degree grid cells (~5.5km) for better
  // coverage in dense areas (Mapbox returns max 25 results per query)
  const cells = new Map();
  for (const s of allStations) {
    const lat = Math.round(s.lat * 20) / 20;
    const lng = Math.round(s.lng * 20) / 20;
    const key = `${lat}:${lng}`;
    if (!cells.has(key)) cells.set(key, { lat, lng });
  }

  console.log(`[FR] Brand crawl: ${cells.size} grid cells to query via Mapbox`);

  const allBrands = [];
  let queried = 0;
  let errors = 0;
  const cellList = [...cells.values()];
  const PARALLEL = 5;

  for (let i = 0; i < cellList.length; i += PARALLEL) {
    const batch = cellList.slice(i, i + PARALLEL);
    const results = await Promise.allSettled(
      batch.map(async (cell) => {
        const url = `${MAPBOX_CATEGORY_URL}?access_token=${mapboxToken}&proximity=${cell.lng},${cell.lat}&limit=25&country=FR&language=fr`;
        const res = await fetch(url);
        if (!res.ok) return [];
        const data = await res.json();
        return (data.features || [])
          .map((f) => {
            const brandArr = f.properties?.brand;
            const name = f.properties?.name;
            const coords = f.geometry?.coordinates;
            if (!coords) return null;
            // Prefer explicit brand field, fall back to station name
            const resolved = normalizeBrand(brandArr?.[0]) || normalizeBrand(name);
            if (!resolved) return null;
            return { lat: coords[1], lng: coords[0], brand: resolved };
          })
          .filter(Boolean);
      })
    );

    for (const r of results) {
      queried++;
      if (r.status === 'fulfilled') {
        allBrands.push(...r.value);
      } else {
        errors++;
      }
    }

    // Log progress every 50 cells
    if (queried % 50 === 0) {
      console.log(`[FR] Brand crawl progress: ${queried}/${cellList.length} cells, ${allBrands.length} brands so far`);
    }
  }

  // Deduplicate by coordinates (same station can appear from adjacent cells)
  const seen = new Set();
  const uniqueBrands = allBrands.filter((b) => {
    const key = `${b.lat.toFixed(5)}:${b.lng.toFixed(5)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Store brand lookup in KV (no expiration — rebuild manually when needed)
  await env.FUEL_KV.put('brands:FR', JSON.stringify(uniqueBrands));

  console.log(`[FR] Brand database built: ${uniqueBrands.length} unique stations from ${cells.size} cells (${errors} errors)`);

  return {
    cells_queried: cells.size,
    brands_found: uniqueBrands.length,
    errors,
  };
}

// ─── Foursquare supplementary brand crawl ────────────────────────────
// Call GET /api/fr/build-brands-fsq to enrich the brand database with
// Foursquare data. Merges into existing brands:FR, filling gaps that
// Mapbox missed. Foursquare returns up to 50 results per query.
const FSQ_SEARCH_URL = 'https://api.foursquare.com/v2/venues/search';
const FSQ_GAS_CATEGORY = '4bf58dd8d48988d113951735';

export async function buildBrandsFoursquare(env) {
  const clientId = env.FSQ_CLIENT_ID;
  const clientSecret = env.FSQ_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('FSQ_CLIENT_ID / FSQ_CLIENT_SECRET not configured');

  const allStations = await getStations(COUNTRY, env);
  if (!allStations || !allStations.length) {
    throw new Error('No French stations in KV. Run /cron first.');
  }

  // Load existing brand DB (from Mapbox crawl)
  const existingBrands = (await env.FUEL_KV.get('brands:FR', { type: 'json' })) || [];

  // Group stations into 0.05-degree grid cells
  const cells = new Map();
  for (const s of allStations) {
    const lat = Math.round(s.lat * 20) / 20;
    const lng = Math.round(s.lng * 20) / 20;
    const key = `${lat}:${lng}`;
    if (!cells.has(key)) cells.set(key, { lat, lng });
  }

  console.log(`[FR] Foursquare crawl: ${cells.size} cells`);

  const newBrands = [];
  let queried = 0;
  let errors = 0;
  const cellList = [...cells.values()];
  const PARALLEL = 5;

  for (let i = 0; i < cellList.length; i += PARALLEL) {
    const batch = cellList.slice(i, i + PARALLEL);
    const results = await Promise.allSettled(
      batch.map(async (cell) => {
        const params = new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          v: '20240101',
          ll: `${cell.lat},${cell.lng}`,
          radius: 5000,
          categoryId: FSQ_GAS_CATEGORY,
          limit: 50,
        });
        const res = await fetch(`${FSQ_SEARCH_URL}?${params}`);
        if (!res.ok) return [];
        const data = await res.json();
        return (data.response?.venues || [])
          .map((v) => {
            const lat = v.location?.lat;
            const lng = v.location?.lng;
            if (lat == null || lng == null) return null;
            const brand = normalizeBrand(v.name);
            if (!brand) return null;
            return { lat, lng, brand };
          })
          .filter(Boolean);
      })
    );

    for (const r of results) {
      queried++;
      if (r.status === 'fulfilled') {
        newBrands.push(...r.value);
      } else {
        errors++;
      }
    }

    if (queried % 50 === 0) {
      console.log(`[FR] Foursquare progress: ${queried}/${cellList.length} cells, ${newBrands.length} brands`);
    }
  }

  // Merge: existing Mapbox brands + new Foursquare brands, deduplicate
  const merged = [...existingBrands, ...newBrands];
  const seen = new Set();
  const uniqueBrands = merged.filter((b) => {
    const key = `${b.lat.toFixed(5)}:${b.lng.toFixed(5)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  await env.FUEL_KV.put('brands:FR', JSON.stringify(uniqueBrands));

  const added = uniqueBrands.length - existingBrands.length;
  console.log(`[FR] Foursquare enrichment: ${added} new brands added (total: ${uniqueBrands.length})`);

  return {
    cells_queried: cells.size,
    foursquare_found: newBrands.length,
    new_unique_added: added,
    total_brands: uniqueBrands.length,
    errors,
  };
}

// ─── Google Places supplementary brand crawl ─────────────────────────
// Call GET /api/fr/build-brands-google to fill remaining gaps using
// Google Places API (New). Targets only unmatched stations for efficiency.
const GOOGLE_NEARBY_URL = 'https://places.googleapis.com/v1/places:searchNearby';

export async function buildBrandsGoogle(env) {
  const apiKey = env.GOOGLE_PLACES_KEY;
  if (!apiKey) throw new Error('GOOGLE_PLACES_KEY not configured');

  const allStations = await getStations(COUNTRY, env);
  if (!allStations || !allStations.length) {
    throw new Error('No French stations in KV. Run /cron first.');
  }

  // Load existing brand DB
  const existingBrands = (await env.FUEL_KV.get('brands:FR', { type: 'json' })) || [];

  // Build spatial index of existing brands
  const brandGrid = new Map();
  for (const b of existingBrands) {
    const key = `${Math.round(b.lat * 100)}:${Math.round(b.lng * 100)}`;
    if (!brandGrid.has(key)) brandGrid.set(key, []);
    brandGrid.get(key).push(b);
  }

  // Find stations that are still unmatched (no brand within 500m)
  const unmatched = allStations.filter((s) => {
    const cellLat = Math.round(s.lat * 100);
    const cellLng = Math.round(s.lng * 100);
    for (let dLat = -1; dLat <= 1; dLat++) {
      for (let dLng = -1; dLng <= 1; dLng++) {
        const nearby = brandGrid.get(`${cellLat + dLat}:${cellLng + dLng}`);
        if (!nearby) continue;
        for (const b of nearby) {
          if (haversine(s.lat, s.lng, b.lat, b.lng) < 0.5) return false;
        }
      }
    }
    return true;
  });

  console.log(`[FR] Google Places crawl: ${unmatched.length} unmatched stations to query`);

  const newBrands = [];
  let queried = 0;
  let errors = 0;
  const PARALLEL = 5;

  for (let i = 0; i < unmatched.length; i += PARALLEL) {
    const batch = unmatched.slice(i, i + PARALLEL);
    const results = await Promise.allSettled(
      batch.map(async (station) => {
        const body = JSON.stringify({
          includedTypes: ['gas_station'],
          locationRestriction: {
            circle: {
              center: { latitude: station.lat, longitude: station.lng },
              radius: 500,
            },
          },
          maxResultCount: 5,
        });
        const res = await fetch(GOOGLE_NEARBY_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': 'places.displayName,places.location',
          },
          body,
        });
        if (!res.ok) return [];
        const data = await res.json();
        return (data.places || [])
          .map((p) => {
            const lat = p.location?.latitude;
            const lng = p.location?.longitude;
            const name = p.displayName?.text;
            if (lat == null || lng == null || !name) return null;
            const brand = normalizeBrand(name);
            if (!brand) return null;
            return { lat, lng, brand };
          })
          .filter(Boolean);
      })
    );

    for (const r of results) {
      queried++;
      if (r.status === 'fulfilled') {
        newBrands.push(...r.value);
      } else {
        errors++;
      }
    }

    if (queried % 100 === 0) {
      console.log(`[FR] Google progress: ${queried}/${unmatched.length} stations, ${newBrands.length} brands`);
    }
  }

  // Merge into existing brand DB
  const merged = [...existingBrands, ...newBrands];
  const seen = new Set();
  const uniqueBrands = merged.filter((b) => {
    const key = `${b.lat.toFixed(5)}:${b.lng.toFixed(5)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  await env.FUEL_KV.put('brands:FR', JSON.stringify(uniqueBrands));

  const added = uniqueBrands.length - existingBrands.length;
  console.log(`[FR] Google enrichment: ${added} new brands added (total: ${uniqueBrands.length})`);

  return {
    unmatched_stations: unmatched.length,
    google_found: newBrands.length,
    new_unique_added: added,
    total_brands: uniqueBrands.length,
    errors,
  };
}
