import { describe, expect, it } from 'vitest';

import metrics from '../src/data/cityMetrics.json';
import places from '../src/data/usPlaces.json';
import metadata from '../src/data/datasetMetadata.json';
import type { CityMetric } from '../src/data/types';
import {
  classifyCity,
  createSearchSuggestions,
  getKnownCpcMedian,
  getSelectedCityComparison,
  getStatusCounts,
  getTablePage,
  normalizeSearch,
} from '../src/dashboard-domain';

const metric = (overrides: Partial<CityMetric> = {}): CityMetric => ({
  placeId: '0000000',
  city: 'Example',
  state: 'Example State',
  stateCode: 'EX',
  totalSearchVolume: 600,
  averageCpcUsd: 60,
  latitude: 0,
  longitude: 0,
  ...overrides,
});

describe('classifyCity', () => {
  it.each([
    [metric({ averageCpcUsd: null }), 'unknown-cpc'],
    [metric({ averageCpcUsd: 60 }), 'qualified'],
    [metric({ averageCpcUsd: 60.01 }), 'high-cpc'],
    [metric({ totalSearchVolume: 599 }), 'low-volume'],
    [metric({ totalSearchVolume: 600 }), 'qualified'],
    [undefined, 'no-data'],
  ] as const)('classifies CPC and volume boundary values as %s', (city, expected) => {
    expect(classifyCity(city, metadata)).toBe(expected);
  });
});

describe('dashboard aggregates', () => {
  it('returns the expected researched status counts and known-CPC median', () => {
    expect(getStatusCounts(metrics, metadata)).toEqual({
      qualified: 43,
      'high-cpc': 84,
      'unknown-cpc': 148,
      'low-volume': 70,
    });
    expect(getKnownCpcMedian(metrics)).toBe(54.29);
  });

  it('compares a selected city only against other known-CPC cities', () => {
    const selected = metric({ placeId: 'selected', averageCpcUsd: 50 });
    const comparisonSet = [
      selected,
      metric({ placeId: 'higher', averageCpcUsd: 60 }),
      metric({ placeId: 'lower', averageCpcUsd: 40 }),
      metric({ placeId: 'missing', averageCpcUsd: null }),
    ];

    expect(getSelectedCityComparison(selected, comparisonSet)).toBe(50);
    expect(getSelectedCityComparison(metric({ averageCpcUsd: null }), comparisonSet)).toBeNull();
    expect(getSelectedCityComparison(undefined, comparisonSet)).toBeNull();
  });
});

describe('search suggestions', () => {
  it('normalizes case and whitespace', () => {
    expect(normalizeSearch('  NeW   YoRK ')).toBe('new york');
  });

  it('keeps duplicate researched city names as state-specific suggestions', () => {
    const suggestions = createSearchSuggestions('springfield', metrics, places);
    const researched = suggestions.filter((suggestion) => suggestion.source === 'researched');

    expect(researched.map(({ city, state }) => `${city}, ${state}`)).toEqual([
      'Springfield, Illinois',
      'Springfield, Massachusetts',
      'Springfield, Missouri',
    ]);
  });

  it('groups researched cities before Census places and limits results', () => {
    const suggestions = createSearchSuggestions(
      'x',
      [metric({ city: 'Xavier' })],
      [
        { placeId: 'x-1', city: 'Xenia', state: 'Ohio', stateCode: 'OH', latitude: 0, longitude: 0 },
        { placeId: 'x-2', city: 'Xenia Two', state: 'Ohio', stateCode: 'OH', latitude: 0, longitude: 0 },
      ],
    );

    expect(suggestions.map(({ source }) => source)).toEqual(['researched', 'census', 'census']);
  });

  it('keeps researched markets authoritative and collapses duplicate Census city/state labels', () => {
    const burbank = metric({ placeId: 'researched-burbank', city: 'Burbank', state: 'California', stateCode: 'CA' });
    const duplicateBurbankPlaces = [
      { placeId: 'census-burbank-1', city: 'Burbank', state: 'California', stateCode: 'CA', latitude: 34.18, longitude: -118.31 },
      { placeId: 'census-burbank-2', city: 'Burbank', state: 'California', stateCode: 'CA', latitude: 34.19, longitude: -118.32 },
    ];
    const duplicateMountOlivePlaces = [
      { placeId: 'census-mount-olive-1', city: 'Mount Olive', state: 'Alabama', stateCode: 'AL', latitude: 34.46, longitude: -86.88 },
      { placeId: 'census-mount-olive-2', city: 'Mount Olive', state: 'Alabama', stateCode: 'AL', latitude: 34.47, longitude: -86.89 },
    ];

    expect(createSearchSuggestions('burbank', [burbank], duplicateBurbankPlaces)).toMatchObject([
      { placeId: 'researched-burbank', source: 'researched' },
    ]);
    expect(createSearchSuggestions('mount olive', [], duplicateMountOlivePlaces)).toHaveLength(1);
    expect(createSearchSuggestions('springfield', [], [
      { placeId: 'springfield-il', city: 'Springfield', state: 'Illinois', stateCode: 'IL', latitude: 39.8, longitude: -89.6 },
      { placeId: 'springfield-ma', city: 'Springfield', state: 'Massachusetts', stateCode: 'MA', latitude: 42.1, longitude: -72.5 },
    ]).map(({ city, state }) => `${city}, ${state}`)).toEqual([
      'Springfield, Illinois',
      'Springfield, Massachusetts',
    ]);
  });
});

describe('table data', () => {
  it('sorts null CPC values last in both directions', () => {
    const rows = [
      metric({ city: 'Null CPC', averageCpcUsd: null }),
      metric({ city: 'Low CPC', averageCpcUsd: 10 }),
      metric({ city: 'High CPC', averageCpcUsd: 90 }),
    ];

    expect(getTablePage(rows, metadata, { sort: { column: 'averageCpcUsd', direction: 'asc' } }).rows.map(({ city }) => city))
      .toEqual(['Low CPC', 'High CPC', 'Null CPC']);
    expect(getTablePage(rows, metadata, { sort: { column: 'averageCpcUsd', direction: 'desc' } }).rows.map(({ city }) => city))
      .toEqual(['High CPC', 'Low CPC', 'Null CPC']);
  });
});
