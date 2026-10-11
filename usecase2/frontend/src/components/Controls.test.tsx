// Unit and accessibility tests for M2-14 Adaptation Prompt and Controls
// Exports test suite for Controls.tsx
// Depends on vitest, @testing-library/react, axe-core, ./Controls, ../api, ../adapt

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import axe from 'axe-core';
import Controls from './Controls';
import { createApiClient } from '../api';
import { AdaptationOffer } from '../adapt';

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

  it('shows the recognized speech transcript after an ASR result', () => {
    render(<Controls apiClient={apiClient} currentLang="en" />);

    act(() => {
      apiClient.send({ type: 'audio.utterance', audio: 'SAMPLE_AUDIO', duration_ms: 1000 });
    });

    expect(screen.getByText('You said')).toBeDefined();
    expect(screen.getByText('Show me running shoes with good cushion')).toBeDefined();
    expect(screen.getByText('Speech recognized.')).toBeDefined();
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

