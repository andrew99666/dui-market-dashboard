import { geoAlbersUsa, geoPath } from 'd3-geo';
import { scaleSqrt } from 'd3-scale';
import { feature } from 'topojson-client';
import statesTopology from 'us-atlas/states-10m.json';
import { useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';

import { classifyCity, type CityStatus } from '../dashboard-domain';
import type { CityMetric, DatasetMetadata, UsPlace } from '../data/types';

type MapSelection = CityMetric | UsPlace;
type Transform = { x: number; y: number; scale: number };
type Tooltip = { city: string; state: string; volume: number | null; cpc: number | null; status: CityStatus; x: number; y: number };

const width = 960;
const height = 600;
const territoryIds = new Set(['60', '66', '69', '72', '78']);
const statusOrder: CityStatus[] = ['low-volume', 'unknown-cpc', 'high-cpc', 'qualified'];
const statusLabels: Record<CityStatus, string> = {
  qualified: 'Qualified',
  'high-cpc': 'High CPC',
  'unknown-cpc': 'Unknown CPC',
  'low-volume': 'Low volume',
  'no-data': 'Selected no-data',
};
const legendAccessibleLabels: Record<CityStatus, string> = {
  qualified: 'qualified',
  'high-cpc': 'high cpc',
  'unknown-cpc': 'unknown-cpc',
  'low-volume': 'low-volume',
  'no-data': 'selected no-data',
};

export interface UsMapProps {
  metrics: CityMetric[];
  metadata: DatasetMetadata;
  selected?: MapSelection;
  onSelect: (metric: CityMetric) => void;
}

export function UsMap({ metrics, metadata, selected, onSelect }: UsMapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const pointerStart = useRef<{ x: number; y: number; transform: Transform } | undefined>(undefined);
  const [visibleStatuses, setVisibleStatuses] = useState<Set<CityStatus>>(() => new Set(statusOrder));
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, scale: 1 });
  const [tooltip, setTooltip] = useState<Tooltip>();
  const selectedPlaceId = selected?.placeId;
  const selectedLatitude = selected?.latitude;
  const selectedLongitude = selected?.longitude;

  const projection = useMemo(() => geoAlbersUsa().fitSize([width, height], { type: 'Sphere' }), []);
  const path = useMemo(() => geoPath(projection), [projection]);
  const states = useMemo(() => {
    const topology = statesTopology as typeof statesTopology & { objects: { states: never } };
    const collection = feature(topology as never, topology.objects.states) as unknown as { features: Array<{ id: string | number; properties?: { name?: string } }> };
    return collection.features.filter((state) => !territoryIds.has(String(state.id).padStart(2, '0')));
  }, []);
  const radius = useMemo(() => scaleSqrt().domain([0, Math.max(...metrics.map((metric) => metric.totalSearchVolume))]).range([4, 13]), [metrics]);
  const researchedMarkers = useMemo(() => metrics.map((metric) => ({ metric, status: classifyCity(metric, metadata), point: projection([metric.longitude, metric.latitude]) })), [metadata, metrics, projection]);
  const selectedPoint = useMemo(() => selectedLatitude === undefined || selectedLongitude === undefined ? undefined : projection([selectedLongitude, selectedLatitude]) ?? undefined, [projection, selectedLatitude, selectedLongitude]);

  useEffect(() => {
    if (!selectedPoint) return;
    setTransform({ x: width / 2 - selectedPoint[0] * 4, y: height / 2 - selectedPoint[1] * 4, scale: 4 });
  }, [selectedPlaceId, selectedPoint]);

  const showTooltip = (marker: { metric?: CityMetric; place?: UsPlace; status: CityStatus; point?: [number, number] }, event?: React.MouseEvent<SVGElement> | React.FocusEvent<SVGElement>) => {
    const place = marker.metric ?? marker.place;
    if (!place || !marker.point) return;
    const rect = svgRef.current?.getBoundingClientRect();
    const clientX = event && 'clientX' in event ? event.clientX : marker.point[0];
    const clientY = event && 'clientY' in event ? event.clientY : marker.point[1];
    const relativeX = rect && rect.width ? ((clientX - rect.left) / rect.width) * width : marker.point[0];
    const relativeY = rect && rect.height ? ((clientY - rect.top) / rect.height) * height : marker.point[1];
    setTooltip({
      city: place.city,
      state: place.state,
      volume: marker.metric?.totalSearchVolume ?? null,
      cpc: marker.metric?.averageCpcUsd ?? null,
      status: marker.status,
      x: Math.min(width - 180, Math.max(8, relativeX + 12)),
      y: Math.min(height - 66, Math.max(8, relativeY + 12)),
    });
  };

  const markerShape = (status: CityStatus, point: [number, number], size: number, props: Record<string, string>) => {
    const [x, y] = point;
    if (status === 'high-cpc') return <path d={`M ${x} ${y - size} L ${x + size} ${y} L ${x} ${y + size} L ${x - size} ${y} Z`} {...props} data-shape="diamond" />;
    if (status === 'unknown-cpc') return <path d={`M ${x} ${y - size} L ${x + size} ${y + size} L ${x - size} ${y + size} Z`} {...props} data-shape="triangle" />;
    if (status === 'low-volume') return <rect x={x - size} y={y - size} width={size * 2} height={size * 2} {...props} data-shape="square" />;
    return <circle cx={x} cy={y} r={size} {...props} data-shape="circle" />;
  };

  const noDataSelection = selected && !metrics.some((metric) => metric.placeId === selected.placeId) ? selected : undefined;

  return (
    <section className="us-map" aria-label="Interactive U.S. city map">
      <div className="map-controls" aria-label="Map controls">
        <div className="map-legend" aria-label="Marker status legend">
          {statusOrder.map((status) => <button key={status} type="button" className={`legend-control legend-${status}`} aria-pressed={visibleStatuses.has(status)} aria-label={`Toggle ${legendAccessibleLabels[status]} markers`} onClick={() => setVisibleStatuses((current) => {
            const next = new Set(current);
            if (next.has(status)) next.delete(status); else next.add(status);
            return next;
          })}><span aria-hidden="true" className={`legend-shape legend-shape-${status}`} data-testid={`legend-shape-${status}`} data-shape={status === 'high-cpc' ? 'diamond' : status === 'unknown-cpc' ? 'triangle' : status === 'low-volume' ? 'square' : 'circle'} />{statusLabels[status]}</button>)}
        </div>
        <button type="button" className="icon-button map-reset" aria-label="Reset map view" title="Reset map view" onClick={() => setTransform({ x: 0, y: 0, scale: 1 })}><RotateCcw size={18} aria-hidden="true" /></button>
      </div>
      <svg ref={svgRef} className="map-canvas" data-testid="us-map" data-zoom-scale={transform.scale} viewBox={`0 0 ${width} ${height}`} onWheel={(event) => {
        event.preventDefault();
        setTransform((current) => ({ ...current, scale: Math.min(8, Math.max(1, current.scale * (event.deltaY > 0 ? 0.86 : 1.16))) }));
      }} onPointerDown={(event) => {
        pointerStart.current = { x: event.clientX, y: event.clientY, transform };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }} onPointerMove={(event) => {
        const start = pointerStart.current;
        if (!start) return;
        setTransform({ ...start.transform, x: start.transform.x + event.clientX - start.x, y: start.transform.y + event.clientY - start.y });
      }} onPointerUp={() => { pointerStart.current = undefined; }}>
        <g data-map-viewport transform={`translate(${transform.x} ${transform.y}) scale(${transform.scale})`}>
          {states.map((state) => <path key={String(state.id)} data-state-geometry data-state-id={String(state.id).padStart(2, '0')} className="map-state" d={path(state as never) ?? ''}><title>{state.properties?.name}</title></path>)}
          {statusOrder.flatMap((status) => researchedMarkers.filter((marker) => marker.status === status && visibleStatuses.has(status)).flatMap(({ metric, point }) => {
            if (!point) return [];
            const markerStatus = classifyCity(metric, metadata);
            const accessibleName = `${metric.city}, ${metric.state}. Volume ${metric.totalSearchVolume.toLocaleString()}. CPC ${metric.averageCpcUsd === null ? 'Unknown' : `$${metric.averageCpcUsd.toFixed(2)}`}. ${statusLabels[markerStatus]} status.`;
            return <g key={metric.placeId} data-marker data-place-id={metric.placeId} data-status={markerStatus} data-shape={markerStatus === 'high-cpc' ? 'diamond' : markerStatus === 'unknown-cpc' ? 'triangle' : markerStatus === 'low-volume' ? 'square' : 'circle'} role="button" tabIndex={0} aria-label={accessibleName} className={`map-marker marker-${markerStatus}`} onMouseEnter={(event) => showTooltip({ metric, status: markerStatus, point }, event)} onMouseMove={(event) => showTooltip({ metric, status: markerStatus, point }, event)} onMouseLeave={() => setTooltip(undefined)} onFocus={(event) => showTooltip({ metric, status: markerStatus, point }, event)} onBlur={() => setTooltip(undefined)} onClick={() => onSelect(metric)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(metric); } }}>
              {markerShape(markerStatus, point, radius(metric.totalSearchVolume), {})}
            </g>;
          }))}
          {noDataSelection && selectedPoint && <g data-marker="no-data" data-place-id={noDataSelection.placeId} data-status="no-data" role="img" tabIndex={0} aria-label={`${noDataSelection.city}, ${noDataSelection.state}. Volume Unknown. CPC Unknown. Selected no-data status.`} className="map-marker marker-no-data" onMouseEnter={(event) => showTooltip({ place: noDataSelection, status: 'no-data', point: selectedPoint }, event)} onMouseMove={(event) => showTooltip({ place: noDataSelection, status: 'no-data', point: selectedPoint }, event)} onMouseLeave={() => setTooltip(undefined)} onFocus={(event) => showTooltip({ place: noDataSelection, status: 'no-data', point: selectedPoint }, event)} onBlur={() => setTooltip(undefined)}>
            {markerShape('no-data', selectedPoint, 8, {})}
          </g>}
        </g>
        {tooltip && <g role="tooltip" className="map-tooltip" transform={`translate(${tooltip.x} ${tooltip.y})`} pointerEvents="none">
          <rect width="172" height="58" rx="4" />
          <text x="8" y="18">{tooltip.city}, {tooltip.state}</text>
          <text x="8" y="34">Volume {tooltip.volume?.toLocaleString() ?? 'Unknown'} - CPC {tooltip.cpc === null ? 'Unknown' : `$${tooltip.cpc.toFixed(2)}`}</text>
          <text x="8" y="50">{statusLabels[tooltip.status]} status</text>
        </g>}
      </svg>
    </section>
  );
}
