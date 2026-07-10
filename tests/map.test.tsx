// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import metadata from '../src/data/datasetMetadata.json';
import metrics from '../src/data/cityMetrics.json';
import { classifyCity } from '../src/dashboard-domain';
import type { CityMetric, UsPlace } from '../src/data/types';
import { UsMap } from '../src/components/UsMap';

const researchedMetrics = metrics as CityMetric[];

afterEach(cleanup);

describe('UsMap', () => {
  it('renders state geometry, including Alaska and Hawaii, and all researched markers', () => {
    render(<UsMap metrics={researchedMetrics} metadata={metadata} onSelect={() => undefined} />);

    expect(screen.getByTestId('us-map').querySelectorAll('[data-state-geometry]')).toHaveLength(51);
    expect(screen.getByTestId('us-map').querySelector('[data-state-id="02"]')).toBeTruthy();
    expect(screen.getByTestId('us-map').querySelector('[data-state-id="15"]')).toBeTruthy();
    expect(screen.getByTestId('us-map').querySelectorAll('[data-marker]')).toHaveLength(345);
  });

  it('maps each researched status to its required marker shape and toggles each legend category', () => {
    render(<UsMap metrics={researchedMetrics} metadata={metadata} onSelect={() => undefined} />);

    const map = screen.getByTestId('us-map');
    expect(map.querySelector('[data-status="qualified"]')?.getAttribute('data-shape')).toBe('circle');
    expect(map.querySelector('[data-status="high-cpc"]')?.getAttribute('data-shape')).toBe('diamond');
    expect(map.querySelector('[data-status="unknown-cpc"]')?.getAttribute('data-shape')).toBe('triangle');
    expect(map.querySelector('[data-status="low-volume"]')?.getAttribute('data-shape')).toBe('square');

    const before = map.querySelectorAll('[data-marker]').length;
    fireEvent.click(screen.getByRole('button', { name: 'Toggle qualified markers' }));
    expect(map.querySelectorAll('[data-marker]').length).toBe(before - researchedMetrics.filter((metric) => classifyCity(metric, metadata) === 'qualified').length);
    fireEvent.click(screen.getByRole('button', { name: 'Toggle high cpc markers' }));
    expect(map.querySelectorAll('[data-marker]').length).toBe(before - researchedMetrics.filter((metric) => ['qualified', 'high-cpc'].includes(classifyCity(metric, metadata))).length);
    fireEvent.click(screen.getByRole('button', { name: 'Toggle unknown-cpc markers' }));
    expect(map.querySelectorAll('[data-marker]').length).toBe(before - researchedMetrics.filter((metric) => ['qualified', 'high-cpc', 'unknown-cpc'].includes(classifyCity(metric, metadata))).length);
    fireEvent.click(screen.getByRole('button', { name: 'Toggle low-volume markers' }));
    expect(map.querySelectorAll('[data-marker]').length).toBe(0);
  });

  it('shows an accessible tooltip on focus and selects a marker with the keyboard', () => {
    const selected: CityMetric[] = [];
    render(<UsMap metrics={researchedMetrics} metadata={metadata} onSelect={(metric) => selected.push(metric)} />);

    const marker = screen.getByRole('button', { name: /Springfield, Illinois.*Volume.*CPC.*status/i });
    fireEvent.focus(marker);
    expect(screen.getByRole('tooltip').textContent).toMatch(/Springfield, Illinois.*Volume.*CPC.*status/i);

    fireEvent.keyDown(marker, { key: 'Enter' });
    expect(selected).toHaveLength(1);
    expect(selected[0].city).toBe('Springfield');
    expect(selected[0].state).toBe('Illinois');
  });

  it('focuses shared researched selection at four times the national scale and adds an unresearched marker', () => {
    const researched = researchedMetrics.find((metric) => metric.city === 'Springfield' && metric.state === 'Illinois')!;
    const unresearched: UsPlace = { placeId: '99999', city: 'Test place', state: 'Illinois', stateCode: 'IL', latitude: 40.1, longitude: -89.3 };
    const { rerender } = render(<UsMap metrics={researchedMetrics} metadata={metadata} selected={researched} onSelect={() => undefined} />);

    expect(screen.getByTestId('us-map').getAttribute('data-zoom-scale')).toBe('4');
    rerender(<UsMap metrics={researchedMetrics} metadata={metadata} selected={unresearched} onSelect={() => undefined} />);
    expect(screen.getByTestId('us-map').getAttribute('data-zoom-scale')).toBe('4');
    expect(screen.getByTestId('us-map').querySelectorAll('[data-marker="no-data"]')).toHaveLength(1);
  });

  it('resets the transform without clearing the selected place', () => {
    const selected = researchedMetrics[0];
    render(<UsMap metrics={researchedMetrics} metadata={metadata} selected={selected} onSelect={() => undefined} />);

    fireEvent.click(screen.getByRole('button', { name: 'Reset map view' }));
    expect(screen.getByTestId('us-map').getAttribute('data-zoom-scale')).toBe('1');
    expect(screen.getByTestId('us-map').querySelector(`[data-place-id="${selected.placeId}"]`)).toBeTruthy();
  });

  it('uses no external map URL', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/UsMap.tsx'), 'utf8');

    expect(source).not.toMatch(/https?:\/\//);
  });
});
