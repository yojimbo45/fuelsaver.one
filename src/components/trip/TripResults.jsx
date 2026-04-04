import { formatPrice, formatPriceShort } from '../../utils/format';
import { COUNTRIES } from '../../services/countries';
import { getBrandLogoUrl } from '../../utils/brandLogo';

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m} min`;
  return `${h}h ${m}min`;
}

function StationCard({ station, isBest, currency, decimals, onClick }) {
  const stationCountry = COUNTRIES[station.countryCode];
  const stationCurrency = stationCountry?.currency || currency;
  const stationDecimals = stationCountry?.decimals || decimals;
  const logoUrl = getBrandLogoUrl(station.brand, station.countryCode);

  return (
    <div
      className={`trip-station-card${isBest ? ' trip-station-best' : ''}`}
      onClick={() => onClick?.(station)}
    >
      {isBest && <span className="trip-station-badge">Best price</span>}
      <div className="trip-station-header">
        {logoUrl ? (
          <img className="trip-station-logo" src={logoUrl} alt="" />
        ) : (
          <span className="trip-station-logo-placeholder">
            {station.brand?.charAt(0) || '?'}
          </span>
        )}
        <div className="trip-station-info">
          <span className="trip-station-brand">{station.brand}</span>
          <span className="trip-station-address">{station.address}{station.city ? `, ${station.city}` : ''}</span>
        </div>
        <span className="trip-station-price">
          {formatPrice(station.price, stationCurrency, stationDecimals)}
        </span>
      </div>
      <div className="trip-station-meta">
        <span>{station.routeDistance < 1 ? 'On route' : `${station.routeDistance.toFixed(1)} km off route`}</span>
        {station.countryCode && stationCountry && (
          <span>{stationCountry.flag} {stationCountry.name}</span>
        )}
      </div>
    </div>
  );
}

export default function TripResults({
  tripCost, countryData, fuelType, tankCapacity,
  recommendedStations, stationsLoading, onStationClick,
}) {
  if (!tripCost) return null;

  const fuelLabel = countryData?.fuelTypes.find(f => f.id === fuelType)?.label || fuelType;
  const currency = countryData?.currency || '\u20AC';
  const decimals = countryData?.decimals || 2;
  const unit = countryData?.unit || 'L';
  const refills = tankCapacity > 0 ? Math.ceil(tripCost.fuelNeeded / tankCapacity) - 1 : 0;
  const rangePerTank = tankCapacity > 0 && tripCost.fuelNeeded > 0
    ? (tankCapacity / tripCost.fuelNeeded * tripCost.distance).toFixed(0)
    : null;

  const top3 = recommendedStations.slice(0, 3);
  const rest = recommendedStations.slice(3);

  // Savings calculation: cheapest vs average price along route
  const cheapest = recommendedStations.length > 0 ? recommendedStations[0] : null;
  const avgPrice = recommendedStations.length > 0
    ? recommendedStations.reduce((sum, s) => sum + s.price, 0) / recommendedStations.length
    : null;
  const hasSavings = cheapest && avgPrice && avgPrice > cheapest.price;
  const savingPerUnit = hasSavings ? avgPrice - cheapest.price : 0;
  const tripSaving = savingPerUnit * tripCost.fuelNeeded;

  const costAtCheapest = cheapest ? cheapest.price * tripCost.fuelNeeded : tripCost.cost;

  return (
    <div className="trip-results-container">
      {/* Trip summary */}
      <div className="trip-results">
        <h3 className="trip-results-title">Trip Estimate</h3>
        <div className="trip-result-row">
          <span className="trip-result-label">Distance</span>
          <span className="trip-result-value">{tripCost.distance.toFixed(1)} km</span>
        </div>
        <div className="trip-result-row">
          <span className="trip-result-label">Duration</span>
          <span className="trip-result-value">{formatDuration(tripCost.duration)}</span>
        </div>
        <div className="trip-result-row">
          <span className="trip-result-label">Fuel needed ({fuelLabel})</span>
          <span className="trip-result-value">{tripCost.fuelNeeded.toFixed(1)} {unit}</span>
        </div>
        {refills > 0 && (
          <div className="trip-result-row">
            <span className="trip-result-label">Refills needed</span>
            <span className="trip-result-value">{refills} stop{refills > 1 ? 's' : ''} (range: {rangePerTank} km/tank)</span>
          </div>
        )}

        <div className="trip-result-row trip-result-total">
          <span className="trip-result-label">Estimated cost</span>
          <span className="trip-result-value">
            {formatPrice(hasSavings ? costAtCheapest : tripCost.cost, currency, Math.min(decimals, 2))}
          </span>
        </div>

        {hasSavings && (
          <div className="trip-savings-banner">
            <div className="trip-savings-icon">$</div>
            <div className="trip-savings-text">
              <div className="trip-savings-amount">
                {formatPriceShort(tripSaving, currency, decimals)} saved on this trip
              </div>
              <div className="trip-savings-detail">
                Best <span className="trip-savings-cheap">{formatPrice(cheapest.price, currency, decimals)}</span>
                {' vs avg '}
                <span className="trip-savings-expensive">{formatPrice(avgPrice, currency, decimals)}</span>
                &nbsp;&middot;&nbsp;{recommendedStations.length} stations compared
              </div>
            </div>
          </div>
        )}

        {!hasSavings && (
          <p className="trip-results-disclaimer">
            {stationsLoading
              ? 'Searching stations along route...'
              : recommendedStations.length > 0
                ? `Based on ${recommendedStations.length} stations along route`
                : 'Based on estimated national average'}
          </p>
        )}
      </div>

      {/* Top 3 cheapest */}
      {(top3.length > 0 || stationsLoading) && (
        <div className="trip-stations">
          <h3 className="trip-stations-title">
            Cheapest Stations Along Route
            {stationsLoading && <span className="trip-stations-loading"> Searching...</span>}
          </h3>

          {!stationsLoading && top3.length === 0 && (
            <p className="trip-stations-empty">No stations found along this route</p>
          )}

          {top3.map((station, i) => (
            <StationCard
              key={station.id}
              station={station}
              isBest={i === 0}
              currency={currency}
              decimals={decimals}
              onClick={onStationClick}
            />
          ))}
        </div>
      )}

      {/* Full station list */}
      {recommendedStations.length > 3 && (
        <div className="trip-all-stations">
          <h3 className="trip-stations-title">
            All Stations ({recommendedStations.length})
          </h3>
          {rest.map((station) => (
            <StationCard
              key={station.id}
              station={station}
              isBest={false}
              currency={currency}
              decimals={decimals}
              onClick={onStationClick}
            />
          ))}
        </div>
      )}
    </div>
  );
}
