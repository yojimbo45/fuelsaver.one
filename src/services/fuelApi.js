/**
 * Fuel price API service — fetches station-level data from official sources.
 *
 * France:       data.economie.gouv.fr (open data, no key needed)
 * Germany:      Tankerkönig (requires free API key via VITE_TANKERKOENIG_KEY)
 * Croatia:      Tankerkönig (same API, coordinate-based)
 * Luxembourg:   Tankerkönig (same API, coordinate-based)
 * Portugal:     Tankerkönig (same API, coordinate-based)
 * Slovenia:     Tankerkönig (same API, coordinate-based)
 * Spain:        Ministerio REST API (open, no key)
 * Italy:        MIMIT open CSV (demo — needs backend proxy)
 * UK:           GOV.UK Fuel Finder (demo — needs backend proxy)
 * USA:          Demo data (no free public station-level API)
 * Canada:       Demo data (no free public station-level API)
 * Austria:      E-Control Spritpreisrechner (open, no key needed)
 * South Korea:  Opinet / KNOC (requires free API key via VITE_OPINET_KEY)
 * Chile:        CNE (open, no key needed)
 * Australia:    FuelCheck NSW (requires free API key via VITE_FUELCHECK_NSW_KEY)
 * Mexico:       CRE via datos.gob.mx (open, no key needed)
 * Brazil:       ANP weekly CSV (demo — needs backend proxy)
 * Argentina:    Secretaría de Energía via datos.gob.ar (open, no key needed)
 *
 * This module returns a unified station schema regardless of country.
 */

// ─── Unified station schema ────────────────────────────────────────────
// {
//   id: string,
//   brand: string,
//   address: string,
//   city: string,
//   lat: number,
//   lng: number,
//   prices: { [fuelType]: number },        // price in local unit (€/L or p/L)
//   updatedAt: string | null,               // ISO or readable date
//   distance?: number,                       // km from search center
// }

import { haversineDistance } from '../utils/geo';

// ─── France ────────────────────────────────────────────────────────────
async function fetchFrance(lat, lng, radiusKm, fuelType) {
  // The open-data API supports geo filtering via geofilter.distance
  const url = new URL(
    'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records'
  );
  url.searchParams.set('limit', '100');
  url.searchParams.set(
    'where',
    `distance(geom, geom'POINT(${lng} ${lat})', ${radiusKm}km)`
  );
  url.searchParams.set('order_by', `distance(geom, geom'POINT(${lng} ${lat})')`);

  // Fetch gov prices + OSM station data in parallel
  const [govRes, osmStations] = await Promise.all([
    fetch(url),
    fetchOSMStations(lat, lng, radiusKm),
  ]);

  if (!govRes.ok) throw new Error(`France API error: ${govRes.status}`);
  const json = await govRes.json();
  console.log('[FuelAPI] France raw response:', json);

  return (json.results || []).map((r) => {
    const prices = {};
    const mapping = {
      SP95: 'sp95_prix',
      SP98: 'sp98_prix',
      E10: 'e10_prix',
      Gazole: 'gazole_prix',
      E85: 'e85_prix',
      GPLc: 'gplc_prix',
    };
    for (const [key, col] of Object.entries(mapping)) {
      if (r[col] != null) prices[key] = r[col];
    }

    const stationLat = r.geom?.lat;
    const stationLng = r.geom?.lon;
    if (stationLat == null || stationLng == null) return null;

    // Match OSM station for brand + extra info
    const osm = matchOSMStation(osmStations, stationLat, stationLng);
    const brand = osm?.brand || 'Station';

    // Services list
    const services = Array.isArray(r.services_service) ? r.services_service : [];

    // 24/7 status
    const is24h = r.horaires_automate_24_24 === 'Oui';

    // Out-of-stock fuels (temporary + definitive)
    const outOfStock = [
      ...(r.carburants_rupture_definitive ? r.carburants_rupture_definitive.split(';').map(s => s.trim()).filter(Boolean) : []),
      ...(r.carburants_rupture_temporaire ? r.carburants_rupture_temporaire.split(';').map(s => s.trim()).filter(Boolean) : []),
    ];

    return {
      id: `FR-${r.id}`,
      brand,
      address: r.adresse || '',
      city: r.ville || '',
      lat: stationLat,
      lng: stationLng,
      prices,
      updatedAt: r[`${fuelType.toLowerCase()}_maj`] || r.gazole_maj || null,
      distance: haversineDistance(lat, lng, stationLat, stationLng),
      services,
      is24h,
      outOfStock,
      openingHours: osm?.opening_hours || null,
      phone: osm?.phone || null,
      website: osm?.website || null,
      payment: osm?.payment || [],
    };
  }).filter(Boolean);
}

