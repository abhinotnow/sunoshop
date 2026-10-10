// Unit and accessibility tests for M2-14 Adaptation Prompt and Controls
// Exports test suite for Controls.tsx
// Depends on vitest, @testing-library/react, axe-core, ./Controls, ../api, ../adapt

import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import axe from 'axe-core';
import Controls from './Controls';
import { createApiClient } from '../api';
import { AdaptationOffer } from '../adapt';
import { setIsOffline, resetOfflineSignal, saveCatalog, clearCatalogCache } from '../offline';

describe('M2-14 Adaptation Prompt & Controls Tests', () => {
  const mockOffer: AdaptationOffer = {
    adaptation: 'larger_targets',
    reason: '3 tap offsets detected in 60s. Would you like larger 72px touch targets?',
    triggerEvent: 'tap_miss',
    thresholdReached: 3,
    timestamp: Date.now(),
  };

  let apiClient = createApiClient(true);

  beforeEach(() => {
    apiClient = createApiClient(true);
  });

  it('passes axe accessibility audit with zero violations', async () => {
    const { container } = render(
      <main>
        <Controls
          apiClient={apiClient}
          currentLang="en"
          activeOffer={mockOffer}
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

  it('shows adaptation prompt banner and announces aloud when an offer is active', () => {
    const announceSpy = vi.fn();

    render(
      <Controls
        apiClient={apiClient}
        currentLang="en"
        activeOffer={mockOffer}
        onAnnounce={announceSpy}
      />
    );

    expect(screen.getByText(/accessibility adaptation suggestion/i)).toBeDefined();
    expect(screen.getByText(/3 tap offsets detected/i)).toBeDefined();

    expect(announceSpy).toHaveBeenCalledWith(
      expect.stringMatching(/accessibility proposal.*select accept to apply/i),
      'assertive'
    );
  });

  it('declining changes nothing (strict M2-14 requirement)', () => {
    const declineSpy = vi.fn();
    const acceptSpy = vi.fn();
    const announceSpy = vi.fn();

    const { rerender } = render(
      <Controls
        apiClient={apiClient}
        currentLang="en"
        activeOffer={mockOffer}
        onDeclineOffer={declineSpy}
        onAcceptOffer={acceptSpy}
        onAnnounce={announceSpy}
      />
    );

    const declineBtn = screen.getByRole('button', {
      name: /decline adaptation suggestion/i,
    });
    fireEvent.click(declineBtn);

    expect(declineSpy).toHaveBeenCalledTimes(1);
    expect(acceptSpy).not.toHaveBeenCalled();

    // Rerender with cleared offer (as app would do after decline)
    rerender(
      <Controls
        apiClient={apiClient}
        currentLang="en"
        activeOffer={null}
        adaptationState={{
          largeTargets: false,
          speechRate: 1.0,
          simplerExplanations: false,
          longerSilenceWindow: false,
        }}
      />
    );

    // Mic button remains at standard default min-h-[56px] / sm:min-h-[64px], NOT 72px
    const micButton = screen.getByRole('button', { name: /start recording voice query/i });
    expect(micButton.className).toContain('min-h-[56px]');
    expect(micButton.className).not.toContain('min-h-[72px]');
  });

  it('accepting enables larger targets mode (>= 72px) and provides instant reversibility', () => {
    const acceptSpy = vi.fn();
    const revertSpy = vi.fn();

    const { rerender } = render(
      <Controls
        apiClient={apiClient}
        currentLang="en"
        activeOffer={mockOffer}
        onAcceptOffer={acceptSpy}
      />
    );

    const acceptBtn = screen.getByRole('button', {
      name: /accept suggestion to enable larger targets/i,
    });
    fireEvent.click(acceptBtn);

    expect(acceptSpy).toHaveBeenCalledWith('larger_targets');

    // Rerender with active largeTargets adaptation
    rerender(
      <Controls
        apiClient={apiClient}
        currentLang="en"
        activeOffer={null}
        adaptationState={{
          largeTargets: true,
          speechRate: 1.0,
          simplerExplanations: false,
          longerSilenceWindow: false,
        }}
        onRevertAdaptation={revertSpy}
      />
    );

    // Mic button has scaled to >= 72px (sm:min-h-[84px])
    const micButton = screen.getByRole('button', { name: /start recording voice query/i });
    expect(micButton.className).toContain('min-h-[72px]');

    // Reversible pill is visible
    expect(screen.getByText(/large targets \(72px\) active/i)).toBeDefined();

    // Click Revert
    const revertBtn = screen.getByRole('button', { name: /revert large targets/i });
    fireEvent.click(revertBtn);
    expect(revertSpy).toHaveBeenCalledWith('larger_targets');
  });

  it('pressing Explain Simpler button lowers playback rate to 0.8x and sends ui.event (M2-15)', () => {
    const toggleSpy = vi.fn();
    const announceSpy = vi.fn();
    const sendSpy = vi.spyOn(apiClient, 'send');

    render(
      <Controls
        apiClient={apiClient}
        currentLang="en"
        onExplainSimplerToggle={toggleSpy}
        onAnnounce={announceSpy}
      />
    );

    const simplerBtn = screen.getByRole('button', {
      name: /explain simpler: slow down playback to 0.8x/i,
    });
    expect(simplerBtn).toBeDefined();

    // Click Explain Simpler
    fireEvent.click(simplerBtn);

    // Verify toggle callback called with true
    expect(toggleSpy).toHaveBeenCalledWith(true);

    // Verify client sent ui.event explain_again
    expect(sendSpy).toHaveBeenCalledWith({
      type: 'ui.event',
      kind: 'explain_again',
    });

    // Verify announcement
    expect(announceSpy).toHaveBeenCalledWith(
      expect.stringMatching(/explain simpler mode activated.*slowed to 0.8x/i),
      'polite'
    );

    // Click again to deactivate and restore speed
    fireEvent.click(simplerBtn);
    expect(toggleSpy).toHaveBeenCalledWith(false);
    expect(announceSpy).toHaveBeenCalledWith(
      expect.stringMatching(/explain simpler mode deactivated.*restored to standard speed/i),
      'polite'
    );
  });
});

describe('M2-21 Offline Speech & Banner (SYNC-E) Tests', () => {
  let apiClient = createApiClient(true);

  beforeEach(async () => {
    resetOfflineSignal();
    await clearCatalogCache();
    apiClient = createApiClient(true);
  });

  it('renders persistent high-contrast offline banner when offline signal is active', async () => {
    const announceSpy = vi.fn();

    render(
      <main>
        <Controls
          apiClient={apiClient}
          currentLang="en"
          onAnnounce={announceSpy}
        />
      </main>
    );

    // Initially online
    expect(screen.queryByText(/OFFLINE MODE: Using cached catalog/i)).toBeNull();

    // Trigger offline signal
    act(() => {
      setIsOffline(true);
    });

    // Banner is visible and persistent
    expect(screen.getByText(/OFFLINE MODE: Using cached catalog/i)).toBeDefined();
    expect(screen.getByText(/SYNC-E OFFLINE/i)).toBeDefined();

    // Announced to screen reader within 1s
    expect(announceSpy).toHaveBeenCalledWith(
      'Switched to offline mode. Using cached catalog and device voice.',
      'assertive'
    );
  });

  it('passes axe accessibility audit when offline banner is displayed', async () => {
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

  it('submitting offline question queries cached catalog and announces response', async () => {
    await saveCatalog('2026.v1', [
      {
        id: 'p_redmi',
        title: 'Redmi Note 13',
        brand: 'Redmi',
        category: 'Electronics',
        price_inr: 15499,
        specs: { battery: '5000mAh' },
        size_chart: [],
        alt_texts: { en: 'Redmi phone', hi: 'रेडमी', te: 'రెడ్‌మి' },
        review_digest: { pros: ['Great battery'], cons: [], claims_checked: [] },
        review_chunks: [],
      },
    ]);

    setIsOffline(true);
    const announceSpy = vi.fn();
    const captionSpy = vi.fn();

    render(
      <Controls
        apiClient={apiClient}
        currentLang="en"
        onAnnounce={announceSpy}
        onCaptionChange={captionSpy}
      />
    );

    const input = screen.getByLabelText(/ask product question or test voice query/i);
    const askBtn = screen.getByRole('button', { name: /ask product question/i });

    await act(async () => {
      fireEvent.change(input, { target: { value: 'battery of Redmi' } });
      fireEvent.click(askBtn);
      await new Promise((resolve) => setTimeout(resolve, 80));
    });

    expect(announceSpy).toHaveBeenCalledWith(
      expect.stringMatching(/The Redmi Note 13 has a battery of 5000mAh/i),
      'assertive'
    );
  });
});

