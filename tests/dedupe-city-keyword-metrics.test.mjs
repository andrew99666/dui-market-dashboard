import { describe, expect, it } from 'vitest';

import {
  aggregateCityMetrics,
  deduplicateKeywordMetrics
} from '../scripts/dedupe-city-keyword-metrics.mjs';

function raw(overrides = {}) {
  return {
    city: 'Phoenix',
    state: 'Arizona',
    keyword: 'dui attorney',
    avgMonthlySearches: 100,
    lowBidMicros: 1000000,
    highBidMicros: 3000000,
    ...overrides
  };
}

describe('deduplicateKeywordMetrics', () => {
  it('retains one same-city metric fingerprint and records the removed keyword', () => {
    const audit = deduplicateKeywordMetrics([
      raw({ keyword: 'dui attorney near me', avgMonthlySearches: 5000, lowBidMicros: 10000000, highBidMicros: 30000000 }),
      raw({ keyword: 'dui lawyer near me', avgMonthlySearches: 5000, lowBidMicros: 10000000, highBidMicros: 30000000 }),
      raw({ keyword: 'dui attorney Phoenix', avgMonthlySearches: 800, lowBidMicros: 8000000, highBidMicros: 20000000 }),
    ]);

    expect(audit.filter((row) => row.retained)).toHaveLength(2);
    expect(audit.find((row) => row.keyword === 'dui lawyer near me')).toMatchObject({
      retained: false,
      duplicateOfKeyword: 'dui attorney near me',
    });
  });

  it('does not merge identical metrics from different cities and retains one null-CPC fingerprint', () => {
    const audit = deduplicateKeywordMetrics([
      raw({ city: 'Phoenix', keyword: 'a', avgMonthlySearches: 10, lowBidMicros: null, highBidMicros: null }),
      raw({ city: 'Phoenix', keyword: 'b', avgMonthlySearches: 10, lowBidMicros: null, highBidMicros: null }),
      raw({ city: 'Mesa', keyword: 'a', avgMonthlySearches: 10, lowBidMicros: null, highBidMicros: null }),
    ]);

    expect(audit.filter((row) => row.retained)).toHaveLength(2);
  });
});

describe('aggregateCityMetrics', () => {
  it('sums retained volume and averages only retained known CPC midpoints', () => {
    const city = aggregateCityMetrics(deduplicateKeywordMetrics([
      raw({ avgMonthlySearches: 10, lowBidMicros: 1000000, highBidMicros: 3000000 }),
      raw({ keyword: 'duplicate', avgMonthlySearches: 10, lowBidMicros: 1000000, highBidMicros: 3000000 }),
      raw({ keyword: 'unknown', avgMonthlySearches: 7, lowBidMicros: null, highBidMicros: null }),
    ]));

    expect(city).toEqual([{ City: 'Phoenix', State: 'Arizona', 'Total Search Volume': 17, 'Average CPC': 2 }]);
  });
});
