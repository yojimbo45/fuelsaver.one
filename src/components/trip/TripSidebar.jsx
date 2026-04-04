import { useState } from 'react';
import TripPlaceInput from './TripPlaceInput';
import TripResults from './TripResults';
import VehicleSelector from './VehicleSelector';

export default function TripSidebar({
  origin, setOrigin,
  destination, setDestination,
  waypoints, addWaypoint, removeWaypoint, updateWaypoint,
  consumption, setConsumption,
  tankCapacity, setTankCapacity,
  fuelType, setFuelType,
  countryData,
  tripCost,
  loading, error,
  recommendedStations, stationsLoading,
  calculate, invertRoute,
  onStationClick,
}) {
  const fuelTypes = countryData?.fuelTypes || [];
  const [vehiclePanel, setVehiclePanel] = useState(false);
  const [vehicleName, setVehicleName] = useState(null);

  const handleSubmit = (e) => {
    e.preventDefault();
    calculate();
  };

  const handleVehicleSelect = (vehicle) => {
    if (vehicle.consumption) setConsumption(vehicle.consumption);
    if (vehicle.tank > 0) setTankCapacity(vehicle.tank);
    setVehicleName(`${vehicle.make} ${vehicle.model}`);
    setVehiclePanel(false);
  };

  const handleClearVehicle = () => {
    setVehicleName(null);
  };

  // Vehicle picker panel
  if (vehiclePanel) {
    return (
      <div className="trip-sidebar">
        <div className="vehicle-panel-header">
          <button type="button" className="vehicle-back-btn" onClick={() => setVehiclePanel(false)}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Back
          </button>
          <h2 className="trip-title">Find your car</h2>
        </div>
        <VehicleSelector onSelect={handleVehicleSelect} />
      </div>
    );
  }

  return (
    <form className="trip-sidebar" onSubmit={handleSubmit}>
      <h2 className="trip-title">Trip Cost Calculator</h2>

      <div className="trip-inputs">
        <div className="trip-place-row">
          <span className="trip-dot trip-dot-origin" />
          <TripPlaceInput
            value={origin}
            placeholder="From: city or address..."
            onSelect={setOrigin}
            onClear={() => setOrigin(null)}
          />
        </div>
        <div className="trip-connector" />
        {waypoints.map((wp, i) => (
          <div key={i}>
            <div className="trip-place-row">
              <span className="trip-dot trip-dot-waypoint" />
              <TripPlaceInput
                value={wp}
                placeholder={`Stop ${i + 1}...`}
                onSelect={(place) => updateWaypoint(i, place)}
                onClear={() => updateWaypoint(i, null)}
              />
              <button type="button" className="trip-remove-stop" onClick={() => removeWaypoint(i)} title="Remove stop">&times;</button>
            </div>
            <div className="trip-connector" />
          </div>
        ))}
        <div className="trip-place-row">
          <span className="trip-dot trip-dot-destination" />
          <TripPlaceInput
            value={destination}
            placeholder="To: city or address..."
            onSelect={setDestination}
            onClear={() => setDestination(null)}
          />
        </div>
      </div>

      <div className="trip-actions">
        <button type="button" className="trip-add-stop" onClick={addWaypoint}>+ Add a stop</button>
        <button type="button" className="trip-invert-btn" onClick={invertRoute} title="Invert route">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="7 3 7 21" /><polyline points="4 6 7 3 10 6" />
            <polyline points="17 21 17 3" /><polyline points="14 18 17 21 20 18" />
          </svg>
          Invert
        </button>
      </div>

      {/* Consumption + fuel type row */}
      <div className={`trip-vehicle-settings${vehicleName ? ' disabled' : ''}`}>
        <div className="trip-consumption-group">
          <label className="trip-label">Consumption</label>
          <div className="trip-consumption-input">
            <button type="button" disabled={!!vehicleName} onClick={() => setConsumption(c => Math.max(1, +(c - 0.5).toFixed(1)))}>&minus;</button>
            <input type="number" min="1" max="30" step="0.1" value={consumption} disabled={!!vehicleName} onChange={(e) => setConsumption(+e.target.value || 7)} />
            <span className="trip-consumption-unit">L/100km</span>
            <button type="button" disabled={!!vehicleName} onClick={() => setConsumption(c => Math.min(30, +(c + 0.5).toFixed(1)))}>+</button>
          </div>
        </div>
        {fuelTypes.length > 0 && (
          <div className="trip-fuel-group">
            <label className="trip-label">Fuel type</label>
            <select className="trip-fuel-select" value={fuelType || ''} disabled={!!vehicleName} onChange={(e) => setFuelType(e.target.value)}>
              {fuelTypes.map(ft => (<option key={ft.id} value={ft.id}>{ft.label}</option>))}
            </select>
          </div>
        )}
      </div>

      {/* Find your car / selected car */}
      {vehicleName ? (
        <div className="trip-car-selected">
          <span className="trip-car-selected-name">{vehicleName}</span>
          <button type="button" className="trip-car-clear" onClick={handleClearVehicle} title="Remove vehicle">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      ) : (
        <button type="button" className="trip-find-car" onClick={() => setVehiclePanel(true)}>
          Find your car
        </button>
      )}

      <button className="search-btn trip-search-btn" type="submit" disabled={!origin?.lat || !destination?.lat || loading}>
        {loading ? 'Calculating...' : 'Search for itinerary'}
      </button>

      {error && <p className="trip-error">{error}</p>}

      <TripResults
        tripCost={tripCost}
        countryData={countryData}
        fuelType={fuelType}
        tankCapacity={tankCapacity}
        recommendedStations={recommendedStations}
        stationsLoading={stationsLoading}
        onStationClick={onStationClick}
      />
    </form>
  );
}
