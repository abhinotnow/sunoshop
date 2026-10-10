// Friction tracker monitoring accessibility friction events in a sliding window and emitting non-intrusive adaptation offers
// Exports FrictionTracker, createFrictionTracker, FrictionEventKind, AdaptationType, AdaptationOffer
// Depends on nothing

export type FrictionEventKind = 'tap_miss' | 'asr_timeout' | 'explain_again';

export type AdaptationType =
  | 'larger_targets'
  | 'slower_speech'
  | 'longer_silence_window'
  | 'explain_simpler';

export interface FrictionEvent {
  kind: FrictionEventKind;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface AdaptationOffer {
  adaptation: AdaptationType;
  reason: string;
  triggerEvent: FrictionEventKind;
  thresholdReached: number;
  timestamp: number;
}

export interface FrictionTrackerConfig {
  windowDurationMs?: number;
  thresholds?: Partial<Record<FrictionEventKind, number>>;
  cooldownMs?: number;
}

const DEFAULT_CONFIG: {
  windowDurationMs: number;
  thresholds: Record<FrictionEventKind, number>;
  cooldownMs: number;
} = {
  windowDurationMs: 60_000, // 60-second sliding window
  thresholds: {
    tap_miss: 3, // 3 tap misses -> suggest larger targets (>= 72px)
    asr_timeout: 2, // 2 speech timeouts -> suggest longer listening window / slower speech
    explain_again: 2, // 2 clarification requests -> suggest slower speech / explain simpler
  },
  cooldownMs: 30_000, // 30-second cooldown per adaptation suggestion to avoid alert fatigue
};

export class FrictionTracker {
  private events: FrictionEvent[] = [];
  private listeners: Array<(offer: AdaptationOffer) => void> = [];
  private lastSuggestedTime: Partial<Record<AdaptationType, number>> = {};
  private config: {
    windowDurationMs: number;
    thresholds: Record<FrictionEventKind, number>;
    cooldownMs: number;
  };

  constructor(customConfig?: FrictionTrackerConfig) {
    this.config = {
      windowDurationMs: customConfig?.windowDurationMs ?? DEFAULT_CONFIG.windowDurationMs,
      thresholds: {
        tap_miss: customConfig?.thresholds?.tap_miss ?? DEFAULT_CONFIG.thresholds.tap_miss,
        asr_timeout: customConfig?.thresholds?.asr_timeout ?? DEFAULT_CONFIG.thresholds.asr_timeout,
        explain_again:
          customConfig?.thresholds?.explain_again ?? DEFAULT_CONFIG.thresholds.explain_again,
      },
      cooldownMs: customConfig?.cooldownMs ?? DEFAULT_CONFIG.cooldownMs,
    };
  }

