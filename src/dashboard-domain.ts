import type { CityMetric, DatasetMetadata, UsPlace } from './data/types';

export type CityStatus = 'qualified' | 'high-cpc' | 'unknown-cpc' | 'low-volume' | 'no-data';
export type SortColumn = 'city' | 'state' | 'totalSearchVolume' | 'averageCpcUsd';

export interface SearchSuggestion extends UsPlace {
  source: 'researched' | 'census';
  metric?: CityMetric;
}

export interface TableOptions {
  query?: string;
  state?: string;
  status?: CityStatus | 'all';
  sort?: { column: SortColumn; direction: 'asc' | 'desc' };
  page?: number;
  pageSize?: number;
}

export function classifyCity(metric: CityMetric | undefined, metadata: DatasetMetadata): CityStatus {
  if (!metric) return 'no-data';
  if (metric.averageCpcUsd === null) return 'unknown-cpc';
  if (metric.averageCpcUsd > metadata.cpcThresholdUsd) return 'high-cpc';
  return metric.totalSearchVolume >= metadata.volumeThreshold ? 'qualified' : 'low-volume';
}

export function getStatusCounts(metrics: CityMetric[], metadata: DatasetMetadata): Record<Exclude<CityStatus, 'no-data'>, number> {
  return metrics.reduce<Record<Exclude<CityStatus, 'no-data'>, number>>(
    (counts, metric) => {
      const status = classifyCity(metric, metadata);
      if (status !== 'no-data') counts[status] += 1;
      return counts;
    },
    { qualified: 0, 'high-cpc': 0, 'unknown-cpc': 0, 'low-volume': 0 },
  );
}

export function getKnownCpcMedian(metrics: CityMetric[]): number {
  const values = metrics
    .flatMap(({ averageCpcUsd }) => averageCpcUsd === null ? [] : [averageCpcUsd])
    .sort((left, right) => left - right);
  const middle = Math.floor(values.length / 2);
  const median = values.length % 2 === 0 ? (values[middle - 1] + values[middle]) / 2 : values[middle];
  return Number(median.toFixed(2));
}

export function getSelectedCityComparison(selected: CityMetric | undefined, metrics: CityMetric[]): number | null {
  if (!selected || selected.averageCpcUsd === null) return null;
  const others = metrics.filter(({ placeId, averageCpcUsd }) => placeId !== selected.placeId && averageCpcUsd !== null);
  if (!others.length) return null;
  const higherCount = others.filter(({ averageCpcUsd }) => averageCpcUsd! > selected.averageCpcUsd!).length;
  return Math.round((higherCount / others.length) * 100);
}

export function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

function matchesSearch(place: UsPlace, query: string): boolean {
  const haystack = normalizeSearch(`${place.city} ${place.state} ${place.stateCode}`);
  return haystack.includes(query);
}

export function createSearchSuggestions(query: string, metrics: CityMetric[], places: UsPlace[]): SearchSuggestion[] {
  const normalized = normalizeSearch(query);
  if (!normalized) return [];
  const researchedIds = new Set(metrics.map(({ placeId }) => placeId));
  const researchedCityStates = new Set(metrics.map(cityStateKey));
  const researched = metrics
    .filter((city) => matchesSearch(city, normalized))
    .map((metric) => ({ ...metric, source: 'researched' as const, metric }))
    .sort(byPlaceName);
  const seenCensusCityStates = new Set<string>();
  const census = places
    .filter((place) => !researchedIds.has(place.placeId) && !researchedCityStates.has(cityStateKey(place)) && matchesSearch(place, normalized))
    .map((place) => ({ ...place, source: 'census' as const }))
    .sort(byPlaceName)
    .filter((place) => {
      const key = cityStateKey(place);
      if (seenCensusCityStates.has(key)) return false;
      seenCensusCityStates.add(key);
      return true;
    });
  return [...researched, ...census].slice(0, 12);
}

function byPlaceName(left: UsPlace, right: UsPlace): number {
  return left.city.localeCompare(right.city) || left.state.localeCompare(right.state) || left.placeId.localeCompare(right.placeId);
}

function cityStateKey(place: UsPlace): string {
  const city = normalizeSearch(place.city).replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  return `${city}|${place.stateCode.trim().toUpperCase()}`;
}

export function getTablePage(metrics: CityMetric[], metadata: DatasetMetadata, options: TableOptions = {}) {
  const query = normalizeSearch(options.query ?? '');
  const state = options.state ?? 'all';
  const status = options.status ?? 'all';
  const sort = options.sort ?? { column: 'totalSearchVolume' as const, direction: 'desc' as const };
  const pageSize = options.pageSize ?? 25;
  const filtered = metrics.filter((metric) => {
    const matchesQuery = !query || normalizeSearch(metric.city).includes(query);
    return matchesQuery && (state === 'all' || metric.stateCode === state)
      && (status === 'all' || classifyCity(metric, metadata) === status);
  }).sort((left, right) => compareMetrics(left, right, sort));
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(Math.max(options.page ?? 1, 1), pageCount);
  const start = (page - 1) * pageSize;
  return { rows: filtered.slice(start, start + pageSize), total: filtered.length, page, pageCount };
}

function compareMetrics(left: CityMetric, right: CityMetric, sort: Required<TableOptions>['sort']): number {
  const multiplier = sort.direction === 'asc' ? 1 : -1;
  if (sort.column === 'city' || sort.column === 'state') {
    return (left[sort.column].localeCompare(right[sort.column]) || left.placeId.localeCompare(right.placeId)) * multiplier;
  }
  if (sort.column === 'averageCpcUsd') {
    if (left.averageCpcUsd === null) return right.averageCpcUsd === null ? 0 : 1;
    if (right.averageCpcUsd === null) return -1;
    return (left.averageCpcUsd - right.averageCpcUsd) * multiplier;
  }
  return (left.totalSearchVolume - right.totalSearchVolume) * multiplier;
}
