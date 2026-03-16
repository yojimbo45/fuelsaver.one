const MAPBOX_GEOCODING_URL = 'https://api.mapbox.com/search/geocode/v6';

function getToken() {
  return import.meta.env.VITE_MAPBOX_TOKEN || '';
}

// Map ISO alpha-2 codes to our country config keys
const ISO_TO_COUNTRY = {
  FR: 'FR', DE: 'DE', GB: 'UK', HR: 'HR', ES: 'ES', IT: 'IT',
  LU: 'LU', AT: 'AT', PT: 'PT', SI: 'SI', KR: 'KR', CL: 'CL',
  AU: 'AU', MX: 'MX', BR: 'BR', AR: 'AR', CH: 'CH', US: 'US', CA: 'CA',
};

function extractCountryCode(feature) {
  // Mapbox v6: properties.context.country.country_code (ISO alpha-2)
  const iso = feature.properties?.context?.country?.country_code?.toUpperCase();
  return ISO_TO_COUNTRY[iso] || null;
}

/**
 * Autocomplete suggestions as user types.
 * Returns array of { id, text, lat, lng, countryCode }
 */
export async function autocompletePlaces(query) {
  if (!query || query.length < 2) return [];

  const token = getToken();
  if (!token) return fallbackNominatim(query);

  const params = new URLSearchParams({
    q: query,
    access_token: token,
    language: 'en',
    limit: '5',
    types: 'place,locality,postcode,address,neighborhood',
  });

  const res = await fetch(`${MAPBOX_GEOCODING_URL}/forward?${params}`);
  if (!res.ok) return [];

  const json = await res.json();
  return (json.features || []).map((f) => ({
    id: f.id,
    text: f.properties.full_address || f.properties.name,
    lat: f.geometry.coordinates[1],
    lng: f.geometry.coordinates[0],
    countryCode: extractCountryCode(f),
  }));
}

/**
 * Geocode a full query string to lat/lng.
 * Returns { lat, lng, displayName, countryCode }
 */
export async function geocodeAddress(query) {
  const token = getToken();
  if (!token) {
    const results = await fallbackNominatim(query);
    if (!results.length) throw new Error('Location not found');
    return { lat: results[0].lat, lng: results[0].lng, displayName: results[0].text, countryCode: results[0].countryCode };
  }

  const params = new URLSearchParams({
    q: query,
    access_token: token,
    language: 'en',
    limit: '1',
  });

  const res = await fetch(`${MAPBOX_GEOCODING_URL}/forward?${params}`);
  if (!res.ok) throw new Error('Geocoding failed');

  const json = await res.json();
  const f = json.features?.[0];
  if (!f) throw new Error('Location not found');

  return {
    lat: f.geometry.coordinates[1],
    lng: f.geometry.coordinates[0],
    displayName: f.properties.full_address || f.properties.name,
    countryCode: extractCountryCode(f),
  };
}

/**
 * Fallback to Nominatim if no Mapbox token.
 */
async function fallbackNominatim(query) {
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    limit: '5',
    addressdetails: '1',
  });

  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { 'Accept-Language': 'en' },
  });
  if (!res.ok) return [];

  const data = await res.json();
  return data.map((d) => {
    const iso = d.address?.country_code?.toUpperCase();
    return {
      id: d.place_id,
      text: d.display_name,
      lat: parseFloat(d.lat),
      lng: parseFloat(d.lon),
      countryCode: ISO_TO_COUNTRY[iso] || null,
    };
  });
}
