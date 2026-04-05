export function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Filter stations by bounding box then haversine distance.
 * Returns top `limit` stations sorted by distance.
 */
export function filterByDistance(stations, lat, lng, radiusKm, limit = 100) {
  const dLat = radiusKm / 111;
  const dLng = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));

  return stations
    .filter(
      (s) =>
        s.lat >= lat - dLat &&
        s.lat <= lat + dLat &&
        s.lng >= lng - dLng &&
        s.lng <= lng + dLng
    )
    .map((s) => ({
      ...s,
      distance: Math.round(haversine(lat, lng, s.lat, s.lng) * 100) / 100,
    }))
    .filter((s) => s.distance <= radiusKm)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
}

/**
 * Spatially distributed sampling: one station per grid cell.
 * Instead of returning the N closest (which cluster around center),
 * divides the area into cells and picks one station per cell.
 * Good for low-zoom overviews where you want country-wide coverage.
 */
export function filterSpread(stations, lat, lng, radiusKm, limit = 100) {
  const dLat = radiusKm / 111;
  const dLng = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));

  const inBox = stations.filter(
    (s) =>
      s.lat >= lat - dLat &&
      s.lat <= lat + dLat &&
      s.lng >= lng - dLng &&
      s.lng <= lng + dLng
  );

  // If few enough stations, return all (no need to grid-sample)
  if (inBox.length <= limit) {
    return inBox
      .map((s) => ({ ...s, distance: Math.round(haversine(lat, lng, s.lat, s.lng) * 100) / 100 }))
      .filter((s) => s.distance <= radiusKm)
      .sort((a, b) => a.distance - b.distance);
  }

  // Binary-search for a grid cell size that yields ~limit stations
  // Start with radius/5, then adjust: shrink cells if too few, grow if too many
  let cellDeg = (radiusKm / 5) / 111;
  let result;

  for (let i = 0; i < 4; i++) {
    const grid = new Map();
    for (const s of inBox) {
      const row = Math.floor(s.lat / cellDeg);
      const col = Math.floor(s.lng / cellDeg);
      const key = `${row}:${col}`;
      if (!grid.has(key)) {
        grid.set(key, {
          ...s,
          distance: Math.round(haversine(lat, lng, s.lat, s.lng) * 100) / 100,
        });
      }
    }
    result = Array.from(grid.values()).filter((s) => s.distance <= radiusKm);
    if (result.length >= limit * 0.7 && result.length <= limit * 1.3) break;
    // Adjust cell size: smaller cells → more results, larger cells → fewer
    cellDeg *= result.length < limit ? 0.6 : 1.5;
  }

  return result.sort((a, b) => a.distance - b.distance).slice(0, limit);
}

/**
 * Compute grid cell center for Tier B caching.
 * Rounds to 0.1 degree (~11km grid).
 */
export function gridCell(lat, lng) {
  return {
    lat: Math.round(lat * 10) / 10,
    lng: Math.round(lng * 10) / 10,
  };
}