// Fetch fuel station info from OpenStreetMap via Overpass API
async function fetchOSMStations(lat, lng, radiusKm) {
  try {
    const radiusM = Math.min(radiusKm * 1000, 50000);
    const query = `[out:json][timeout:10];(node[amenity=fuel](around:${radiusM},${lat},${lng});way[amenity=fuel](around:${radiusM},${lat},${lng}););out center 200;`;
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: 'data=' + encodeURIComponent(query),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    if (!res.ok) return [];
    const json = await res.json();
    return (json.elements || []).map((e) => {
      const t = e.tags || {};
      // Collect payment methods
      const payment = Object.keys(t)
        .filter((k) => k.startsWith('payment:') && t[k] === 'yes')
        .map((k) => k.replace('payment:', ''));
      return {
        brand: t.brand || t.operator || t.name || null,
        lat: e.lat ?? e.center?.lat,
        lng: e.lon ?? e.center?.lon,
        opening_hours: t.opening_hours || null,
        phone: t.phone || t['contact:phone'] || null,
        website: t.website || t['contact:website'] || null,
        payment,
        carWash: t.car_wash === 'yes',
        compressedAir: t.compressed_air === 'yes',
        shop: t.shop != null,
      };
    }).filter((b) => b.lat != null);
  } catch (e) {
    console.warn('[FuelAPI] OSM fetch failed:', e.message);
    return [];
  }
}

// Find the closest OSM station within 150m and return all its data
function matchOSMStation(osmStations, stationLat, stationLng) {
  let best = null;
  let bestDist = 0.15; // 150m in km
  for (const b of osmStations) {
    const d = haversineDistance(stationLat, stationLng, b.lat, b.lng);
    if (d < bestDist) {
      bestDist = d;
      best = b;
    }
  }
  return best;
}

// ─── Tankerkönig shared fetcher ───────────────────────────────────────
// Coordinate-based API covering DE, HR, LU, PT, SI and more.
function createTankerkoenigFetcher(countryCode, defaultBrand) {
  return async function (lat, lng, radiusKm, _fuelType) {
    const apiKey = import.meta.env.VITE_TANKERKOENIG_KEY;
    if (!apiKey) {
      console.warn('Tankerkönig API key not set (VITE_TANKERKOENIG_KEY). Using demo data.');
      return generateDemoStations(lat, lng, radiusKm, countryCode);
    }

    const rad = Math.min(radiusKm, 25); // API max 25 km
    const url = `https://creativecommons.tankerkoenig.de/json/list.php?lat=${lat}&lng=${lng}&rad=${rad}&sort=dist&type=all&apikey=${apiKey}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Tankerkönig error: ${res.status}`);
    const json = await res.json();

    if (!json.ok) throw new Error(json.message || 'Tankerkönig error');
    console.log(`[FuelAPI] ${countryCode} (Tankerkönig) raw response:`, json);

    return (json.stations || []).map((s) => ({
      id: `${countryCode}-${s.id}`,
      brand: s.brand || defaultBrand,
      address: `${s.street || ''} ${s.houseNumber || ''}`.trim(),
      city: `${s.postCode || ''} ${s.place || ''}`.trim(),
      lat: s.lat,
      lng: s.lng,
      prices: {
        ...(s.e5 != null && { e5: s.e5 }),
        ...(s.e10 != null && { e10: s.e10 }),
        ...(s.diesel != null && { diesel: s.diesel }),
      },
      updatedAt: null,
      distance: s.dist,
      isOpen: s.isOpen ?? null,
      is24h: s.wholeDay === true,
      openingHours: Array.isArray(s.openingTimes)
        ? s.openingTimes.map((t) => `${t.text}: ${t.start}–${t.end}`).join(', ')
        : null,
    }));
  };
}

