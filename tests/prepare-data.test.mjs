import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  buildDataset,
  findUnmatchedMetrics,
  normalizePlaceKey,
  parseCensusCountySubdivisions,
  parseCensusPlaces,
  parseMetricCsv
} from '../scripts/prepare-data.mjs';

const censusFixture = [
  'GEOID|ANSICODE|NAME|LSAD|FUNCSTAT|ALAND|AWATER|ALAND_SQMI|AWATER_SQMI|INTPTLAT|INTPTLONG',
  '3401234|123|Woodbridge township|25|A|0|0|0|0|40.5600|-74.2900',
  '0605678|456|Irvine city|25|A|0|0|0|0|33.6846|-117.8265',
  '7254321|789|San Juan municipio|25|A|0|0|0|0|18.4655|-66.1057'
].join('\n');

const countySubdivisionFixture = [
  'USPS|GEOID|GEOIDFQ|ANSICODE|NAME|FUNCSTAT|ALAND|AWATER|ALAND_SQMI|AWATER_SQMI|INTPTLAT|INTPTLONG',
  'NJ|3402320230|0600000US3402320230|00882166|Edison township|A|0|0|0|0|40.504396|-74.348843'
].join('\n');

describe('parseMetricCsv', () => {
  it('parses numeric values and blank CPC as null', () => {
    const metrics = parseMetricCsv([
      'City,State,Total Search Volume,Average CPC',
      'Irvine,California,450,96.86',
      'Henderson,Nevada,2450,'
    ].join('\n'));

    expect(metrics).toEqual([
      { city: 'Irvine', state: 'California', totalSearchVolume: 450, averageCpcUsd: 96.86 },
      { city: 'Henderson', state: 'Nevada', totalSearchVolume: 2450, averageCpcUsd: null }
    ]);
  });

  it('rejects invalid and negative metric values', () => {
    expect(() => parseMetricCsv([
      'City,State,Total Search Volume,Average CPC',
      'Irvine,California,-1,96.86'
    ].join('\n'))).toThrow('Invalid total search volume');

    expect(() => parseMetricCsv([
      'City,State,Total Search Volume,Average CPC',
      'Irvine,California,450,-1'
    ].join('\n'))).toThrow('Invalid average CPC');
  });
});

describe('parseCensusPlaces', () => {
  it('parses pipe-delimited rows and excludes Puerto Rico', () => {
    expect(parseCensusPlaces(censusFixture)).toEqual([
      {
        placeId: '3401234',
        city: 'Woodbridge Township',
        state: 'New Jersey',
        stateCode: 'NJ',
        latitude: 40.56,
        longitude: -74.29
      },
      {
        placeId: '0605678',
        city: 'Irvine',
        state: 'California',
        stateCode: 'CA',
        latitude: 33.6846,
        longitude: -117.8265
      }
    ]);
  });

  it('rejects invalid Census coordinates', () => {
    expect(() => parseCensusPlaces(censusFixture.replace('33.6846', '93')))
      .toThrow('Invalid Census coordinates');
  });
});

describe('parseCensusCountySubdivisions', () => {
  it('parses an official township fallback for researched markets', () => {
    expect(parseCensusCountySubdivisions(countySubdivisionFixture)).toEqual([
      {
        placeId: '3402320230',
        city: 'Edison Township',
        state: 'New Jersey',
        stateCode: 'NJ',
        latitude: 40.504396,
        longitude: -74.348843
      }
    ]);
  });
});

