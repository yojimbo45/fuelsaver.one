const WORKER_URL = import.meta.env.VITE_WORKER_URL;

/**
 * Search vehicles by query and optional year.
 * Returns array of { make, model, years, consumption, tank }.
 */
export async function searchVehicles(query, year) {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (year) params.set('year', year);

  const url = WORKER_URL
    ? `${WORKER_URL}/api/vehicles?${params}`
    : null;

  if (!url) {
    // Fallback: search the local European cars data
    const { EUROPEAN_CARS } = await import('../data/europeanCars.js');
    const q = (query || '').toLowerCase();
    const y = year ? parseInt(year) : null;

    let results = EUROPEAN_CARS;
    if (y) {
      results = results.filter(v => {
        const [from, to] = v.years.split('-').map(Number);
        return y >= from && y <= to;
      });
    }
    if (q) {
      results = results.filter(v =>
        v.make.toLowerCase().includes(q) ||
        v.model.toLowerCase().includes(q) ||
        `${v.make} ${v.model}`.toLowerCase().includes(q)
      );
    }
    return results.slice(0, 50);
  }

  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) return [];
  const json = await res.json();
  return json.vehicles || [];
}