const fetchGermany = createTankerkoenigFetcher('DE', 'Tankstelle');
const fetchCroatia = createTankerkoenigFetcher('HR', 'Benzinska');
const fetchLuxembourg = createTankerkoenigFetcher('LU', 'Tankstelle');
const fetchPortugal = createTankerkoenigFetcher('PT', 'Posto');
const fetchSlovenia = createTankerkoenigFetcher('SI', 'Bencinska');

// ─── Spain ─────────────────────────────────────────────────────────────
async function fetchSpain(lat, lng, radiusKm, _fuelType) {
  // The Spanish ministry API returns ALL stations. We filter client-side.
  const url =
    'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/';

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Spain API error: ${res.status}`);
  const json = await res.json();
  console.log('[FuelAPI] Spain raw response (total stations):', (json.ListaEESSPrecio || []).length, 'sample:', (json.ListaEESSPrecio || [])[0]);

  const stations = (json.ListaEESSPrecio || [])
    .map((s) => {
      const sLat = parseFloat((s['Latitud'] || '').replace(',', '.'));
      const sLng = parseFloat((s['Longitud (WGS84)'] || s['Longitud'] || '').replace(',', '.'));
      if (isNaN(sLat) || isNaN(sLng)) return null;

      const dist = haversineDistance(lat, lng, sLat, sLng);
      if (dist > radiusKm) return null;

      const parsePrice = (v) => {
        if (!v) return null;
        const n = parseFloat(v.replace(',', '.'));
        return isNaN(n) ? null : n;
      };

      const prices = {};
      const g95 = parsePrice(s['Precio Gasolina 95 E5']);
      const g98 = parsePrice(s['Precio Gasolina 98 E5']);
      const gasA = parsePrice(s['Precio Gasoleo A']);
      const glp = parsePrice(s['Precio Gases licuados del petróleo']);
      if (g95) prices.gasolina95 = g95;
      if (g98) prices.gasolina98 = g98;
      if (gasA) prices.gasoleo = gasA;
      if (glp) prices.glp = glp;

      return {
        id: `ES-${s['IDEESS']}`,
        brand: s['Rótulo'] || 'Gasolinera',
        address: s['Dirección'] || '',
        city: s['Municipio'] || '',
        lat: sLat,
        lng: sLng,
        prices,
        updatedAt: null,
        distance: dist,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 100);

  return stations;
}

// ─── Italy / UK / USA / Canada — demo fallback ───────────────────────
// These countries require backend proxying or have no free public API.
// For now we generate demo data; you'll wire up a real backend later.
async function fetchItaly(lat, lng, radiusKm) {
  return generateDemoStations(lat, lng, radiusKm, 'IT');
}

async function fetchUK(lat, lng, radiusKm) {
  return generateDemoStations(lat, lng, radiusKm, 'UK');
}

async function fetchUSA(lat, lng, radiusKm) {
  return generateDemoStations(lat, lng, radiusKm, 'US');
}

async function fetchCanada(lat, lng, radiusKm) {
  return generateDemoStations(lat, lng, radiusKm, 'CA');
}

// ─── Austria (E-Control) ──────────────────────────────────────────────
async function fetchAustria(lat, lng, radiusKm, fuelType) {
  // E-Control API: no key needed. fuelType must be one of: SUP, GOE, GAS
  const validTypes = ['SUP', 'GOE', 'GAS'];
  const ft = validTypes.includes(fuelType) ? fuelType : 'SUP';

  const url = new URL('https://api.e-control.at/sprit/1.0/search/gas-stations/by-address');
  url.searchParams.set('latitude', lat);
  url.searchParams.set('longitude', lng);
  url.searchParams.set('fuelType', ft);
  url.searchParams.set('includeClosed', 'false');

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Austria API error: ${res.status}`);
  const json = await res.json();
  console.log('[FuelAPI] Austria raw response:', json);

  return (json || []).map((s) => {
    const sLat = s.location?.latitude;
    const sLng = s.location?.longitude;
    if (sLat == null || sLng == null) return null;

    const prices = {};
    for (const p of s.prices || []) {
      if (p.fuelType && p.amount != null) {
        prices[p.fuelType] = p.amount;
      }
    }

    return {
      id: `AT-${s.id}`,
      brand: s.name || 'Tankstelle',
      address: s.location?.address || '',
      city: `${s.location?.postalCode || ''} ${s.location?.city || ''}`.trim(),
      lat: sLat,
      lng: sLng,
      prices,
      updatedAt: null,
      distance: haversineDistance(lat, lng, sLat, sLng),
    };
  }).filter(Boolean)
    .filter((s) => s.distance <= radiusKm)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 100);
}

