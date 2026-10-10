// Comprehensive Automated Accessibility (A11y) Test Suite across every screen and adaptation mode
// Exports M2-22 test suite for SunoShop
// Depends on vitest, @testing-library/react, axe-core, ../App, ../components/Checkout, ../components/Orders, ../components/Controls, ../components/Shelf

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import axe from 'axe-core';
import App from '../App';
import Checkout from '../components/Checkout';
import Orders from '../components/Orders';
import Controls from '../components/Controls';
import Shelf from '../components/Shelf';
import { createApiClient } from '../api';
import { setIsOffline, resetOfflineSignal } from '../offline';

describe('M2-22 Automated A11y Verification across All Screens & Modes', () => {
  let apiClient = createApiClient(true);

  beforeEach(() => {
    resetOfflineSignal();
    document.body.innerHTML = '';
    apiClient = createApiClient(true);
  });

  it('Screen 1: Full App Shell & Product Shelf passes axe audit with 0 serious/critical violations', async () => {
    const { container } = render(<App />);

    const results = await axe.run(container, {
      rules: {
        'color-contrast': { enabled: false }, // Canvas context unavailable in jsdom; tested via pure contrast math
      },
    });

    const criticalOrSerious = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious'
    );
    expect(criticalOrSerious).toEqual([]);
    expect(results.violations).toEqual([]);
  });

  it('Screen 2: Adaptation Mode - Larger Targets (>=72px) passes axe audit with 0 violations', async () => {
    const { container } = render(
      <main>
        <Controls
          apiClient={apiClient}
          currentLang="en"
          adaptationState={{
            largeTargets: true,
            speechRate: 1.0,
            simplerExplanations: false,
            longerSilenceWindow: false,
          }}
        />
      </main>
    );

    const results = await axe.run(container, {
      rules: {
        'color-contrast': { enabled: false },
      },
    });

    expect(results.violations).toEqual([]);
  });

  it('Screen 3: Adaptation Mode - Slower Speech (0.8x) & Explain Simpler passes axe audit with 0 violations', async () => {
    const { container } = render(
      <main>
        <Controls
          apiClient={apiClient}
          currentLang="en"
          adaptationState={{
            largeTargets: false,
            speechRate: 0.8,
            simplerExplanations: true,
            longerSilenceWindow: false,
          }}
        />
      </main>
    );

    const results = await axe.run(container, {
      rules: {
        'color-contrast': { enabled: false },
      },
    });

    expect(results.violations).toEqual([]);
  });

  it('Screen 4: Checkout Panel with Guardian Dark-Pattern Strikethroughs passes axe audit with 0 violations', async () => {
    const { container } = render(
      <main>
        <Checkout
          apiClient={apiClient}
          isOpen={true}
          cart={[
            { product_id: 'p_001', title: 'UltraCushion Pro', price_inr: 3499, qty: 1 },
          ]}
          currentLang="en"
        />
      </main>
    );

    const results = await axe.run(container, {
      rules: {
        'color-contrast': { enabled: false },
      },
    });

    expect(results.violations).toEqual([]);
  });

  it('Screen 5: Orders & Returns Panel with 7-Day Policy passes axe audit with 0 violations', async () => {
    const { container } = render(
      <main>
        <Orders
          apiClient={apiClient}
          isOpen={true}
          currentLang="en"
        />
      </main>
    );

    const results = await axe.run(container, {
      rules: {
        'color-contrast': { enabled: false },
      },
    });

    expect(results.violations).toEqual([]);
  });

  it('Screen 6: Offline Mode with Persistent High-Contrast Banner passes axe audit with 0 violations', async () => {
    setIsOffline(true);

    const { container } = render(
      <main>
        <Controls
          apiClient={apiClient}
          currentLang="en"
        />
      </main>
    );

    const results = await axe.run(container, {
      rules: {
        'color-contrast': { enabled: false },
      },
    });

    expect(results.violations).toEqual([]);
  });

  it('Screen 7: Multilingual Shelves in Hindi and Telugu pass axe audit with 0 violations', async () => {
    const mockProducts = [
      {
        id: 'p_hi_01',
        title: 'क्लाउडवॉक रनिंग शूज़',
        price_inr: 2999,
        pan: 0,
        alt_text: 'ग्रे रनिंग शूज़',
      },
    ];

    const { container: hiContainer, unmount: unmountHi } = render(
      <main>
        <Shelf
          products={mockProducts}
          currentLang="hi"
        />
      </main>
    );

    const hiResults = await axe.run(hiContainer, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(hiResults.violations).toEqual([]);

    unmountHi();
    document.body.innerHTML = '';

    const { container: teContainer } = render(
      <main>
        <Shelf
          products={mockProducts}
          currentLang="te"
        />
      </main>
    );

    const teResults = await axe.run(teContainer, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(teResults.violations).toEqual([]);
  });
});
