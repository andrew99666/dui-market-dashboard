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

    const map = screen.getByTestId('us-map');
    const statePaths = map.querySelectorAll<SVGPathElement>('[data-state-geometry]');
    expect(statePaths).toHaveLength(51);
    expect([...statePaths].every((state) => (state.getAttribute('d')?.length ?? 0) > 0)).toBe(true);
    expect(map.querySelector('[data-state-id="02"]')).toBeTruthy();
    expect(map.querySelector('[data-state-id="15"]')).toBeTruthy();
    expect(map.querySelectorAll('[data-marker]')).toHaveLength(345);
  });

  it('uses the labelled map region instead of an image role that hides marker controls', () => {
    render(<UsMap metrics={researchedMetrics} metadata={metadata} onSelect={() => undefined} />);

    expect(screen.getByRole('region', { name: 'Interactive U.S. city map' })).toBeTruthy();
    expect(screen.getByTestId('us-map').getAttribute('role')).toBeNull();
    expect(screen.getAllByRole('button', { name: /Volume .* status/i })).toHaveLength(345);
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

  it('shows status shape swatches in the legend and an icon-only reset control with a title', () => {
    render(<UsMap metrics={researchedMetrics} metadata={metadata} onSelect={() => undefined} />);

    expect(document.querySelectorAll('[data-testid^="legend-shape-"]')).toHaveLength(4);
    expect(screen.getByTestId('legend-shape-qualified').getAttribute('data-shape')).toBe('circle');
    expect(screen.getByTestId('legend-shape-high-cpc').getAttribute('data-shape')).toBe('diamond');
    expect(screen.getByTestId('legend-shape-unknown-cpc').getAttribute('data-shape')).toBe('triangle');
    expect(screen.getByTestId('legend-shape-low-volume').getAttribute('data-shape')).toBe('square');
    expect(screen.getByTitle('Reset map view').querySelector('svg')).toBeTruthy();
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

  it('shows a tooltip on hover and clamps it inside the map area', () => {
    render(<UsMap metrics={researchedMetrics} metadata={metadata} onSelect={() => undefined} />);

    const map = screen.getByTestId('us-map');
    Object.defineProperty(map, 'getBoundingClientRect', { value: () => ({ left: 0, top: 0, width: 960, height: 600 }) });
    const marker = screen.getByRole('button', { name: /Springfield, Illinois.*Volume.*CPC.*status/i });
    fireEvent.mouseEnter(marker, { clientX: 4000, clientY: 4000 });

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.textContent).toMatch(/Springfield, Illinois.*Volume.*CPC.*status/i);
    expect(tooltip.getAttribute('transform')).toBe('translate(780 534)');
    fireEvent.mouseLeave(marker);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('anchors a focused tooltip to the zoomed marker position', () => {
    const selected = researchedMetrics.find((metric) => metric.city === 'Springfield' && metric.state === 'Illinois')!;
    render(<UsMap metrics={researchedMetrics} metadata={metadata} selected={selected} onSelect={() => undefined} />);

    const map = screen.getByTestId('us-map');
    const marker = map.querySelector(`[data-place-id="${selected.placeId}"]`)!;
    const shape = marker.querySelector('circle, rect, path')!;
    const pointX = shape.tagName === 'rect' ? Number(shape.getAttribute('x')) + Number(shape.getAttribute('width')) / 2 : Number(shape.getAttribute('cx'));
    const pointY = shape.tagName === 'rect' ? Number(shape.getAttribute('y')) + Number(shape.getAttribute('height')) / 2 : Number(shape.getAttribute('cy'));
    const transform = map.querySelector('[data-map-viewport]')?.getAttribute('transform') ?? '';
    const [, translateX, translateY, scale] = transform.match(/translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/) ?? [];

    fireEvent.focus(marker);

    const tooltipTransform = screen.getByRole('tooltip').getAttribute('transform') ?? '';
    const [, tooltipX, tooltipY] = tooltipTransform.match(/translate\(([-\d.]+) ([-\d.]+)\)/) ?? [];
    expect(Number(tooltipX)).toBeCloseTo(Math.min(780, Math.max(8, Number(translateX) + pointX * Number(scale) + 12)));
    expect(Number(tooltipY)).toBeCloseTo(Math.min(534, Math.max(8, Number(translateY) + pointY * Number(scale) + 12)));
  });

  it('focuses shared researched selection at four times the national scale and adds an unresearched marker', () => {
    const researched = researchedMetrics.find((metric) => metric.city === 'Springfield' && metric.state === 'Illinois')!;
    const unresearched: UsPlace = { placeId: '99999', city: 'Test place', state: 'Illinois', stateCode: 'IL', latitude: 40.1, longitude: -89.3 };
    const { rerender } = render(<UsMap metrics={researchedMetrics} metadata={metadata} selected={researched} onSelect={() => undefined} />);

    const map = screen.getByTestId('us-map');
    const marker = map.querySelector(`[data-place-id="${researched.placeId}"]`)!;
    const shape = marker.querySelector('circle, rect, path')!;
    const pointX = shape.tagName === 'rect' ? Number(shape.getAttribute('x')) + Number(shape.getAttribute('width')) / 2 : Number(shape.getAttribute('cx'));
    const pointY = shape.tagName === 'rect' ? Number(shape.getAttribute('y')) + Number(shape.getAttribute('height')) / 2 : Number(shape.getAttribute('cy'));
    const transform = map.querySelector('[data-map-viewport]')?.getAttribute('transform') ?? '';
    const [, x, y, scale] = transform.match(/translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/) ?? [];
    expect(map.getAttribute('data-zoom-scale')).toBe('4');
    expect(Number(x) + pointX * Number(scale)).toBeCloseTo(480);
    expect(Number(y) + pointY * Number(scale)).toBeCloseTo(300);
    rerender(<UsMap metrics={researchedMetrics} metadata={metadata} selected={unresearched} onSelect={() => undefined} />);
    expect(screen.getByTestId('us-map').getAttribute('data-zoom-scale')).toBe('4');
    expect(screen.getByTestId('us-map').querySelectorAll('[data-marker="no-data"]')).toHaveLength(1);
  });

  it('makes the selected no-data marker focusable and shows then clears its tooltip', () => {
    const unresearched: UsPlace = { placeId: '99999', city: 'Test place', state: 'Illinois', stateCode: 'IL', latitude: 40.1, longitude: -89.3 };
    render(<UsMap metrics={researchedMetrics} metadata={metadata} selected={unresearched} onSelect={() => undefined} />);

    const marker = screen.getByRole('img', { name: /Test place, Illinois.*Selected no-data status/i });
    expect(marker.getAttribute('tabindex')).toBe('0');
    fireEvent.focus(marker);
    expect(screen.getByRole('tooltip').textContent).toMatch(/Test place, Illinois.*Unknown.*Selected no-data status/i);
    fireEvent.blur(marker);
    expect(screen.queryByRole('tooltip')).toBeNull();
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