// ─── South Korea (Opinet) ─────────────────────────────────────────────
async function fetchSouthKorea(lat, lng, radiusKm, _fuelType) {
  const apiKey = import.meta.env.VITE_OPINET_KEY;
  if (!apiKey) {
    console.warn('Opinet API key not set (VITE_OPINET_KEY). Using demo data.');
    return generateDemoStations(lat, lng, radiusKm, 'KR');
  }

  // Opinet aroundAll: returns stations within a radius (max 5000m)
  const radiusM = Math.min(radiusKm * 1000, 5000);
  const url = new URL('https://www.opinet.co.kr/api/aroundAll.do');
  url.searchParams.set('code', apiKey);
  url.searchParams.set('x', lng);
  url.searchParams.set('y', lat);
  url.searchParams.set('radius', radiusM);
  url.searchParams.set('sort', '2'); // sort by distance
  url.searchParams.set('prodcd', 'B027'); // gasoline by default
  url.searchParams.set('out', 'json');

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Opinet API error: ${res.status}`);
  const json = await res.json();
  console.log('[FuelAPI] South Korea raw response:', json);

  const list = json?.RESULT?.OIL || [];
  return list.map((s) => {
    const prices = {};
    if (s.PRICE != null) prices[s.PRODCD || 'B027'] = s.PRICE;

    return {
      id: `KR-${s.UNI_ID}`,
      brand: s.POLL_DIV_CO || 'Station',
      address: s.NEW_ADR || s.VAN_ADR || '',
      city: '',
      lat: parseFloat(s.GIS_Y_COOR),
      lng: parseFloat(s.GIS_X_COOR),
      prices,
      updatedAt: null,
      distance: s.DISTANCE ? s.DISTANCE / 1000 : haversineDistance(lat, lng, parseFloat(s.GIS_Y_COOR), parseFloat(s.GIS_X_COOR)),
    };
  }).filter((s) => !isNaN(s.lat) && !isNaN(s.lng))
    .slice(0, 100);
}

// ─── Chile (CNE) ──────────────────────────────────────────────────────
async function fetchChile(lat, lng, radiusKm, _fuelType) {
  // CNE publishes fuel prices. We fetch and filter by distance.
  const url = 'https://api.cne.cl/v3/combustibles/vehicular/estaciones';

  let json;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Chile API error: ${res.status}`);
    json = await res.json();
  } catch (e) {
    console.warn('Chile CNE API unavailable, using demo data:', e.message);
    return generateDemoStations(lat, lng, radiusKm, 'CL');
  }
  console.log('[FuelAPI] Chile raw response (total):', (json?.data || json || []).length);

  const list = json?.data || json || [];
  return list
    .map((s) => {
      const sLat = parseFloat(s.latitud || s.lat);
      const sLng = parseFloat(s.longitud || s.lng || s.lon);
      if (isNaN(sLat) || isNaN(sLng)) return null;

      const dist = haversineDistance(lat, lng, sLat, sLng);
      if (dist > radiusKm) return null;

      const prices = {};
      if (s.gasolina_93 != null) prices.gasolina93 = parseFloat(s.gasolina_93);
      if (s.gasolina_95 != null) prices.gasolina95 = parseFloat(s.gasolina_95);
      if (s.gasolina_97 != null) prices.gasolina97 = parseFloat(s.gasolina_97);
      if (s.diesel != null || s.petroleo_diesel != null) prices.diesel = parseFloat(s.diesel || s.petroleo_diesel);
      if (s.glp != null || s.glp_vehicular != null) prices.glp = parseFloat(s.glp || s.glp_vehicular);

      return {
        id: `CL-${s.id || s.id_estacion || Math.random().toString(36).slice(2)}`,
        brand: s.distribuidor || s.nombre_distribuidor || 'Estaci\u00F3n',
        address: s.direccion_calle || s.direccion || '',
        city: s.comuna || s.nombre_comuna || '',
        lat: sLat,
        lng: sLng,
        prices,
        updatedAt: s.fecha_actualizacion || null,
        distance: dist,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 100);
}

// ─── Australia NSW (FuelCheck) ────────────────────────────────────────
async function fetchAustralia(lat, lng, radiusKm, fuelType) {
  const apiKey = import.meta.env.VITE_FUELCHECK_NSW_KEY;
  if (!apiKey) {
    console.warn('FuelCheck NSW API key not set (VITE_FUELCHECK_NSW_KEY). Using demo data.');
    return generateDemoStations(lat, lng, radiusKm, 'AU');
  }

  const url = 'https://api.onegov.nsw.gov.au/FuelCheckApp/v2/fuel/prices/nearby';
  const body = {
    fuelType: fuelType || 'E10',
    latitude: lat,
    longitude: lng,
    radius: Math.min(radiusKm, 50),
    sortBy: 'distance',
    sortAscending: true,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Basic ' + btoa(apiKey + ':' + (import.meta.env.VITE_FUELCHECK_NSW_SECRET || '')),
      'apikey': apiKey,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`FuelCheck NSW error: ${res.status}`);
  const json = await res.json();
  console.log('[FuelAPI] Australia NSW raw response:', json);

  const list = json?.prices || json?.stations || json || [];
  return list.map((s) => {
    const sLat = s.location?.latitude ?? s.latitude ?? s.lat;
    const sLng = s.location?.longitude ?? s.longitude ?? s.lng;
    if (sLat == null || sLng == null) return null;

    const prices = {};
    if (s.price != null) prices[s.fuelType || fuelType || 'E10'] = s.price;
    if (s.prices) {
      for (const p of Array.isArray(s.prices) ? s.prices : []) {
        if (p.fuelType && p.price != null) prices[p.fuelType] = p.price;
      }
    }

    return {
      id: `AU-${s.stationCode || s.serviceStationId || s.id || Math.random().toString(36).slice(2)}`,
      brand: s.brand || s.stationName || 'Station',
      address: s.address || '',
      city: s.suburb || s.location?.suburb || '',
      lat: parseFloat(sLat),
      lng: parseFloat(sLng),
      prices,
      updatedAt: s.lastupdated || s.priceUpdatedDate || null,
      distance: haversineDistance(lat, lng, parseFloat(sLat), parseFloat(sLng)),
    };
  }).filter(Boolean)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 100);
}

