// Unit tests verifying typed WebSocket client and mock server response for every message type in CONTRACT
// Exports test suite for api.ts
// Depends on vitest, ./api, ./types
import { describe, it, expect, beforeEach } from 'vitest';
import { createApiClient, MockSunoServer, SunoApiClient, MetricsLogger, metricsLogger } from './api';
import {
  ServerMessage,
  AsrResultMessage,
  CheckAgainMessage,
  ReplySentenceMessage,
  ReplyDoneMessage,
  ShelfResultsMessage,
  CheckoutStateMessage,
  ConfirmChallengeMessage,
  AdaptOfferMessage,
  ErrorMessage,
} from './types';

describe('M2-03 API Client & Mock Server (Contract Verification)', () => {
  let client: SunoApiClient;
  let receivedMessages: ServerMessage[];

  beforeEach(async () => {
    receivedMessages = [];
    client = createApiClient(true); // Force mock mode
    await client.connect();
    client.onMessage((msg) => {
      receivedMessages.push(msg);
    });
  });

  it('handles message type 1: asr.result', () => {
    client.send({ type: 'session.start', lang: 'te' });
    const asr = receivedMessages.find((m) => m.type === 'asr.result') as AsrResultMessage;
    expect(asr).toBeDefined();
    expect(asr.plausible).toBe(true);
    expect(asr.text).toContain('te');
  });

  it('handles message type 2: check_again', () => {
    client.send({ type: 'audio.utterance', audio: 'BAD_AUDIO' });
    const checkAgain = receivedMessages.find((m) => m.type === 'check_again') as CheckAgainMessage;
    expect(checkAgain).toBeDefined();
    expect(checkAgain.reason).toContain('Audio energy too low');
  });

  it('handles message type 3: reply.sentence', () => {
    client.send({ type: 'audio.utterance', audio: 'SAMPLE_AUDIO' });
    const reply = receivedMessages.find((m) => m.type === 'reply.sentence') as ReplySentenceMessage;
    expect(reply).toBeDefined();
    expect(reply.idx).toBe(0);
    expect(reply.text.length).toBeGreaterThan(0);
    expect(reply.rate).toBe(1.0);
  });

  it('handles message type 4: reply.done', () => {
    client.send({ type: 'audio.utterance', audio: 'SAMPLE_AUDIO' });
    const done = receivedMessages.find((m) => m.type === 'reply.done') as ReplyDoneMessage;
    expect(done).toBeDefined();
    expect(done.grounded).toBe(true);
  });

  it('handles message type 5: shelf.results with spatial pan', () => {
    client.send({ type: 'audio.utterance', audio: 'SAMPLE_AUDIO' });
    const shelf = receivedMessages.find((m) => m.type === 'shelf.results') as ShelfResultsMessage;
    expect(shelf).toBeDefined();
    expect(shelf.products.length).toBe(3);
    // Check spatial audio pans: left (-1), center (0), right (+1)
    expect(shelf.products[0].pan).toBe(-1.0);
    expect(shelf.products[1].pan).toBe(0.0);
    expect(shelf.products[2].pan).toBe(1.0);
    expect(shelf.products[0].alt_text).toBeDefined();
  });

  it('handles message type 6: checkout.state (dark pattern stripped)', () => {
    client.send({ type: 'checkout.action', action: 'start' });
    const checkout = receivedMessages.find((m) => m.type === 'checkout.state') as CheckoutStateMessage;
    expect(checkout).toBeDefined();
    expect(checkout.state).toBe('GUARDED');
    expect(checkout.cart.length).toBeGreaterThan(0);
    // Dark pattern protection
    expect(checkout.removed_fees.length).toBe(2);
  });

  it('handles message type 7: confirm.challenge phrase', () => {
    client.send({ type: 'checkout.action', action: 'start' });
    const challenge = receivedMessages.find((m) => m.type === 'confirm.challenge') as ConfirmChallengeMessage;
    expect(challenge).toBeDefined();
    expect(challenge.phrase).toBe('Confirm Blue Falcon');
  });

  it('handles message type 8: adapt.offer for friction event', () => {
    client.send({ type: 'ui.event', kind: 'tap_miss' });
    const adapt = receivedMessages.find((m) => m.type === 'adapt.offer') as AdaptOfferMessage;
    expect(adapt).toBeDefined();
    expect(adapt.adaptation).toBe('large_touch_targets');
  });

  it('handles message type 9: error with fallback offline/retry', () => {
    const rawMock = new MockSunoServer();
    const errors: ErrorMessage[] = [];
    rawMock.addListener((msg) => {
      if (msg.type === 'error') errors.push(msg);
    });

    rawMock.emitError('BHASHINI_TIMEOUT', 'offline');
    expect(errors.length).toBe(1);
    expect(errors[0].code).toBe('BHASHINI_TIMEOUT');
    expect(errors[0].fallback).toBe('offline');
  });
});

describe('M2-23 Metrics Logging Tests', () => {
  beforeEach(() => {
    metricsLogger.clear();
  });

  it('tracks time-to-information and words-listened-before-action per scripted task', async () => {
    metricsLogger.startTask('task_001', 'search');

    // Simulate agent speaking initial recommendations
    metricsLogger.recordSentence('We found three highly rated cushioned running shoes.');
    metricsLogger.recordSentence('On your left is the UltraCushion Pro for ₹3499.');

    // User listens and receives key information
    metricsLogger.markInformationReceived();

    // User takes action (e.g. adding to cart or asking to filter)
    metricsLogger.recordAction('add_to_cart_p001');

    const record = metricsLogger.endTask();

    expect(record).toBeDefined();
    expect(record?.taskId).toBe('task_001');
    expect(record?.taskType).toBe('search');
    expect(record?.completed).toBe(true);
    expect(record?.wordsListenedBeforeAction).toBeGreaterThan(10);
    expect(record?.actionTaken).toBe('add_to_cart_p001');
    expect(typeof record?.timeToInfoMs).toBe('number');
  });

  it('exports task records as valid JSON format', () => {
    const customLogger = new MetricsLogger();
    customLogger.startTask('task_eval_1', 'offline_lookup');
    customLogger.recordSentence('The Redmi Note 13 has a battery of 5000mAh.');
    customLogger.recordAction('view_specs');
    customLogger.endTask();

    const json = customLogger.exportJSON();
    expect(typeof json).toBe('string');

    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(1);
    expect(parsed[0].taskId).toBe('task_eval_1');
    expect(parsed[0].actionTaken).toBe('view_specs');
  });
});
