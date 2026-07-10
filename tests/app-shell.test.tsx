// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import App from '../src/App';

afterEach(cleanup);

describe('App shell', () => {
  it('renders the dashboard title', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'DUI Market Opportunity Dashboard' }))
      .toBeTruthy();
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

  it('selects researched and no-data places from the shared autocomplete', () => {
    render(<App />);
    const input = screen.getByRole('combobox', { name: 'Search cities' });

    fireEvent.change(input, { target: { value: 'Springfield' } });
    fireEvent.click(screen.getByRole('option', { name: 'Springfield, Missouri' }));
    expect(within(screen.getByRole('region', { name: 'Selected city spotlight' })).getByText('Springfield, Missouri')).toBeTruthy();

    fireEvent.change(input, { target: { value: 'Aaronsburg' } });
    fireEvent.click(screen.getAllByRole('option', { name: /Aaronsburg,/ })[0]);
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
    expect(screen.getByText('Showing 1-25 of 43')).toBeTruthy();
  });

  it('preserves city selection across tabs', () => {
    render(<App />);
    const input = screen.getByRole('combobox', { name: 'Search cities' });
    fireEvent.change(input, { target: { value: 'Springfield' } });
    fireEvent.click(screen.getByRole('option', { name: 'Springfield, Illinois' }));

    fireEvent.click(screen.getByRole('tab', { name: 'U.S. Map' }));
    expect(screen.getByRole('region', { name: 'Selected city spotlight' }).textContent).toContain('Springfield, Illinois');
    expect(screen.getByText('Map workspace is being prepared.')).toBeTruthy();
  });

  it('uses semantic mobile row markup for the city list', () => {
    render(<App />);

    expect(screen.getByRole('list', { name: 'City results' })).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(25);
  });
});
