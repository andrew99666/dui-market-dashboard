import AdmZip from 'adm-zip';
import { parse } from 'csv-parse/sync';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CENSUS_GAZETTEER_BASE_URL = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer';
const CENSUS_ARCHIVE_URL = `${CENSUS_GAZETTEER_BASE_URL}/2025_Gaz_place_national.zip`;

const STATES_BY_FIPS = {
  '01': ['Alabama', 'AL'], '02': ['Alaska', 'AK'], '04': ['Arizona', 'AZ'], '05': ['Arkansas', 'AR'],
  '06': ['California', 'CA'], '08': ['Colorado', 'CO'], '09': ['Connecticut', 'CT'], '10': ['Delaware', 'DE'],
  '11': ['District of Columbia', 'DC'], '12': ['Florida', 'FL'], '13': ['Georgia', 'GA'], '15': ['Hawaii', 'HI'],
  '16': ['Idaho', 'ID'], '17': ['Illinois', 'IL'], '18': ['Indiana', 'IN'], '19': ['Iowa', 'IA'],
  '20': ['Kansas', 'KS'], '21': ['Kentucky', 'KY'], '22': ['Louisiana', 'LA'], '23': ['Maine', 'ME'],
  '24': ['Maryland', 'MD'], '25': ['Massachusetts', 'MA'], '26': ['Michigan', 'MI'], '27': ['Minnesota', 'MN'],
  '28': ['Mississippi', 'MS'], '29': ['Missouri', 'MO'], '30': ['Montana', 'MT'], '31': ['Nebraska', 'NE'],
  '32': ['Nevada', 'NV'], '33': ['New Hampshire', 'NH'], '34': ['New Jersey', 'NJ'], '35': ['New Mexico', 'NM'],
  '36': ['New York', 'NY'], '37': ['North Carolina', 'NC'], '38': ['North Dakota', 'ND'], '39': ['Ohio', 'OH'],
  '40': ['Oklahoma', 'OK'], '41': ['Oregon', 'OR'], '42': ['Pennsylvania', 'PA'], '44': ['Rhode Island', 'RI'],
  '45': ['South Carolina', 'SC'], '46': ['South Dakota', 'SD'], '47': ['Tennessee', 'TN'], '48': ['Texas', 'TX'],
  '49': ['Utah', 'UT'], '50': ['Vermont', 'VT'], '51': ['Virginia', 'VA'], '53': ['Washington', 'WA'],
  '54': ['West Virginia', 'WV'], '55': ['Wisconsin', 'WI'], '56': ['Wyoming', 'WY']
};

const STATE_CODES_BY_NAME = Object.fromEntries(
  Object.values(STATES_BY_FIPS).map(([name, code]) => [name.toLowerCase(), code])
);
const STATES_BY_CODE = Object.fromEntries(
  Object.entries(STATES_BY_FIPS).map(([fips, [name, code]]) => [code, { fips, name }])
);

const VERIFIED_ALIASES = {
  'woodbridge|NJ': 'woodbridge township|NJ',
  'edison|NJ': 'edison township|NJ',
  'augusta|GA': 'augusta richmond county consolidated government balance|GA',
  'honolulu|HI': 'urban honolulu|HI',
  'macon|GA': 'macon bibb county|GA',
  'lexington|KY': 'lexington fayette urban county|KY',
  'athens|GA': 'athens clarke county unified government balance|GA',
  'boise|ID': 'boise city|ID',
  'indianapolis|IN': 'indianapolis city balance|IN',
  'saint paul|MN': 'st paul|MN',
  'nashville|TN': 'nashville davidson metropolitan government balance|TN',
  'anchorage|AK': 'anchorage municipality|AK',
  'ventura|CA': 'san buenaventura ventura|CA'
};

const VERIFIED_PLACE_IDS = {
  'woodbridge township|NJ': '3402382000',
  'mesquite|TX': '4847892',
  'burbank|CA': '0608954',
  'plantation|FL': '1257425'
};

export function normalizePlaceKey(city, state) {
  const stateCode = STATE_CODES_BY_NAME[state.trim().toLowerCase()] ?? state.trim().toUpperCase();
  const normalizedCity = city
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const key = `${normalizedCity}|${stateCode}`;
  return VERIFIED_ALIASES[key] ?? key;
}

