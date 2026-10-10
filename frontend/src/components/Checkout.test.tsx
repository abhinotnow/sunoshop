// Unit and accessibility tests for M2-16 (Checkout panel) and M2-17 (Confirmation phrase)
// Tests dark-pattern fee stripping, haptics, live-region alerts, and verbal confirmation flow
// Depends on vitest, @testing-library/react, axe-core, ./Checkout, ../api

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import axe from 'axe-core';
import Checkout from './Checkout';
import { MessageHandler, SunoApiClient } from '../api';
import { CartItem } from '../types';

describe('M2-16 Checkout panel & M2-17 Confirmation phrase Tests', () => {
  let handlers: MessageHandler[] = [];
  let sentMessages: any[] = [];
  let mockApiClient: SunoApiClient;
  let originalVibrate: any;
  let mockVibrate: any;

  const mockCart: CartItem[] = [
    {
      product_id: 'p_001',
      title: 'UltraCushion Pro Runner',
      price_inr: 3499,
      qty: 1,
    },
    {
      product_id: 'p_002',
      title: 'AeroGrip Trail Walker',
      price_inr: 2799,
      qty: 2,
    },
  ];

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
        <Checkout apiClient={mockApiClient} cart={mockCart} />
      </main>
    );

    const results = await axe.run(container, {
      rules: {
        'color-contrast': { enabled: false }, // Avoid jsdom canvas limitation
      },
    });

    expect(results.violations).toEqual([]);
  });

  it('renders cart items, quantities, and calculated prices correctly', () => {
    render(<Checkout apiClient={mockApiClient} cart={mockCart} />);

    expect(screen.getByText('UltraCushion Pro Runner')).toBeDefined();
    expect(screen.getByText('AeroGrip Trail Walker')).toBeDefined();
    expect(screen.getByText('Qty: 2 • Unit: ₹2,799')).toBeDefined();
    // Subtotal: 3499 + 2799*2 = 9097 (appears in subtotal and total)
    expect(screen.getAllByText('₹9,097').length).toBeGreaterThanOrEqual(1);
  });

  // --- M2-16 Acceptance Criteria ---
  it('M2-16: shows stripped dark-pattern fees in UI, triggers assertive announcement and haptic vibration', () => {
    const announceSpy = vi.fn();

    render(
      <Checkout
        apiClient={mockApiClient}
        cart={mockCart}
        onAnnounce={announceSpy}
      />
    );

    // Initial state: proceed button is shown
    const proceedButton = screen.getByRole('button', {
      name: /proceed to guarded checkout/i,
    });
    fireEvent.click(proceedButton);

    // Assert that client sent start action
    expect(sentMessages).toContainEqual({
      type: 'checkout.action',
      action: 'start',
    });

    // Simulate backend sending checkout.state with stripped dark-pattern fees
    emitServerMessage({
      type: 'checkout.state',
      state: 'GUARDED',
      cart: mockCart,
      removed_fees: [
        'Pre-selected shipping protection (₹49)',
        'Priority handling fee (₹29)',
      ],
    });

    // 1. Removed fee appears visibly in UI
    expect(screen.getByTestId('removed-fees-alert')).toBeDefined();
    expect(screen.getAllByTestId('removed-fee-item')).toHaveLength(2);
    expect(screen.getByText(/Pre-selected shipping protection \(₹49\)/i)).toBeDefined();
    expect(screen.getByText(/Priority handling fee \(₹29\)/i)).toBeDefined();

    // 2. Removed fee triggers assertive live-region announcement
    expect(announceSpy).toHaveBeenCalledWith(
      expect.stringContaining('Guardian Alert: Dark pattern fees detected and stripped!'),
      'assertive'
    );
    expect(announceSpy).toHaveBeenCalledWith(
      expect.stringContaining('Pre-selected shipping protection (₹49)'),
      'assertive'
    );

    // 3. Vibration call fired with error pattern ([150, 80, 150, 80, 200])
    expect(mockVibrate).toHaveBeenCalledWith([150, 80, 150, 80, 200]);
  });

  // --- M2-17 Acceptance Criteria ---
  it('M2-17: displays confirmation phrase large, handles repeat, and reaches "ORDER_PLACED" only after server confirmation', () => {
    const announceSpy = vi.fn();

    render(
      <Checkout
        apiClient={mockApiClient}
        cart={mockCart}
        onAnnounce={announceSpy}
      />
    );

    // Simulate server emitting challenge phrase
    emitServerMessage({
      type: 'confirm.challenge',
      phrase: 'Confirm Blue Falcon',
      attempts_remaining: 3,
    });

    // 1. Phrase is displayed large and prominent in UI
    const phraseDisplay = screen.getByTestId('challenge-phrase-display');
    expect(phraseDisplay.textContent).toContain('Confirm Blue Falcon');

    // 2. Assertive announcement made for screen reader
    expect(announceSpy).toHaveBeenCalledWith(
      expect.stringContaining('Verbal confirmation challenge: Speak the phrase "Confirm Blue Falcon"'),
      'assertive'
    );

    // 3. UI has NOT reached "ORDER_PLACED" yet
    expect(screen.queryByText(/Order Placed Successfully/i)).toBeNull();

    // 4. User repeats or confirms the phrase
    const voiceButton = screen.getByRole('button', {
      name: /Speak verbal confirmation phrase: Confirm Blue Falcon/i,
    });
    fireEvent.click(voiceButton);

    // 5. Still has not reached ORDER_PLACED until server replies
    expect(screen.queryByText(/Order Placed Successfully/i)).toBeNull();

    // 6. Server responds with ORDER_PLACED
    emitServerMessage({
      type: 'checkout.state',
      state: 'ORDER_PLACED',
      cart: mockCart,
      removed_fees: [],
    });

    // 7. Now and only now reaches placed state
    expect(screen.getByText(/Order Placed Successfully/i)).toBeDefined();
    expect(screen.getByText(/Status: Dispatched via Verified Courier/i)).toBeDefined();
    expect(mockVibrate).toHaveBeenCalledWith([50, 60, 50]); // Success haptic pattern
    expect(announceSpy).toHaveBeenCalledWith(
      expect.stringContaining('Order placed successfully without hidden fees!'),
      'assertive'
    );
  });

  it('allows canceling checkout and sends checkout.action cancel to server', () => {
    const closeSpy = vi.fn();

    render(
      <Checkout
        apiClient={mockApiClient}
        cart={mockCart}
        onClose={closeSpy}
      />
    );

    // Send challenge phrase
    emitServerMessage({
      type: 'confirm.challenge',
      phrase: 'Confirm Silver Hawk',
    });

    const cancelButton = screen.getByRole('button', {
      name: /cancel checkout and return to cart/i,
    });
    fireEvent.click(cancelButton);

    // Assert that cancel message was dispatched
    expect(sentMessages).toContainEqual({
      type: 'checkout.action',
      action: 'cancel',
    });
    expect(closeSpy).toHaveBeenCalled();
  });

  it('ensures all buttons have >= 56px touch targets by default and >= 72px when largeTargets is active', () => {
    const { rerender } = render(
      <Checkout apiClient={mockApiClient} cart={mockCart} largeTargets={false} />
    );

    const normalButtons = screen.getAllByRole('button');
    normalButtons.forEach((btn) => {
      expect(btn.className).toContain('min-h-[56px]');
    });

    rerender(
      <Checkout apiClient={mockApiClient} cart={mockCart} largeTargets={true} />
    );

    const largeButtons = screen.getAllByRole('button');
    largeButtons.forEach((btn) => {
      expect(btn.className).toContain('min-h-[72px]');
    });
  });
});
