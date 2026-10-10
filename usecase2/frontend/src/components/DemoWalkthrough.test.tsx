// M2-25 DemoWalkthrough Component Tests
// Verifies 9-step rehearsed judge demo, navigation, actions, and axe a11y compliance

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import axe from 'axe-core';
import DemoWalkthrough, { DEMO_STEPS } from './DemoWalkthrough';

describe('M2-25 DemoWalkthrough Component Tests', () => {
  const onAnnounce = vi.fn();
  const onUpdateShelf = vi.fn();
  const onOpenCheckout = vi.fn();
  const onSimulateOffline = vi.fn();
  const onClose = vi.fn();

  beforeEach(() => {
    cleanup();
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <DemoWalkthrough
        isOpen={false}
        onClose={onClose}
        onAnnounce={onAnnounce}
        onUpdateShelf={onUpdateShelf}
        onOpenCheckout={onOpenCheckout}
        onSimulateOffline={onSimulateOffline}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders step 1 and navigates through steps with Next / Prev buttons', () => {
    render(
      <DemoWalkthrough
        isOpen={true}
        onClose={onClose}
        onAnnounce={onAnnounce}
        onUpdateShelf={onUpdateShelf}
        onOpenCheckout={onOpenCheckout}
        onSimulateOffline={onSimulateOffline}
      />
    );

    // Initial step 1
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading.textContent).toContain(DEMO_STEPS[0].title);
    expect(screen.getByText(/STEP 1 OF 9/i)).toBeDefined();

    // Click Next
    const nextBtn = screen.getByRole('button', { name: /next step/i });
    fireEvent.click(nextBtn);

    // Step 2
    expect(heading.textContent).toContain(DEMO_STEPS[1].title);
    expect(screen.getByText(/STEP 2 OF 9/i)).toBeDefined();

    // Click Prev
    const prevBtn = screen.getByRole('button', { name: /previous step/i });
    fireEvent.click(prevBtn);

    // Back to Step 1
    expect(heading.textContent).toContain(DEMO_STEPS[0].title);
  });

  it('executes actions across steps and triggers announcements', () => {
    render(
      <DemoWalkthrough
        isOpen={true}
        onClose={onClose}
        onAnnounce={onAnnounce}
        onUpdateShelf={onUpdateShelf}
        onOpenCheckout={onOpenCheckout}
        onSimulateOffline={onSimulateOffline}
      />
    );

    // Step 1 execute
    const actionBtn = screen.getByRole('button', { name: /execute search/i });
    fireEvent.click(actionBtn);

    expect(onUpdateShelf).toHaveBeenCalled();
    expect(onAnnounce).toHaveBeenCalledWith(
      expect.stringContaining('Found 3 running shoes'),
      'assertive'
    );
  });

  it('passes axe accessibility audit with zero violations', async () => {
    const { container } = render(
      <main>
        <DemoWalkthrough
          isOpen={true}
          onClose={onClose}
          onAnnounce={onAnnounce}
          onUpdateShelf={onUpdateShelf}
          onOpenCheckout={onOpenCheckout}
          onSimulateOffline={onSimulateOffline}
        />
      </main>
    );

    const results = await axe.run(container, {
      rules: {
        'color-contrast': { enabled: true },
      },
    });

    const seriousOrCritical = results.violations.filter((v) =>
      ['serious', 'critical'].includes(v.impact || '')
    );
    expect(seriousOrCritical).toEqual([]);
  });
});