export function parseMetricCsv(text) {
  return parse(text, { bom: true, columns: true, skip_empty_lines: true, trim: true }).map((row) => {
    const city = row.City?.trim();
    const state = row.State?.trim();
    const totalSearchVolume = Number(row['Total Search Volume']);
    const cpcValue = row['Average CPC'];
    const averageCpcUsd = cpcValue === '' || cpcValue == null ? null : Number(cpcValue);

    if (!city || !state) throw new Error('Metric city and state are required');
    if (!Number.isFinite(totalSearchVolume) || totalSearchVolume < 0) {
      throw new Error(`Invalid total search volume for ${city}, ${state}`);
    }
    if (averageCpcUsd !== null && (!Number.isFinite(averageCpcUsd) || averageCpcUsd < 0)) {
      throw new Error(`Invalid average CPC for ${city}, ${state}`);
    }

    return { city, state, totalSearchVolume, averageCpcUsd };
  });
}

export function parseCensusPlaces(text) {
  return parse(text, { bom: true, columns: true, delimiter: '|', skip_empty_lines: true, trim: true })
    .flatMap((row) => {
      const stateInfo = STATES_BY_FIPS[row.GEOID?.slice(0, 2)];
      if (!stateInfo) return [];

      const latitude = Number(row.INTPTLAT);
      const longitude = Number(row.INTPTLONG);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
        throw new Error(`Invalid Census coordinates for ${row.NAME}`);
      }

      const city = row.NAME
        .trim()
        .replace(/\s+(city|town|village|borough|municipio|CDP|census designated place|unified government|metro government)$/i, '')
        .replace(/\btownship$/i, 'Township');
      if (!city || !row.GEOID) throw new Error('Invalid Census place row');

      const [state, stateCode] = stateInfo;
      return [{ placeId: row.GEOID, city, state, stateCode, latitude, longitude }];
    });
}

export function parseCensusCountySubdivisions(text) {
  return parse(text, { bom: true, columns: true, delimiter: '|', skip_empty_lines: true, trim: true })
    .flatMap((row) => {
      const stateInfo = STATES_BY_CODE[row.USPS];
      if (!stateInfo) return [];

      const latitude = Number(row.INTPTLAT);
      const longitude = Number(row.INTPTLONG);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
        throw new Error(`Invalid Census coordinates for ${row.NAME}`);
      }

      const city = row.NAME.trim().replace(/\btownship$/i, 'Township');
      if (!city || !row.GEOID) throw new Error('Invalid Census county subdivision row');

      return [{
        placeId: row.GEOID,
        city,
        state: stateInfo.name,
        stateCode: row.USPS,
        latitude,
        longitude
      }];
    });
}

export function findUnmatchedMetrics(metrics, places) {
  const placeKeys = new Set(places.map((place) => normalizePlaceKey(place.city, place.state)));
  return metrics.filter((metric) => !placeKeys.has(normalizePlaceKey(metric.city, metric.state)));
}

export function buildDataset(metrics, places) {
  const placesByKey = new Map();
  for (const place of places) {
    if (!Number.isFinite(place.latitude) || !Number.isFinite(place.longitude) || Math.abs(place.latitude) > 90 || Math.abs(place.longitude) > 180) {
      throw new Error(`Invalid Census coordinates for ${place.city}`);
    }
    const key = normalizePlaceKey(place.city, place.state);
    const matches = placesByKey.get(key) ?? [];
    matches.push(place);
    placesByKey.set(key, matches);
  }

  const metricKeys = new Set();
  return metrics.map((metric) => {
    if (!Number.isFinite(metric.totalSearchVolume) || metric.totalSearchVolume < 0) {
      throw new Error(`Invalid total search volume for ${metric.city}, ${metric.state}`);
    }
    if (metric.averageCpcUsd !== null && (!Number.isFinite(metric.averageCpcUsd) || metric.averageCpcUsd < 0)) {
      throw new Error(`Invalid average CPC for ${metric.city}, ${metric.state}`);
    }

    const key = normalizePlaceKey(metric.city, metric.state);
    if (metricKeys.has(key)) throw new Error(`Duplicate metric city/state key: ${key}`);
    metricKeys.add(key);

    const matches = placesByKey.get(key) ?? [];
    if (matches.length === 0) throw new Error(`Unmatched researched city: ${metric.city}, ${metric.state}`);
    const place = VERIFIED_PLACE_IDS[key]
      ? matches.find((match) => match.placeId === VERIFIED_PLACE_IDS[key])
      : matches.length === 1 ? matches[0] : undefined;
    if (!place) throw new Error(`Ambiguous Census place: ${metric.city}, ${metric.state}`);
    return {
      placeId: place.placeId,
      city: metric.city,
      state: metric.state,
      stateCode: place.stateCode,
      totalSearchVolume: metric.totalSearchVolume,
      averageCpcUsd: metric.averageCpcUsd,
      latitude: place.latitude,
      longitude: place.longitude
    };
  });
}