// ─── Mexico (CRE via datos.gob.mx) ───────────────────────────────────
async function fetchMexico(lat, lng, radiusKm, _fuelType) {
  // datos.gob.mx publishes daily station-level prices as open data
  const url = 'https://api.datos.gob.mx/v1/precios.gasolinas.gasolinerias';

  let json;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Mexico API error: ${res.status}`);
    json = await res.json();
  } catch (e) {
    console.warn('Mexico API unavailable, using demo data:', e.message);
    return generateDemoStations(lat, lng, radiusKm, 'MX');
  }
  console.log('[FuelAPI] Mexico raw response (total):', (json?.results || []).length);

  const list = json?.results || [];
  return list
    .map((s) => {
      const sLat = parseFloat(s.latitud || s.y);
      const sLng = parseFloat(s.longitud || s.x);
      if (isNaN(sLat) || isNaN(sLng)) return null;

      const dist = haversineDistance(lat, lng, sLat, sLng);
      if (dist > radiusKm) return null;

      const prices = {};
      if (s.precio_regular != null || s.regular != null) prices.regular = parseFloat(s.precio_regular || s.regular);
      if (s.precio_premium != null || s.premium != null) prices.premium = parseFloat(s.precio_premium || s.premium);
      if (s.precio_diesel != null || s.diesel != null) prices.diesel = parseFloat(s.precio_diesel || s.diesel);

      return {
        id: `MX-${s.place_id || s._id || Math.random().toString(36).slice(2)}`,
        brand: s.razonsocial || s.permisionario || 'Gasolinera',
        address: s.direccion || s.calle || '',
        city: s.municipio || '',
        lat: sLat,
        lng: sLng,
        prices,
        updatedAt: s.fecha || null,
        distance: dist,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 100);
}

// ─── Brazil (ANP via Cloudflare Worker) ───────────────────────────────
async function fetchBrazil(lat, lng, radiusKm, _fuelType) {
  const workerUrl = import.meta.env.VITE_BRAZIL_WORKER_URL;
  if (!workerUrl) {
    console.warn('Brazil worker URL not set (VITE_BRAZIL_WORKER_URL). Using demo data.');
    return generateDemoStations(lat, lng, radiusKm, 'BR');
  }

  const url = `${workerUrl}/api/brazil?lat=${lat}&lng=${lng}&radius=${radiusKm}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Brazil worker error: ${res.status}`);
    const json = await res.json();
    console.log('[FuelAPI] Brazil raw response:', json);
    return json.stations || [];
  } catch (e) {
    console.warn('Brazil worker unavailable, using demo data:', e.message);
    return generateDemoStations(lat, lng, radiusKm, 'BR');
  }
}

// ─── Argentina (Secretar\u00EDa de Energ\u00EDa) ──────────────────────────────
async function fetchArgentina(lat, lng, radiusKm, _fuelType) {
  const url = 'https://datos.gob.ar/api/3/action/datastore_search?resource_id=energia-precios-surtidor&limit=1000';

  let json;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Argentina API error: ${res.status}`);
    json = await res.json();
  } catch (e) {
    console.warn('Argentina API unavailable, using demo data:', e.message);
    return generateDemoStations(lat, lng, radiusKm, 'AR');
  }
  console.log('[FuelAPI] Argentina raw response:', json);

  const list = json?.result?.records || [];
  return list
    .map((s) => {
      const sLat = parseFloat(s.latitud || s.lat);
      const sLng = parseFloat(s.longitud || s.lng || s.lon);
      if (isNaN(sLat) || isNaN(sLng)) return null;

      const dist = haversineDistance(lat, lng, sLat, sLng);
      if (dist > radiusKm) return null;

      const prices = {};
      if (s.nafta_super != null) prices.nafta_super = parseFloat(s.nafta_super);
      if (s.nafta_premium != null) prices.nafta_premium = parseFloat(s.nafta_premium);
      if (s.diesel != null || s.gasoil != null) prices.diesel = parseFloat(s.diesel || s.gasoil);
      if (s.diesel_premium != null) prices.diesel_premium = parseFloat(s.diesel_premium);
      if (s.gnc != null) prices.gnc = parseFloat(s.gnc);

      return {
        id: `AR-${s.id_estacion || s._id || Math.random().toString(36).slice(2)}`,
        brand: s.empresa || s.bandera || 'Estaci\u00F3n',
        address: s.direccion || '',
        city: s.localidad || s.municipio || '',
        lat: sLat,
        lng: sLng,
        prices,
        updatedAt: s.fecha || null,
        distance: dist,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 100);
}

// ─── Switzerland (Navisano/Comparis via Cloudflare Worker) ───────────
// The worker proxies the Navisano API, caches all ~3,980 Swiss stations,
// and returns nearby ones filtered by distance.
async function fetchSwitzerland(lat, lng, radiusKm, _fuelType) {
  const proxyUrl = import.meta.env.VITE_SWITZERLAND_PROXY_URL;
  if (!proxyUrl) {
    console.warn('Switzerland proxy URL not set (VITE_SWITZERLAND_PROXY_URL). Using demo data.');
    return generateDemoStations(lat, lng, radiusKm, 'CH');
  }

  try {
    const url = `${proxyUrl}/api/switzerland?lat=${lat}&lng=${lng}&radius=${radiusKm}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Switzerland proxy error: ${res.status}`);
    const json = await res.json();
    console.log('[FuelAPI] Switzerland raw response:', json);

    // Worker already returns normalized { id, brand, address, lat, lng, prices, distance }
    return (json?.stations || []).map((s) => ({
      id: `CH-${s.id}`,
      brand: s.brand === 'UNDEFINED' ? 'Tankstelle' : (s.brand || 'Tankstelle'),
      address: s.address || '',
      city: s.city || '',
      lat: s.lat,
      lng: s.lng,
      prices: s.prices || {},
      updatedAt: s.updatedAt || null,
      distance: s.distance,
    }));
  } catch (e) {
    console.warn('Switzerland proxy unavailable, using demo data:', e.message);
    return generateDemoStations(lat, lng, radiusKm, 'CH');
  }
}

