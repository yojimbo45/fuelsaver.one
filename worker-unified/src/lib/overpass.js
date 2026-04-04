/**
 * OSM Overpass API helper with fallback mirrors.
 */

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

export async function queryOverpass(lat, lng, radiusM) {
  const query = `[out:json][timeout:15];(node[amenity=fuel](around:${radiusM},${lat},${lng});way[amenity=fuel](around:${radiusM},${lat},${lng}););out center;`;

  for (const mirror of MIRRORS) {
    try {
      const res = await fetch(mirror, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      return data.elements || [];
    } catch {
      continue;
    }
  }

  throw new Error('All Overpass mirrors failed');
}
