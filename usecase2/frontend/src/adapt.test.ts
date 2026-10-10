// Unit tests for M2-13 Friction Tracker
// Exports test suite for adapt.ts
// Depends on vitest, ./adapt

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFrictionTracker, FrictionTracker } from './adapt';

describe('M2-13 Friction Tracker Tests', () => {
  let tracker: FrictionTracker;

  beforeEach(() => {
    // Config with 60s window, tap_miss: 3, asr_timeout: 2, explain_again: 2, cooldown: 30s
    tracker = createFrictionTracker({
      windowDurationMs: 60_000,
      thresholds: {
        tap_miss: 3,
        asr_timeout: 2,
        explain_again: 2,
      },
      cooldownMs: 30_000,
    });
  });

  it('does NOT emit a suggestion when events are below threshold', () => {
    const listener = vi.fn();
    tracker.onSuggestion(listener);

    // 2 tap misses (threshold is 3)
    const offer1 = tracker.recordEvent('tap_miss');
    const offer2 = tracker.recordEvent('tap_miss');

    expect(offer1).toBeNull();
    expect(offer2).toBeNull();
    expect(listener).not.toHaveBeenCalled();
    expect(tracker.getRecentCount('tap_miss')).toBe(2);
  });

  it('emits larger_targets suggestion exactly when tap_miss threshold (3) is reached', () => {
    const listener = vi.fn();
    tracker.onSuggestion(listener);

    tracker.recordEvent('tap_miss');
    tracker.recordEvent('tap_miss');
    const offer3 = tracker.recordEvent('tap_miss');

    expect(offer3).toBeDefined();
    expect(offer3?.adaptation).toBe('larger_targets');
    expect(offer3?.triggerEvent).toBe('tap_miss');
    expect(offer3?.thresholdReached).toBe(3);
    expect(offer3?.reason).toContain('tap offsets detected');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(offer3);
  });

  it('emits slower_speech suggestion when asr_timeout threshold (2) is reached', () => {
    const listener = vi.fn();
    tracker.onSuggestion(listener);

    const offer1 = tracker.recordEvent('asr_timeout');
    expect(offer1).toBeNull();

    const offer2 = tracker.recordEvent('asr_timeout');
    expect(offer2).toBeDefined();
    expect(offer2?.adaptation).toBe('slower_speech');
    expect(offer2?.triggerEvent).toBe('asr_timeout');
    expect(offer2?.thresholdReached).toBe(2);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('emits explain_simpler suggestion when explain_again threshold (2) is reached', () => {
    const listener = vi.fn();
    tracker.onSuggestion(listener);

    tracker.recordEvent('explain_again');
    const offer = tracker.recordEvent('explain_again');

    expect(offer).toBeDefined();
    expect(offer?.adaptation).toBe('explain_simpler');
    expect(offer?.triggerEvent).toBe('explain_again');
    expect(listener).toHaveBeenCalledWith(offer);
  });

  it('expires events outside the sliding window', () => {
    const now = 100_000;
    // 2 events 70 seconds ago (outside 60s window)
    tracker.recordEvent('tap_miss', undefined, now - 70_000);
    tracker.recordEvent('tap_miss', undefined, now - 65_000);

    // 1 event right now
    const offer = tracker.recordEvent('tap_miss', undefined, now);

    // Should only have 1 active event in the window, so no offer
    expect(offer).toBeNull();
    expect(tracker.getRecentCount('tap_miss', 60_000, now)).toBe(1);
  });

  it('enforces cooldown period to avoid repeated nagging suggestions', () => {
    const now = 100_000;
    tracker.recordEvent('tap_miss', undefined, now - 5_000);
    tracker.recordEvent('tap_miss', undefined, now - 4_000);
    const offer1 = tracker.recordEvent('tap_miss', undefined, now - 3_000);
    expect(offer1).toBeDefined();

    // 4th event 2 seconds later (within 30s cooldown)
    const offer2 = tracker.recordEvent('tap_miss', undefined, now - 1_000);
    expect(offer2).toBeNull();

    // 5th event 35 seconds later (past 30s cooldown from offer1)
    const offer3 = tracker.recordEvent('tap_miss', undefined, now + 35_000);
    expect(offer3).toBeDefined();
    expect(offer3?.adaptation).toBe('larger_targets');
  });

  it('never mutates the DOM or changes UI state itself (M2-13 rule)', () => {
    const initialHtml = document.body.innerHTML;
    const initialClassCount = document.body.classList.length;

    tracker.recordEvent('tap_miss');
    tracker.recordEvent('tap_miss');
    tracker.recordEvent('tap_miss');

    tracker.recordEvent('asr_timeout');
    tracker.recordEvent('asr_timeout');

    // Asserts tracker leaves the DOM completely untouched
    expect(document.body.innerHTML).toBe(initialHtml);
    expect(document.body.classList.length).toBe(initialClassCount);
  });
});