  /**
   * Subscribes a listener to adaptation offers.
   * NOTE: Emits suggestions only — NEVER modifies the UI directly (M2-13 rule).
   */
  public onSuggestion(listener: (offer: AdaptationOffer) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /**
   * Records a user friction event and evaluates sliding window thresholds.
   * If a threshold is crossed and cooldown has elapsed, returns an AdaptationOffer.
   */
  public recordEvent(
    kind: FrictionEventKind,
    metadata?: Record<string, unknown>,
    timestamp?: number
  ): AdaptationOffer | null {
    const now = timestamp ?? Date.now();
    this.events.push({ kind, timestamp: now, metadata });

    // Prune events outside the sliding window
    this.pruneOldEvents(now);

    const count = this.getRecentCount(kind, this.config.windowDurationMs, now);
    const threshold = this.config.thresholds[kind];

    if (count >= threshold) {
      const offer = this.buildOfferForKind(kind, count, now);
      if (offer && this.isEligibleForSuggestion(offer.adaptation, now)) {
        this.lastSuggestedTime[offer.adaptation] = now;
        this.listeners.forEach((listener) => listener(offer));
        return offer;
      }
    }

    return null;
  }

  /**
   * Returns count of events of given kind within the sliding window
   */
  public getRecentCount(
    kind: FrictionEventKind,
    windowDurationMs: number = this.config.windowDurationMs,
    currentTimestamp?: number
  ): number {
    const now = currentTimestamp ?? Date.now();
    const cutoff = now - windowDurationMs;
    return this.events.filter((e) => e.kind === kind && e.timestamp >= cutoff).length;
  }

  /**
   * Returns copy of active events within the sliding window
   */
  public getActiveEvents(currentTimestamp?: number): FrictionEvent[] {
    const now = currentTimestamp ?? Date.now();
    const cutoff = now - this.config.windowDurationMs;
    return this.events.filter((e) => e.timestamp >= cutoff);
  }

  /**
   * Clears all recorded events and reset cooldowns
   */
  public reset(): void {
    this.events = [];
    this.lastSuggestedTime = {};
  }

  private pruneOldEvents(now: number): void {
    const cutoff = now - this.config.windowDurationMs;
    this.events = this.events.filter((e) => e.timestamp >= cutoff);
  }

  private isEligibleForSuggestion(adaptation: AdaptationType, now: number): boolean {
    const lastTime = this.lastSuggestedTime[adaptation];
    if (!lastTime) return true;
    return now - lastTime >= this.config.cooldownMs;
  }

  private buildOfferForKind(
    kind: FrictionEventKind,
    count: number,
    now: number
  ): AdaptationOffer | null {
    switch (kind) {
      case 'tap_miss':
        return {
          adaptation: 'larger_targets',
          reason: `${count} tap offsets detected in ${this.config.windowDurationMs / 1000}s. Would you like larger 72px touch targets?`,
          triggerEvent: kind,
          thresholdReached: count,
          timestamp: now,
        };
      case 'asr_timeout':
        return {
          adaptation: 'slower_speech',
          reason: `${count} speech pauses detected in ${this.config.windowDurationMs / 1000}s. Would you like slower spoken prompts or longer listening time?`,
          triggerEvent: kind,
          thresholdReached: count,
          timestamp: now,
        };
      case 'explain_again':
        return {
          adaptation: 'explain_simpler',
          reason: `${count} repeat requests detected in ${this.config.windowDurationMs / 1000}s. Would you like Simpler Explanations enabled?`,
          triggerEvent: kind,
          thresholdReached: count,
          timestamp: now,
        };
      default:
        return null;
    }
  }
}

/**
 * Factory helper creating a singleton or configured FrictionTracker instance
 */
export function createFrictionTracker(config?: FrictionTrackerConfig): FrictionTracker {
  return new FrictionTracker(config);
}

export interface AdaptationState {
  largeTargets: boolean;
  speechRate: number;
  simplerExplanations: boolean;
  longerSilenceWindow: boolean;
}

export const DEFAULT_ADAPTATION_STATE: AdaptationState = {
  largeTargets: false,
  speechRate: 1.0,
  simplerExplanations: false,
  longerSilenceWindow: false,
};

/**
 * Applies a consented adaptation to the adaptation state (M2-14)
 */
export function applyAdaptation(
  adaptation: AdaptationType,
  current: AdaptationState = DEFAULT_ADAPTATION_STATE
): AdaptationState {
  switch (adaptation) {
    case 'larger_targets':
      return { ...current, largeTargets: true };
    case 'slower_speech':
      return { ...current, speechRate: 0.8 };
    case 'explain_simpler':
      return { ...current, simplerExplanations: true };
    case 'longer_silence_window':
      return { ...current, longerSilenceWindow: true };
    default:
      return current;
  }
}

/**
 * Reverts an active adaptation back to standard default settings (M2-14 reversibility)
 */
export function revertAdaptation(
  adaptation: AdaptationType,
  current: AdaptationState
): AdaptationState {
  switch (adaptation) {
    case 'larger_targets':
      return { ...current, largeTargets: false };
    case 'slower_speech':
      return { ...current, speechRate: 1.0 };
    case 'explain_simpler':
      return { ...current, simplerExplanations: false };
    case 'longer_silence_window':
      return { ...current, longerSilenceWindow: false };
    default:
      return current;
  }
}

