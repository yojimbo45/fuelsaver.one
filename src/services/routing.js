/**
 * Fetch a driving route between points using OSRM.
 * @param {Array<{lat: number, lng: number}>} points
 * @returns {Promise<{geometry: object, distance: number, duration: number}>}
 */
export async function fetchRoute(points) {
  if (points.length < 2) throw new Error('At least 2 points required');

  const coords = points.map(p => `${p.lng},${p.lat}`).join(';');
  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`;

  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error('Routing request failed');

  const json = await res.json();
  if (json.code !== 'Ok' || !json.routes?.length) throw new Error('No route found');

  const route = json.routes[0];
  return {
    geometry: route.geometry,
    distance: route.distance / 1000,
    duration: route.duration,
  };
}
