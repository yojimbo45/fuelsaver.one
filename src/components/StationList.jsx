import { useState, useMemo, useRef, useEffect } from 'react';
import { formatPrice, formatUpdated } from '../utils/format';
import { formatDistance } from '../utils/geo';
import { getBrandLogoUrl } from '../utils/brandLogo';
import { COUNTRIES } from '../services/countries';
import { getFuelColor } from '../utils/fuelColors';

export default function StationList({
  stations,
  fuelType,
  currency,
  decimals,
  countryCode,
  loading,
  error,
  onStationClick,
  onStationHover,
  onFuelChange,
}) {
  const [sortBy, setSortBy] = useState('price'); // 'price' | 'distance'
  const [fuelDropdownOpen, setFuelDropdownOpen] = useState(false);
  const fuelDropdownRef = useRef(null);

  // Close fuel dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (fuelDropdownRef.current && !fuelDropdownRef.current.contains(e.target)) {
        setFuelDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const sorted = useMemo(() => {
    const withPrice = stations.filter((s) => s.prices[fuelType] != null);
    // If no stations have the selected fuel price, show all stations sorted by distance
    const list = withPrice.length > 0 ? withPrice : [...stations];
    if (sortBy === 'price' && withPrice.length > 0) {
      return [...list].sort((a, b) => (a.prices[fuelType] ?? Infinity) - (b.prices[fuelType] ?? Infinity));
    }
    return [...list].sort((a, b) => (a.distance || 0) - (b.distance || 0));
  }, [stations, fuelType, sortBy]);

  const withPrices = sorted.filter((s) => s.prices[fuelType] != null);
  const cheapestPrice = withPrices.length ? withPrices[0]?.prices[fuelType] : null;
  const expensivePrice = withPrices.length ? withPrices[withPrices.length - 1]?.prices[fuelType] : null;

  // Full loading spinner only on initial search (no existing stations)
  if (loading && !stations.length) {
    return (
      <div className="loading-state">
        <div className="loading-spinner" />
        <span>Searching stations...</span>
      </div>
    );
  }

  if (error && !stations.length) {
    return (
      <div className="empty-state">
        <div className="empty-icon">!</div>
        <span>{error}</span>
      </div>
    );
  }

  if (!stations.length) {
    return (
      <div className="empty-state">
        <div className="empty-icon">{'\u26FD'}</div>
        <span>Search for a location to find nearby fuel stations</span>
      </div>
    );
  }

  if (!sorted.length) {
    return (
      <div className="empty-state">
        <div className="empty-icon">{'\u26FD'}</div>
        <span>No stations found with {fuelType} in this area</span>
      </div>
    );
  }

  return (
    <>
      {loading && <div className="station-list-loading-bar" />}
      <div className="station-list-header">
        {countryCode && COUNTRIES[countryCode] && (
          <div className="station-list-filters">
            <span className="detected-country">{COUNTRIES[countryCode].flag} {COUNTRIES[countryCode].name}</span>
            <div className="fuel-dropdown" ref={fuelDropdownRef}>
              <button
                className="fuel-dropdown-trigger"
                onClick={() => setFuelDropdownOpen(!fuelDropdownOpen)}
              >
                <span
                  className="fuel-color-dot"
                  style={{ background: getFuelColor(fuelType) }}
                />
                {(COUNTRIES[countryCode].fuelTypes || []).find((f) => f.id === fuelType)?.label || fuelType}
                <svg className="fuel-dropdown-arrow" viewBox="0 0 12 8" width="10" height="6" fill="currentColor">
                  <path d="M1 1l5 5 5-5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
                </svg>
              </button>
              {fuelDropdownOpen && (
                <ul className="fuel-dropdown-menu">
                  {(COUNTRIES[countryCode].fuelTypes || []).map((f) => (
                    <li
                      key={f.id}
                      className={`fuel-dropdown-item ${f.id === fuelType ? 'active' : ''}`}
                      onMouseDown={() => {
                        onFuelChange?.(f.id);
                        setFuelDropdownOpen(false);
                      }}
                    >
                      <span
                        className="fuel-color-dot"
                        style={{ background: getFuelColor(f.id) }}
                      />
                      {f.label}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
        <div className="sort-toggle">
          <button
            className={`sort-btn ${sortBy === 'price' ? 'active' : ''}`}
            onClick={() => setSortBy('price')}
          >
            By price
          </button>
          <button
            className={`sort-btn ${sortBy === 'distance' ? 'active' : ''}`}
            onClick={() => setSortBy('distance')}
          >
            By distance
          </button>
        </div>
      </div>
      <div className="station-list">
        {sorted.map((station, idx) => {
          const price = station.prices[fuelType];
          const isCheapest = price === cheapestPrice;
          const isExpensive = price === expensivePrice && sorted.length > 1;
          const savingVsExpensive = expensivePrice != null ? expensivePrice - price : 0;

          const logoUrl = station.logo || getBrandLogoUrl(station.brand);

          return (
            <div
              key={station.id}
              className={`station-card ${isCheapest ? 'cheapest' : ''} ${isExpensive ? 'expensive' : ''}`}
              onClick={() => onStationClick?.(station)}
              onMouseEnter={() => onStationHover?.(station)}
              onMouseLeave={() => onStationHover?.(null)}
            >
              {logoUrl ? (
                <img
                  className="station-logo"
                  src={logoUrl}
                  alt={station.brand}
                  onError={(e) => { e.target.style.display = 'none'; e.target.nextElementSibling.style.display = 'flex'; }}
                />
              ) : null}
              <div className="station-rank" style={logoUrl ? { display: 'none' } : undefined}>{idx + 1}</div>
              <div className="station-info">
                <div className="station-brand">
                  {station.brand}
                  {station.id?.includes('-DEMO-') && (
                    <span className="station-demo-badge">Demo</span>
                  )}
                </div>
                {station.name && station.name !== station.brand && (
                  <div className="station-name">{station.name}</div>
                )}
                <div className="station-address">
                  {station.address}{station.city ? `, ${station.city}` : ''}
                </div>
                {station.distance != null && (
                  <div className="station-distance">{formatDistance(station.distance)}</div>
                )}
              </div>
              <div className="station-price-col">
                <div className="station-price">{formatPrice(price, currency, decimals)}</div>
                {station.updatedAt && (
                  <div className="station-updated">
                    {formatUpdated(station.updatedAt)}
                  </div>
                )}
                {savingVsExpensive > 0.001 && (
                  <div className="station-saving saving-positive">
                    -{formatPrice(savingVsExpensive, currency, decimals)}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