// ─── Demo data generator ──────────────────────────────────────────────
const BRANDS = {
  FR: ['TotalEnergies', 'Leclerc', 'Carrefour', 'Intermarché', 'Auchan', 'BP', 'Shell', 'Esso'],
  DE: ['Aral', 'Shell', 'Esso', 'Total', 'JET', 'AVIA', 'Agip', 'Star'],
  HR: ['INA', 'Petrol', 'MOL', 'OMV', 'Tifon', 'Crodux', 'Lukoil'],
  LU: ['Aral', 'Shell', 'TotalEnergies', 'Q8', 'Esso', 'Lukoil', 'Gulf'],
  PT: ['Galp', 'Repsol', 'BP', 'Cepsa', 'Prio', 'Intermarche', 'Jumbo'],
  SI: ['Petrol', 'MOL', 'OMV', 'Hofer (AVIA)', 'Euroil'],
  UK: ['BP', 'Shell', 'Esso', 'Tesco', 'Sainsbury\'s', 'Asda', 'Morrisons', 'Texaco'],
  ES: ['Repsol', 'Cepsa', 'BP', 'Shell', 'Galp', 'Petronor', 'Ballenoil'],
  IT: ['Eni', 'IP', 'Q8', 'TotalErg', 'Tamoil', 'Esso', 'API', 'Shell'],
  AT: ['OMV', 'BP', 'Shell', 'Eni', 'JET', 'Avanti', 'Turm\u00F6l', 'IQ'],
  KR: ['SK Energy', 'GS Caltex', 'S-Oil', 'Hyundai Oilbank', 'NH', 'E1'],
  CL: ['COPEC', 'Shell', 'Petrobras', 'Terpel', 'ENEX'],
  AU: ['Caltex', 'BP', 'Shell', '7-Eleven', 'United', 'Coles Express', 'Woolworths'],
  MX: ['Pemex', 'BP', 'Shell', 'Mobil', 'Total', 'Oxxo Gas', 'G500'],
  BR: ['Petrobras', 'Ipiranga', 'Shell', 'Ale', 'Repsol'],
  AR: ['YPF', 'Shell', 'Axion Energy', 'Puma', 'Gulf', 'Petrobras'],
  CH: ['Migrol', 'AVIA', 'Coop Pronto', 'Shell', 'BP', 'Eni', 'Agrola', 'Ruedi R\u00FCssel'],
  US: ['Shell', 'Chevron', 'ExxonMobil', 'BP', 'Marathon', 'Valero', 'Citgo', 'Sunoco', 'Costco', 'Sam\'s Club', 'QuikTrip', 'Wawa'],
  CA: ['Petro-Canada', 'Shell', 'Esso', 'Canadian Tire Gas', 'Ultramar', 'Costco', 'Pioneer', 'Husky', 'Co-op', 'Mobil'],
};

