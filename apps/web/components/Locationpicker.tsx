
import { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
 
// Fix Leaflet default icon broken by webpack asset hashing
delete ((L.Icon.Default as unknown as { prototype: { _getIconUrl?: string } }).prototype)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});
 
interface BBox {
  latMin: number; latMax: number;
  lngMin: number; lngMax: number;
}
 
interface Props {
  center:           { lat: number; lng: number };
  demoMode:         boolean;
  demoBbox:         BBox;
  onLocationChange: (lat: number, lng: number) => void;
}
 
// Clamp a coordinate to the geo-fence bbox
function clampToBbox(lat: number, lng: number, bbox: BBox) {
  return {
    lat: Math.min(Math.max(lat, bbox.latMin), bbox.latMax),
    lng: Math.min(Math.max(lng, bbox.lngMin), bbox.lngMax),
  };
}
 
// Inner component — useMapEvents must be inside MapContainer
function DraggableMarker({
  position, demoMode, demoBbox, onMove, onToast,
}: {
  position:  { lat: number; lng: number };
  demoMode:  boolean;
  demoBbox:  BBox;
  onMove:    (lat: number, lng: number) => void;
  onToast:   (msg: string) => void;
}) {
  const markerRef = useRef<L.Marker>(null);
 
  useMapEvents({
    click(e) {
      let { lat, lng } = e.latlng;
      if (demoMode) {
        const inside = (
          lat >= demoBbox.latMin && lat <= demoBbox.latMax &&
          lng >= demoBbox.lngMin && lng <= demoBbox.lngMax
        );
        if (!inside) {
          const clamped = clampToBbox(lat, lng, demoBbox);
          lat = clamped.lat;
          lng = clamped.lng;
          onToast('Location must be within demo ward');
        }
      }
      onMove(lat, lng);
      markerRef.current?.setLatLng([lat, lng]);
    },
  });
 
  const eventHandlers = {
    dragend() {
      const marker = markerRef.current;
      if (!marker) return;
      let { lat, lng } = marker.getLatLng();
      if (demoMode) {
        const inside = (
          lat >= demoBbox.latMin && lat <= demoBbox.latMax &&
          lng >= demoBbox.lngMin && lng <= demoBbox.lngMax
        );
        if (!inside) {
          const clamped = clampToBbox(lat, lng, demoBbox);
          lat = clamped.lat;
          lng = clamped.lng;
          marker.setLatLng([lat, lng]);
          onToast('Location must be within demo ward');
        }
      }
      onMove(lat, lng);
    },
  };
 
  return (
    <Marker
      draggable
      position={[position.lat, position.lng]}
      ref={markerRef}
      eventHandlers={eventHandlers}
    />
  );
}
 
export default function LocationPicker({ center, demoMode, demoBbox, onLocationChange }: Props) {
  const [position, setPosition]     = useState(center);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [toast, setToast]           = useState<string | null>(null);
 
  // Show geo-fence toast for 3 seconds then hide
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };
 
  const handleMove = (lat: number, lng: number) => {
    setPosition({ lat, lng });
    onLocationChange(lat, lng);
  };
 
  // GPS auto-capture on mount
  useEffect(() => {
    if (!navigator.geolocation) return;
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        let { latitude: lat, longitude: lng } = pos.coords;
        // In demo mode, clamp GPS to bbox (venue GPS may be slightly off)
        if (demoMode) {
          const clamped = clampToBbox(lat, lng, demoBbox);
          lat = clamped.lat;
          lng = clamped.lng;
        }
        handleMove(lat, lng);
        setGpsLoading(false);
      },
      () => {
        // Permission denied or unavailable — stay on default center
        setGpsLoading(false);
      },
      { timeout: 5000, maximumAge: 30000 }
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
 
  return (
    <div className="relative">
      {/* GPS loading indicator */}
      {gpsLoading && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000]
                        bg-white text-xs text-gray-600 px-3 py-1.5 rounded-full shadow
                        flex items-center gap-1.5">
          <span className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse" />
          Detecting your location…
        </div>
      )}
 
      {/* Geo-fence toast */}
      {toast && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000]
                        bg-amber-50 border border-amber-200 text-amber-800
                        text-xs px-3 py-1.5 rounded-full shadow whitespace-nowrap">
          ⚠ {toast}
        </div>
      )}
 
      <MapContainer
        center={[position.lat, position.lng]}
        zoom={15}
        style={{ height: '260px', width: '100%', borderRadius: '12px' }}
        zoomControl={true}
      >
        <TileLayer
          attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <DraggableMarker
          position={position}
          demoMode={demoMode}
          demoBbox={demoBbox}
          onMove={handleMove}
          onToast={showToast}
        />
      </MapContainer>
 
      {/* Coordinates readout */}
      <div className="mt-2 flex justify-between text-xs text-gray-400 px-1">
        <span>{position.lat.toFixed(5)}°N</span>
        <span className="text-gray-300">tap map or drag pin to adjust</span>
        <span>{position.lng.toFixed(5)}°E</span>
      </div>
    </div>
  );
}
 
