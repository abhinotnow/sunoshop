// Unit tests for voice price filter parser
// Exports test suite for voiceFilter.ts
// Depends on vitest, ./voiceFilter

import { describe, it, expect } from 'vitest';
import { parseVoicePrice, formatPriceINR } from './voiceFilter';

describe('M2-12 Voice Price Filter Utility Tests', () => {
  it('parses spoken number words like "under fifteen thousand"', () => {
    expect(parseVoicePrice('under fifteen thousand')).toBe(15000);
    expect(parseVoicePrice('show me running shoes under fifteen thousand')).toBe(15000);
    expect(parseVoicePrice('under three thousand')).toBe(3000);
    expect(parseVoicePrice('below five thousand')).toBe(5000);
    expect(parseVoicePrice('less than twenty thousand')).toBe(20000);
  });

  it('parses numeric digits with keywords', () => {
    expect(parseVoicePrice('under 15000')).toBe(15000);
    expect(parseVoicePrice('under 15,000')).toBe(15000);
    expect(parseVoicePrice('below ₹2,500')).toBe(2500);
    expect(parseVoicePrice('less than 3000 inr')).toBe(3000);
    expect(parseVoicePrice('budget up to 4000')).toBe(4000);
  });

  it('parses shorthand notations like "15k" and "1.5k"', () => {
    expect(parseVoicePrice('under 15k')).toBe(15000);
    expect(parseVoicePrice('under 10k')).toBe(10000);
    expect(parseVoicePrice('below 2.5k')).toBe(2500);
  });

  it('parses Hindi and Hinglish price queries', () => {
    expect(parseVoicePrice('3000 se kam')).toBe(3000);
    expect(parseVoicePrice('teen hazaar se kam')).toBe(3000);
    expect(parseVoicePrice('paanch hazaar ke andar')).toBe(5000);
    expect(parseVoicePrice('पंद्रह हज़ार से कम')).toBe(15000);
  });

  it('parses Telugu price queries', () => {
    expect(parseVoicePrice('3000 lopala')).toBe(3000);
    expect(parseVoicePrice('moodu velu lopala')).toBe(3000);
    expect(parseVoicePrice('ఐదు వేల లోపు')).toBe(5000);
  });

  it('returns null for queries without price constraint triggers', () => {
    expect(parseVoicePrice('show me black shoes')).toBeNull();
    expect(parseVoicePrice('size 9 running shoes')).toBeNull();
    expect(parseVoicePrice('')).toBeNull();
  });

  it('formats prices into localized INR strings', () => {
    expect(formatPriceINR(15000)).toBe('₹15,000');
    expect(formatPriceINR(2999)).toBe('₹2,999');
  });
});
