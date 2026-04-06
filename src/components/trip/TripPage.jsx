import { useState, useCallback } from 'react';
import { useTripRoute } from '../../hooks/useTripRoute';
import TripSidebar from './TripSidebar';
import TripMap from './TripMap';
import LabelStyleToggle from '../LabelStyleToggle';

export default function TripPage({ sidebarOpen, setSidebarOpen, labelStyle, onLabelStyleChange }) {
  const trip = useTripRoute();
  const [tripHighlightedStation, setTripHighlightedStation] = useState(null);

  return (
    <>
      <aside className={`sidebar${sidebarOpen ? '' : ' sidebar-collapsed'}`}>
        <button className="sidebar-handle" onClick={() => setSidebarOpen(o => !o)}>
          <span className="sidebar-handle-bar" />
          <span className="sidebar-handle-label">Trip Details</span>
          <svg className={`sidebar-handle-chevron${sidebarOpen ? '' : ' flipped'}`} viewBox="0 0 12 8" width="12" height="8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M1 1l5 5 5-5"/></svg>
        </button>
        <TripSidebar
          origin={trip.origin}
          setOrigin={trip.setOrigin}
          destination={trip.destination}
          setDestination={trip.setDestination}
          waypoints={trip.waypoints}
          addWaypoint={trip.addWaypoint}
          removeWaypoint={trip.removeWaypoint}
          updateWaypoint={trip.updateWaypoint}
          consumption={trip.consumption}
          setConsumption={trip.setConsumption}
          tankCapacity={trip.tankCapacity}
          setTankCapacity={trip.setTankCapacity}
          fuelType={trip.fuelType}
          setFuelType={trip.setFuelType}
          countryData={trip.countryData}
          tripCost={trip.tripCost}
          loading={trip.loading}
          error={trip.error}
          recommendedStations={trip.recommendedStations}
          stationsLoading={trip.stationsLoading}
          calculate={trip.calculate}
          invertRoute={trip.invertRoute}
          onStationClick={setTripHighlightedStation}
        />
      </aside>
      <div className="map-wrapper">
        <LabelStyleToggle value={labelStyle} onChange={onLabelStyleChange} />
        <TripMap
          route={trip.route}
          origin={trip.origin}
          destination={trip.destination}
          waypoints={trip.waypoints}
          recommendedStations={trip.recommendedStations}
          highlightedStation={tripHighlightedStation}
          labelStyle={labelStyle}
        />
      </div>
    </>
  );
}
