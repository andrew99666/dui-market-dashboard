import { parse } from 'csv-parse/sync';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MICRO_UNITS_PER_USD = 1000000;

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function byCityAndKeyword(left, right) {
  return compareText(left.city, right.city)
    || compareText(left.state, right.state)
    || compareText(left.keyword, right.keyword);
}

export function metricFingerprint(row) {
  return [row.avgMonthlySearches, row.lowBidMicros ?? 'null', row.highBidMicros ?? 'null'].join('|');
}

export function deduplicateKeywordMetrics(rows) {
  const retainedByCityAndFingerprint = new Map();
  return [...rows].sort(byCityAndKeyword).map((row) => {
    const fingerprint = metricFingerprint(row);
    const key = [row.city, row.state, fingerprint].join('|');
    const retained = retainedByCityAndFingerprint.get(key);
    if (retained) return { ...row, fingerprint, retained: false, duplicateOfKeyword: retained.keyword };

    const auditRow = { ...row, fingerprint, retained: true, duplicateOfKeyword: '' };
    retainedByCityAndFingerprint.set(key, auditRow);
    return auditRow;
  });
}

export function aggregateCityMetrics(auditRows) {
  const cities = new Map();
  for (const row of auditRows) {
    if (!row.retained) continue;

    const key = [row.city, row.state].join('|');
    const city = cities.get(key) ?? {
      City: row.city,
      State: row.state,
      totalSearchVolume: 0,
      totalCpc: 0,
      knownCpcCount: 0
    };
    city.totalSearchVolume += row.avgMonthlySearches;
    if (row.lowBidMicros !== null && row.highBidMicros !== null) {
      city.totalCpc += (row.lowBidMicros + row.highBidMicros) / 2 / MICRO_UNITS_PER_USD;
      city.knownCpcCount += 1;
    }
    cities.set(key, city);
  }

  return [...cities.values()]
    .sort((left, right) => compareText(left.City, right.City) || compareText(left.State, right.State))
    .map((city) => ({
      City: city.City,
      State: city.State,
      'Total Search Volume': city.totalSearchVolume,
      'Average CPC': city.knownCpcCount === 0 ? null : Number((city.totalCpc / city.knownCpcCount).toFixed(2))
    }));
}

function requiredColumn(row, names, index) {
  const value = names.map((name) => row[name]).find((candidate) => candidate != null && candidate !== '');
  if (value == null) throw new Error(`Missing ${names[0]} in raw row ${index + 2}`);
  return value;
}

function optionalColumn(row, names) {
  return names.map((name) => row[name]).find((candidate) => candidate != null && candidate !== '') ?? null;
}

function numberColumn(row, names, index, required) {
  const value = required ? requiredColumn(row, names, index) : optionalColumn(row, names);
  if (value === null) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Invalid ${names[0]} in raw row ${index + 2}`);
  return number;
}

function parseRawKeywordMetrics(text) {
  return parse(text, { bom: true, columns: true, skip_empty_lines: true, trim: true }).map((row, index) => ({
    city: requiredColumn(row, ['City', 'city'], index),
    state: requiredColumn(row, ['State', 'state'], index),
    stateCode: optionalColumn(row, ['State Code', 'stateCode']),
    googleAdsCode: optionalColumn(row, ['Google Ads Code', 'googleAdsCode']),
    keyword: requiredColumn(row, ['Keyword', 'keyword'], index),
    avgMonthlySearches: numberColumn(row, ['Average Monthly Searches', 'avgMonthlySearches'], index, true),
    lowBidMicros: numberColumn(row, ['Low Top Of Page Bid Micros', 'lowBidMicros'], index, false),
    highBidMicros: numberColumn(row, ['High Top Of Page Bid Micros', 'highBidMicros'], index, false)
  }));
}

function escapeCsv(value) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(headers, rows) {
  return `${[headers.map(([label]) => escapeCsv(label)), ...rows.map((row) => (
    headers.map(([, key]) => escapeCsv(row[key]))
  ))].map((fields) => fields.join(',')).join('\n')}\n`;
}

async function writeOutput(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}

function readOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith('--') || value == null || value.startsWith('--')) {
      throw new Error('Expected --raw, --summary, --audit, --manifest, and --refreshed-at values');
    }
    options[name] = value;
  }
  for (const name of ['--raw', '--summary', '--audit', '--manifest', '--refreshed-at']) {
    if (!options[name]) throw new Error(`Missing required option ${name}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options['--refreshed-at'])) {
    throw new Error('Expected --refreshed-at YYYY-MM-DD');
  }
  return options;
}

async function runCli() {
  const options = readOptions(process.argv.slice(2));
  const rawRows = parseRawKeywordMetrics(await readFile(options['--raw'], 'utf8'));
  const auditRows = deduplicateKeywordMetrics(rawRows);
  const summaryRows = aggregateCityMetrics(auditRows);
  const retainedRecordCount = auditRows.filter((row) => row.retained).length;
  const duplicateRecordCount = auditRows.length - retainedRecordCount;

  await Promise.all([
    writeOutput(options['--summary'], toCsv([
      ['City', 'City'],
      ['State', 'State'],
      ['Total Search Volume', 'Total Search Volume'],
      ['Average CPC', 'Average CPC']
    ], summaryRows)),
    writeOutput(options['--audit'], toCsv([
      ['City', 'city'],
      ['State', 'state'],
      ['State Code', 'stateCode'],
      ['Google Ads Code', 'googleAdsCode'],
      ['Keyword', 'keyword'],
      ['Average Monthly Searches', 'avgMonthlySearches'],
      ['Low Top Of Page Bid Micros', 'lowBidMicros'],
      ['High Top Of Page Bid Micros', 'highBidMicros'],
      ['Fingerprint', 'fingerprint'],
      ['Retained', 'retained'],
      ['Duplicate Of Keyword', 'duplicateOfKeyword']
    ], auditRows)),
    writeOutput(options['--manifest'], `${JSON.stringify({
      refreshedAt: options['--refreshed-at'],
      inputRecordCount: rawRows.length,
      retainedRecordCount,
      duplicateRecordCount,
      cityCount: summaryRows.length,
      methodology: 'Within each city, identical raw average monthly searches and low/high top-of-page bid micros are counted once; average CPC uses retained known bid midpoints.'
    }, null, 2)}\n`)
  ]);
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  await runCli();
}