describe('place matching', () => {
  it('normalizes names and resolves the verified Woodbridge alias', () => {
    expect(normalizePlaceKey('Woodbridge', 'New Jersey')).toBe('woodbridge township|NJ');
  });

  it('resolves verified aliases for Census place naming differences', () => {
    expect(normalizePlaceKey('Augusta', 'Georgia')).toBe('augusta richmond county consolidated government balance|GA');
    expect(normalizePlaceKey('Honolulu', 'Hawaii')).toBe('urban honolulu|HI');
    expect(normalizePlaceKey('Boise', 'Idaho')).toBe('boise city|ID');
    expect(normalizePlaceKey('Saint Paul', 'Minnesota')).toBe('st paul|MN');
    expect(normalizePlaceKey('Ventura', 'California')).toBe('san buenaventura ventura|CA');
  });

  it('normalizes official Census punctuation to the same verified alias key', () => {
    expect(normalizePlaceKey(
      'Augusta-Richmond County consolidated government (balance)',
      'Georgia'
    )).toBe('augusta richmond county consolidated government balance|GA');
    expect(normalizePlaceKey('San Buenaventura (Ventura)', 'California'))
      .toBe('san buenaventura ventura|CA');
  });

  it('rejects duplicate, invalid, and unmatched metric rows', () => {
    const places = parseCensusPlaces(censusFixture);

    expect(() => buildDataset([
      { city: 'Irvine', state: 'California', totalSearchVolume: 1, averageCpcUsd: null },
      { city: 'Irvine', state: 'California', totalSearchVolume: 2, averageCpcUsd: null }
    ], places)).toThrow('Duplicate metric city/state key');

    expect(() => buildDataset([
      { city: 'Irvine', state: 'California', totalSearchVolume: -1, averageCpcUsd: null }
    ], places)).toThrow('Invalid total search volume');

    expect(() => buildDataset([
      { city: 'Unknown', state: 'California', totalSearchVolume: 1, averageCpcUsd: null }
    ], places)).toThrow('Unmatched researched city');
  });

  it('uses the verified place selection for duplicate city names', () => {
    const metrics = [{ city: 'Mesquite', state: 'Texas', totalSearchVolume: 80, averageCpcUsd: null }];
    const places = [
      { placeId: '4847892', city: 'Mesquite', state: 'Texas', stateCode: 'TX', latitude: 32.75955, longitude: -96.584164 },
      { placeId: '4847898', city: 'Mesquite', state: 'Texas', stateCode: 'TX', latitude: 26.402434, longitude: -98.980938 }
    ];

    expect(buildDataset(metrics, places)).toMatchObject([{ placeId: '4847892' }]);
  });

  it('uses the verified township geography for Woodbridge, New Jersey', () => {
    const metrics = [{ city: 'Woodbridge', state: 'New Jersey', totalSearchVolume: 90, averageCpcUsd: null }];
    const places = [
      { placeId: '3481950', city: 'Woodbridge', state: 'New Jersey', stateCode: 'NJ', latitude: 40.552857, longitude: -74.286939 },
      { placeId: '3402382000', city: 'Woodbridge Township', state: 'New Jersey', stateCode: 'NJ', latitude: 40.561262, longitude: -74.292377 }
    ];

    expect(buildDataset(metrics, places)).toMatchObject([{ placeId: '3402382000', city: 'Woodbridge' }]);
  });

  it('supplements unmatched researched cities with official county subdivisions', () => {
    const metrics = [{ city: 'Edison', state: 'New Jersey', totalSearchVolume: 610, averageCpcUsd: 71.2 }];
    const places = parseCensusPlaces(censusFixture);
    const countySubdivisions = parseCensusCountySubdivisions(countySubdivisionFixture);

    expect(findUnmatchedMetrics(metrics, places)).toEqual(metrics);
    expect(findUnmatchedMetrics(metrics, [...places, ...countySubdivisions])).toEqual([]);
    expect(buildDataset(metrics, [...places, ...countySubdivisions])).toEqual([
      {
        placeId: '3402320230',
        city: 'Edison',
        state: 'New Jersey',
        stateCode: 'NJ',
        totalSearchVolume: 610,
        averageCpcUsd: 71.2,
        latitude: 40.504396,
        longitude: -74.348843
      }
    ]);
  });
});

describe('generated data', () => {
  const projectRoot = fileURLToPath(new URL('..', import.meta.url));

  it('contains the validated data and exact metadata', async () => {
    const [metricsFile, metadataFile] = await Promise.all([
      readFile(new URL('../src/data/cityMetrics.json', import.meta.url), 'utf8'),
      readFile(new URL('../src/data/datasetMetadata.json', import.meta.url), 'utf8')
    ]);
    const metrics = JSON.parse(metricsFile);
    const metadata = JSON.parse(metadataFile);

    expect(projectRoot).toBeTruthy();
    expect(metrics).toHaveLength(345);
    expect(new Set(metrics.map((metric) => `${metric.city}|${metric.state}`)).size).toBe(345);
    expect(metrics.every((metric) => Number.isFinite(metric.latitude) && Number.isFinite(metric.longitude))).toBe(true);
    expect(metrics.filter((metric) => metric.averageCpcUsd !== null)).toHaveLength(197);
    expect(metadata).toEqual({
      refreshedAt: '2026-07-10',
      cpcThresholdUsd: 60,
      volumeThreshold: 600,
      keywordCount: 144,
      sourceLabel: 'Google Ads Keyword Planner historical metrics',
      methodology: 'Total search volume is the sum across the 144 keyword variants and average CPC is the average of each keyword\'s low/high top-of-page bid midpoint where bid data exists.'
    });
  });
});