const FUEL_RANGES = {
  FR: { SP95: [1.65, 1.95], SP98: [1.75, 2.05], E10: [1.60, 1.90], Gazole: [1.55, 1.85], E85: [0.75, 0.95], GPLc: [0.85, 1.05] },
  DE: { e5: [1.65, 1.95], e10: [1.60, 1.90], diesel: [1.55, 1.85] },
  HR: { e5: [1.40, 1.65], e10: [1.35, 1.60], diesel: [1.35, 1.60] },
  LU: { e5: [1.45, 1.70], e10: [1.40, 1.65], diesel: [1.40, 1.65] },
  PT: { e5: [1.60, 1.90], e10: [1.55, 1.85], diesel: [1.50, 1.80] },
  SI: { e5: [1.45, 1.70], e10: [1.40, 1.65], diesel: [1.40, 1.65] },
  UK: { unleaded: [135, 155], diesel: [140, 160], super_unleaded: [150, 170] },
  ES: { gasolina95: [1.45, 1.75], gasolina98: [1.55, 1.85], gasoleo: [1.40, 1.70], glp: [0.75, 0.95] },
  IT: { benzina: [1.70, 2.00], gasolio: [1.60, 1.90], gpl: [0.70, 0.90], metano: [1.30, 1.60] },
  AT: { SUP: [1.55, 1.85], GOE: [1.50, 1.80], GAS: [1.20, 1.50] },
  KR: { B027: [1600, 1900], B034: [1800, 2100], D047: [1500, 1800], K015: [900, 1100] },
  CL: { gasolina93: [1100, 1400], gasolina95: [1200, 1500], gasolina97: [1300, 1600], diesel: [1000, 1300], glp: [600, 800] },
  AU: { E10: [170, 210], U91: [175, 215], P95: [185, 225], P98: [195, 235], DL: [180, 220], LPG: [80, 110] },
  MX: { regular: [21, 25], premium: [23, 27], diesel: [22, 26] },
  BR: { gasolina: [5.5, 7.0], gasolina_ad: [5.8, 7.3], etanol: [3.5, 5.0], diesel: [5.0, 6.5], gnv: [3.5, 5.0] },
  AR: { nafta_super: [500, 800], nafta_premium: [600, 900], diesel: [500, 750], diesel_premium: [600, 850], gnc: [200, 400] },
  CH: { E95: [1.70, 1.95], E98: [1.80, 2.05], Diesel: [1.75, 2.00] },
  US: { regular: [3.10, 3.80], midgrade: [3.50, 4.20], premium: [3.90, 4.60], diesel: [3.60, 4.30] },
  CA: { regular: [1.50, 1.85], midgrade: [1.65, 2.00], premium: [1.80, 2.15], diesel: [1.60, 1.95] },
};

