// Unit and integration tests for accessible shell, landmarks, live announcer, and i18n
// Exports test suite for App and announce()
// Depends on vitest, @testing-library/react, ./App, ./i18n
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import App, { announce } from './App';
import { translations } from './i18n';

describe('M2-02 Accessible Shell', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_USE_MOCK', 'true');
    document.body.innerHTML = '';
    document.documentElement.lang = 'en';
  });

  it('renders required accessibility landmarks and skip link', () => {
    render(<App />);

    // Skip link exists and points to #main-content
    const skipLink = screen.getByText(translations.en.skipLink);
    expect(skipLink).toBeDefined();
    expect(skipLink.getAttribute('href')).toBe('#main-content');

    // Landmarks exist
    const header = document.querySelector('header');
    expect(header).toBeDefined();

    const nav = screen.getByRole('navigation', { name: translations.en.navLabel });
    expect(nav).toBeDefined();

    const main = document.querySelector('main#main-content');
    expect(main).toBeDefined();
  });

  it('updates live-region announcer when announce() is called', async () => {
    render(<App />);

    const announcer = document.getElementById('aria-live-announcer');
    expect(announcer).toBeDefined();

    act(() => {
      announce('Product added to cart', 'assertive');
    });

    // announce() uses a 50ms setTimeout to trigger DOM mutation for screen readers
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(announcer?.textContent).toBe('Product added to cart');
    expect(announcer?.getAttribute('aria-live')).toBe('assertive');
  });

  it('changes labels and document lang attribute when language is switched', async () => {
    render(<App />);

    const select = screen.getByLabelText(translations.en.languageSelectLabel) as HTMLSelectElement;
    expect(select.value).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(screen.getAllByText(translations.en.appName).length).toBeGreaterThan(0);

    // Switch to Hindi
    fireEvent.change(select, { target: { value: 'hi' } });
    expect(document.documentElement.lang).toBe('hi');
    expect(screen.getAllByText(translations.hi.appName).length).toBeGreaterThan(0);
    expect(screen.getAllByText(translations.hi.tagline).length).toBeGreaterThan(0);

    // Switch to Telugu
    fireEvent.change(select, { target: { value: 'te' } });
    expect(document.documentElement.lang).toBe('te');
    expect(screen.getAllByText(translations.te.appName).length).toBeGreaterThan(0);
    expect(screen.getAllByText(translations.te.tagline).length).toBeGreaterThan(0);
  });

  it('presents the microphone as the primary input without a text question field', () => {
    render(<App />);

    expect(screen.getByRole('button', { name: 'Start recording voice query' })).toBeDefined();
    expect(screen.queryByLabelText('Type a question to try the demo')).toBeNull();
  });
});
