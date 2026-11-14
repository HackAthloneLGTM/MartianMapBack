import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

type Props = {
  apiBaseUrl?: string;
};

const MAP_SIZE = 256;

export default function ElevationMap({ apiBaseUrl = 'http://localhost:3001' }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const map = L.map(containerRef.current, {
      crs: L.CRS.Simple,
      minZoom: 0,
      maxZoom: 8,
      zoomControl: true,
    });
    const bounds: L.LatLngBoundsExpression = [
      [0, 0],
      [MAP_SIZE, MAP_SIZE],
    ];

    L.tileLayer(`${apiBaseUrl}/map_elevation/{z}/{x}/{y}/png`, {
      tileSize: 256,
      noWrap: true,
      bounds,
      minZoom: 0,
      maxZoom: 8,
    }).addTo(map);
    L.tileLayer(`${apiBaseUrl}/map_slope/{z}/{x}/{y}/png`, {
      tileSize: 256,
      opacity: 0.35,
      noWrap: true,
      bounds,
      minZoom: 0,
      maxZoom: 8,
    }).addTo(map);
    map.fitBounds(bounds);
    return () => map.remove();
  }, [apiBaseUrl]);

  return <div ref={containerRef} style={{ height: '100%', minHeight: 480, width: '100%' }} />;
}