function generateDemoStations(lat, lng, radiusKm, country) {
  const count = 15 + Math.floor(Math.random() * 10);
  const brands = BRANDS[country] || BRANDS.FR;
  const fuelRanges = FUEL_RANGES[country] || FUEL_RANGES.FR;

  return Array.from({ length: count }, (_, i) => {
    const angle = Math.random() * 2 * Math.PI;
    const dist = Math.random() * radiusKm;
    const dLat = (dist / 111) * Math.cos(angle);
    const dLng = (dist / (111 * Math.cos((lat * Math.PI) / 180))) * Math.sin(angle);
    const sLat = lat + dLat;
    const sLng = lng + dLng;

    const prices = {};
    for (const [fuel, [min, max]] of Object.entries(fuelRanges)) {
      if (Math.random() > 0.15) {
        prices[fuel] = +(min + Math.random() * (max - min)).toFixed(3);
      }
    }

    const hoursAgo = Math.floor(Math.random() * 48);
    const updated = new Date(Date.now() - hoursAgo * 3600000);

    return {
      id: `${country}-DEMO-${i}`,
      brand: brands[Math.floor(Math.random() * brands.length)],
      address: `${Math.floor(Math.random() * 200) + 1} Rue Example`,
      city: 'Demo City',
      lat: sLat,
      lng: sLng,
      prices,
      updatedAt: updated.toISOString(),
      distance: haversineDistance(lat, lng, sLat, sLng),
    };
  }).sort((a, b) => a.distance - b.distance);
}

// ─── Public API ────────────────────────────────────────────────────────
const fetchers = {
  FR: fetchFrance,
  DE: fetchGermany,
  HR: fetchCroatia,
  LU: fetchLuxembourg,
  PT: fetchPortugal,
  SI: fetchSlovenia,
  ES: fetchSpain,
  IT: fetchItaly,
  UK: fetchUK,
  AT: fetchAustria,
  KR: fetchSouthKorea,
  CL: fetchChile,
  AU: fetchAustralia,
  MX: fetchMexico,
  BR: fetchBrazil,
  AR: fetchArgentina,
  CH: fetchSwitzerland,
  US: fetchUSA,
  CA: fetchCanada,
};

export async function fetchStations(countryCode, lat, lng, radiusKm, fuelType) {
  const fetcher = fetchers[countryCode];
  if (!fetcher) throw new Error(`Unsupported country: ${countryCode}`);
  const stations = await fetcher(lat, lng, radiusKm, fuelType);
  console.log(`[FuelAPI] ${countryCode} normalized stations (${stations.length}):`, stations);
  return stations;
}
