// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import App from '../src/App';

describe('App shell', () => {
  it('renders the dashboard title', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'DUI Market Opportunity Dashboard' }))
      .toBeTruthy();
  });
});