async function loadCountySubdivisionFallbacks(metrics, places, cacheDirectory) {
  const stateCodes = [...new Set(findUnmatchedMetrics(metrics, places).map((metric) => (
    normalizePlaceKey(metric.city, metric.state).split('|')[1]
  )))];

  const fallbackGroups = await Promise.all(stateCodes.map(async (stateCode) => {
    const stateInfo = STATES_BY_CODE[stateCode];
    if (!stateInfo) throw new Error(`Unknown state code for county subdivision fallback: ${stateCode}`);
    const fileName = `2025_gaz_cousubs_${stateInfo.fips}.txt`;
    const cachePath = path.join(cacheDirectory, fileName);
    if (!existsSync(cachePath)) {
      const response = await fetch(`${CENSUS_GAZETTEER_BASE_URL}/${fileName}`);
      if (!response.ok) {
        throw new Error(`Unable to download Census county subdivisions for ${stateCode}: ${response.status}`);
      }
      await writeFile(cachePath, Buffer.from(await response.arrayBuffer()));
    }
    return parseCensusCountySubdivisions(await readFile(cachePath, 'utf8'));
  }));

  return fallbackGroups.flat();
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const projectRoot = path.resolve(path.dirname(scriptPath), '..');
  const refreshedAtIndex = process.argv.indexOf('--refreshed-at');
  const refreshedAt = refreshedAtIndex === -1
    ? new Date().toISOString().slice(0, 10)
    : process.argv[refreshedAtIndex + 1];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(refreshedAt ?? '')) throw new Error('Expected --refreshed-at YYYY-MM-DD');

  const cacheDirectory = path.join(projectRoot, '.cache', 'data');
  const archivePath = path.join(cacheDirectory, '2025_Gaz_place_national.zip');
  if (!existsSync(archivePath)) {
    await mkdir(cacheDirectory, { recursive: true });
    const response = await fetch(CENSUS_ARCHIVE_URL);
    if (!response.ok) throw new Error(`Unable to download Census archive: ${response.status}`);
    await writeFile(archivePath, Buffer.from(await response.arrayBuffer()));
  }

  const archive = new AdmZip(archivePath);
  const censusEntry = archive.getEntries().find((entry) => entry.entryName.endsWith('_Gaz_place_national.txt'));
  if (!censusEntry) throw new Error('Census archive does not contain the national Places file');

  const [metricsText, censusText] = await Promise.all([
    readFile(path.join(projectRoot, 'data', 'source', 'city-metrics.csv'), 'utf8'),
    Promise.resolve(censusEntry.getData().toString('utf8'))
  ]);
  const places = parseCensusPlaces(censusText);
  const metricRows = parseMetricCsv(metricsText);
  const countySubdivisionFallbacks = await loadCountySubdivisionFallbacks(
    metricRows,
    places,
    cacheDirectory
  );
  const cityMetrics = buildDataset(metricRows, [...places, ...countySubdivisionFallbacks]);
  const metadata = {
    refreshedAt,
    cpcThresholdUsd: 60,
    volumeThreshold: 600,
    keywordCount: 144,
    sourceLabel: 'Google Ads Keyword Planner historical metrics',
    methodology: "Total search volume is the sum across the 144 keyword variants and average CPC is the average of each keyword's low/high top-of-page bid midpoint where bid data exists."
  };
  const outputDirectory = path.join(projectRoot, 'src', 'data');
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(path.join(outputDirectory, 'cityMetrics.json'), `${JSON.stringify(cityMetrics, null, 2)}\n`),
    writeFile(path.join(outputDirectory, 'usPlaces.json'), `${JSON.stringify(places, null, 2)}\n`),
    writeFile(path.join(outputDirectory, 'datasetMetadata.json'), `${JSON.stringify(metadata, null, 2)}\n`)
  ]);
}
