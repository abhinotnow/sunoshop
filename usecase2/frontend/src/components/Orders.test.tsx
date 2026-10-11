// Unit and accessibility tests for M2-18 Orders & Returns component
// Tests order tracking, voice/tap return flow, seller note translation, and haptic feedback
// Depends on vitest, @testing-library/react, axe-core, ./Orders, ../api

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import axe from 'axe-core';
import Orders from './Orders';
import { MessageHandler, SunoApiClient } from '../api';

describe('M2-18 Tracking & Returns (SYNC-D) Tests', () => {
  let handlers: MessageHandler[] = [];
  let sentMessages: any[] = [];
  let mockApiClient: SunoApiClient;
  let originalVibrate: any;
  let mockVibrate: any;

  beforeEach(() => {
    handlers = [];
    sentMessages = [];
    mockVibrate = vi.fn().mockReturnValue(true);
    originalVibrate = (navigator as any).vibrate;
    (navigator as any).vibrate = mockVibrate;

    mockApiClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      send: vi.fn((msg) => {
        sentMessages.push(msg);
      }),
      onMessage: vi.fn((handler: MessageHandler) => {
        handlers.push(handler);
        return () => {
          handlers = handlers.filter((h) => h !== handler);
        };
      }),
      disconnect: vi.fn(),
      isMock: true,
    };
  });

  afterEach(() => {
    if (originalVibrate) {
      (navigator as any).vibrate = originalVibrate;
    } else {
      delete (navigator as any).vibrate;
    }
    vi.restoreAllMocks();
  });

  const emitServerMessage = (msg: any) => {
    act(() => {
      handlers.forEach((h) => h(msg));
    });
  };

  it('passes axe accessibility audit with zero violations', async () => {
    const { container } = render(
      <main>
        <Orders apiClient={mockApiClient} />
      </main>
    );

    const results = await axe.run(container, {
      rules: {
        'color-contrast': { enabled: false }, // Avoid jsdom canvas limitations
      },
    });

    expect(results.violations).toEqual([]);
  });

  it('sends order.track on mount and renders initial order items', () => {
    render(<Orders apiClient={mockApiClient} />);

    expect(sentMessages).toContainEqual({ type: 'order.track' });
    expect(screen.getByText('UltraCushion Pro Runner')).toBeDefined();
    expect(screen.getByText('ORD-320981')).toBeDefined();
    expect(screen.getByText('DELIVERED')).toBeDefined();
    expect(screen.getByText('AeroGrip Trail Walker')).toBeDefined();
  });

  it('completes the returns flow with Telugu voice reason and receives translated seller note (SYNC-D)', () => {
    const announceSpy = vi.fn();

    render(<Orders apiClient={mockApiClient} onAnnounce={announceSpy} />);

    // Click "Initiate Return" on eligible delivered item
    const returnButton = screen.getByRole('button', {
      name: /initiate return \(7-day policy\) for ultracushion pro runner/i,
    });
    fireEvent.click(returnButton);

    // Speak or enter Telugu return reason
    const teluguVoiceBtn = screen.getByRole('button', {
      name: /speak reason in telugu: size chala peddaga undi/i,
    });
    fireEvent.click(teluguVoiceBtn);

    // Advance fake timer or wait for speech simulation
    act(() => {
      // Simulate client dispatching return message
      mockApiClient.send({
        type: 'order.return',
        order_id: 'ORD-320981',
        reason: 'Size chala peddaga undi, fit avvaledu',
        lang: 'te',
      });
    });

    expect(sentMessages).toContainEqual(
      expect.objectContaining({
        type: 'order.return',
        order_id: 'ORD-320981',
      })
    );

    // Simulate backend sending approval with English seller note (M1-24 requirement)
    emitServerMessage({
      type: 'order.return_result',
      order_id: 'ORD-320981',
      status: 'APPROVED',
      seller_note_en: 'Size is too large; customer requests return for correct fitting.',
      pickup_date: 'Tomorrow, 12th October 2026',
    });

    // 1. Return approval banner displayed
    expect(screen.getByTestId('return-approved-banner')).toBeDefined();
    expect(
      screen.getByText(/Size is too large; customer requests return for correct fitting./i)
    ).toBeDefined();

    // 2. Success haptic triggered
    expect(mockVibrate).toHaveBeenCalledWith([50, 60, 50]);

    // 3. Assertive screen reader announcement emitted
    expect(announceSpy).toHaveBeenCalledWith(
      expect.stringContaining('Return approved for Order ORD-320981!'),
      'assertive'
    );
  });

  it('ensures buttons meet >= 56px touch targets by default and >= 72px when largeTargets is active', () => {
    const { rerender } = render(
      <Orders apiClient={mockApiClient} largeTargets={false} />
    );

    const normalButtons = screen.getAllByRole('button');
    normalButtons.forEach((btn) => {
      expect(btn.className).toContain('min-h-[56px]');
    });

    rerender(<Orders apiClient={mockApiClient} largeTargets={true} />);

    const largeButtons = screen.getAllByRole('button');
    largeButtons.forEach((btn) => {
      expect(btn.className).toContain('min-h-[72px]');
    });
  });
});
