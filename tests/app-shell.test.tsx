// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from '../src/App';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => [] });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('App shell', () => {
  it('renders the dashboard title', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'DUI Market Opportunity Dashboard' }))
      .toBeTruthy();
  });

  it('keeps researched suggestions available while the Census index loads', async () => {
    let resolveIndex: (value: { ok: boolean; json: () => Promise<unknown> }) => void = () => undefined;
    fetchMock.mockReturnValue(new Promise((resolve) => { resolveIndex = resolve; }));
    render(<App />);
    const input = screen.getByRole('combobox', { name: 'Search cities' });

    fireEvent.change(input, { target: { value: 'Springfield' } });
    expect(screen.getByRole('option', { name: 'Springfield, Illinois' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Loading Census place index');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveIndex({
      ok: true,
      json: async () => [{ placeId: '99999', city: 'Springfield', state: 'Pennsylvania', stateCode: 'PA', latitude: 40.1, longitude: -75.3 }],
    });

    await waitFor(() => expect(screen.getByRole('option', { name: 'Springfield, Pennsylvania' })).toBeTruthy());
  });

  it('preserves researched search when the Census index fails to load', async () => {
    fetchMock.mockRejectedValueOnce(new Error('index unavailable'));
    render(<App />);
    const input = screen.getByRole('combobox', { name: 'Search cities' });

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Census place index unavailable'));
    fireEvent.change(input, { target: { value: 'Springfield' } });
    expect(screen.getByRole('option', { name: 'Springfield, Massachusetts' })).toBeTruthy();
  });

  it('formats the refresh date and renders the first 25 table rows', () => {
    render(<App />);

    expect(screen.getByText(/July 10, 2026/)).toBeTruthy();
    expect(screen.getAllByRole('row')).toHaveLength(26);
    expect(screen.getByText('Showing 1-25 of 345')).toBeTruthy();
  });

  it('does not select an arbitrary city when Enter is pressed on an ambiguous query', () => {
    render(<App />);
    const input = screen.getByRole('combobox', { name: 'Search cities' });

    fireEvent.change(input, { target: { value: 'Springfield' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.queryByRole('region', { name: 'Selected city spotlight' })).toBeNull();
    expect(screen.getByRole('option', { name: 'Springfield, Massachusetts' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Springfield, Illinois' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Springfield, Missouri' })).toBeTruthy();
  });

  it('selects researched and no-data places from the shared autocomplete', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => [{ placeId: '99999', city: 'Aaronsburg', state: 'Pennsylvania', stateCode: 'PA', latitude: 40.9, longitude: -77.4 }] });
    render(<App />);
    const input = screen.getByRole('combobox', { name: 'Search cities' });

    fireEvent.change(input, { target: { value: 'Springfield' } });
    fireEvent.click(screen.getByRole('option', { name: 'Springfield, Missouri' }));
    expect(within(screen.getByRole('region', { name: 'Selected city spotlight' })).getByText('Springfield, Missouri')).toBeTruthy();

    fireEvent.change(input, { target: { value: 'Aaronsburg' } });
    await waitFor(() => expect(screen.getByRole('option', { name: 'Aaronsburg, Pennsylvania' })).toBeTruthy());
    fireEvent.click(screen.getByRole('option', { name: 'Aaronsburg, Pennsylvania' }));
    expect(screen.getByText('No metrics in current dataset')).toBeTruthy();
    const noDataBadge = within(screen.getByRole('region', { name: 'Selected city spotlight' })).getByText('No data');
    expect(noDataBadge.className).toContain('status-no-data');
  });

  it('keeps researched city results visible after selecting a city suggestion', () => {
    render(<App />);
    const input = screen.getByRole('combobox', { name: 'Search cities' }) as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'Springfield' } });
    fireEvent.click(screen.getByRole('option', { name: 'Springfield, Missouri' }));

    expect(input.value).toBe('Springfield');
    expect(screen.getByText('Showing 1-3 of 3')).toBeTruthy();
    expect(screen.getAllByRole('row')).toHaveLength(4);
  });

  it('closes autocomplete suggestions after a city is selected', () => {
    render(<App />);
    const input = screen.getByRole('combobox', { name: 'Search cities' });

    fireEvent.change(input, { target: { value: 'Springfield' } });
    fireEvent.click(screen.getByRole('option', { name: 'Springfield, Missouri' }));

    expect(screen.queryByRole('listbox', { name: 'City suggestions' })).toBeNull();
  });

  it('closes autocomplete with Escape without clearing the selected city or query', () => {
    render(<App />);
    const input = screen.getByRole('combobox', { name: 'Search cities' }) as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'Springfield' } });
    fireEvent.click(screen.getByRole('option', { name: 'Springfield, Missouri' }));
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(input.value).toBe('Springfield');
    expect(input.getAttribute('aria-activedescendant')).toBeNull();
    expect(screen.queryByRole('listbox', { name: 'City suggestions' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Selected city spotlight' }).textContent).toContain('Springfield, Missouri');
  });

  it('keeps filters and page when Escape closes the empty autocomplete', () => {
    render(<App />);
    const input = screen.getByRole('combobox', { name: 'Search cities' });

    fireEvent.click(screen.getByRole('button', { name: 'Qualified' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.getByRole('button', { name: 'Qualified' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Showing 1-3 of 3')).toBeTruthy();
  });

  it('navigates autocomplete options with arrows and selects the active option with Enter', () => {
    render(<App />);
    const input = screen.getByRole('combobox', { name: 'Search cities' });

    fireEvent.change(input, { target: { value: 'Springfield' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const firstActiveId = input.getAttribute('aria-activedescendant');
    expect(firstActiveId).toBeTruthy();
    expect(document.getElementById(firstActiveId!)?.textContent).toBe('Springfield, Illinois');

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    const previousActiveId = input.getAttribute('aria-activedescendant');
    expect(previousActiveId).not.toBe(firstActiveId);

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('region', { name: 'Selected city spotlight' }).textContent).toContain('Springfield, Illinois');
  });

  it('resets the page when filters change', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByText('Showing 26-50 of 345')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Qualified' }));
    expect(screen.getByText('Showing 1-3 of 3')).toBeTruthy();
  });

  it('preserves city selection across tabs', () => {
    render(<App />);
    const input = screen.getByRole('combobox', { name: 'Search cities' });
    fireEvent.change(input, { target: { value: 'Springfield' } });
    fireEvent.click(screen.getByRole('option', { name: 'Springfield, Illinois' }));

    fireEvent.click(screen.getByRole('tab', { name: 'U.S. Map' }));
    expect(screen.getByRole('region', { name: 'Selected city spotlight' }).textContent).toContain('Springfield, Illinois');
    expect(screen.getByTestId('us-map').getAttribute('data-zoom-scale')).toBe('4');
  });

  it('moves tab focus and selection with ArrowLeft, ArrowRight, Home, and End', () => {
    render(<App />);
    const tableTab = screen.getByRole('tab', { name: 'City Table' });
    const mapTab = screen.getByRole('tab', { name: 'U.S. Map' });

    expect(tableTab.getAttribute('tabindex')).toBe('0');
    expect(mapTab.getAttribute('tabindex')).toBe('-1');
    tableTab.focus();
    fireEvent.keyDown(tableTab, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(mapTab);
    expect(mapTab.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(mapTab, { key: 'Home' });
    expect(document.activeElement).toBe(tableTab);
    expect(tableTab.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tableTab, { key: 'End' });
    expect(document.activeElement).toBe(mapTab);
    fireEvent.keyDown(mapTab, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(tableTab);
  });

  it('renders a selected no-data place on the map', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => [{ placeId: '99999', city: 'Aaronsburg', state: 'Pennsylvania', stateCode: 'PA', latitude: 40.9, longitude: -77.4 }] });
    render(<App />);
    const input = screen.getByRole('combobox', { name: 'Search cities' });

    fireEvent.change(input, { target: { value: 'Aaronsburg' } });
    await waitFor(() => expect(screen.getByRole('option', { name: 'Aaronsburg, Pennsylvania' })).toBeTruthy());
    fireEvent.click(screen.getByRole('option', { name: 'Aaronsburg, Pennsylvania' }));
    fireEvent.click(screen.getByRole('tab', { name: 'U.S. Map' }));

    expect(screen.getByTestId('us-map').getAttribute('data-zoom-scale')).toBe('4');
    expect(screen.getByTestId('us-map').querySelectorAll('[data-marker="no-data"]')).toHaveLength(1);
  });

  it('uses semantic mobile row markup for the city list', () => {
    render(<App />);

    expect(screen.getByRole('list', { name: 'City results' })).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(25);
  });
});
