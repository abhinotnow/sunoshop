// Unit tests verifying typed WebSocket client and mock server response for every message type in CONTRACT
// Exports test suite for api.ts
// Depends on vitest, ./api, ./types
import { describe, it, expect, beforeEach } from 'vitest';
import { createApiClient, MockSunoServer, SunoApiClient } from './api';
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
    client.send({ type: 'audio.utterance', audio: 'BAD_AUDIO', duration_ms: 1000 });
    const checkAgain = receivedMessages.find((m) => m.type === 'check_again') as CheckAgainMessage;
    expect(checkAgain).toBeDefined();
    expect(checkAgain.reason).toContain('Audio energy too low');
  });

  it('handles message type 3: reply.sentence', () => {
    client.send({ type: 'audio.utterance', audio: 'SAMPLE_AUDIO', duration_ms: 1000 });
    const reply = receivedMessages.find((m) => m.type === 'reply.sentence') as ReplySentenceMessage;
    expect(reply).toBeDefined();
    expect(reply.idx).toBe(0);
    expect(reply.text.length).toBeGreaterThan(0);
    expect(reply.rate).toBe(1.0);
  });

  it('handles message type 4: reply.done', () => {
    client.send({ type: 'audio.utterance', audio: 'SAMPLE_AUDIO', duration_ms: 1000 });
    const done = receivedMessages.find((m) => m.type === 'reply.done') as ReplyDoneMessage;
    expect(done).toBeDefined();
    expect(done.grounded).toBe(true);
  });

  it('handles message type 5: shelf.results with spatial pan', () => {
    client.send({ type: 'audio.utterance', audio: 'SAMPLE_AUDIO', duration_ms: 1000 });
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

  it('echoes a typed question in demo mode and marks its canned response ungrounded', () => {
    const messages: ServerMessage[] = [];
    const demoClient = createApiClient(true);
    demoClient.onMessage((msg) => messages.push(msg));

    expect(demoClient.sendDemoQuery?.('  Is this shoe waterproof?  ')).toBe(true);
    expect(messages.find((msg) => msg.type === 'asr.result')).toMatchObject({
      text: 'Is this shoe waterproof?',
      plausible: true,
    });
    expect(messages.find((msg) => msg.type === 'reply.sentence')).toMatchObject({
      text: expect.stringContaining('Is this shoe waterproof?'),
    });
    expect(messages.find((msg) => msg.type === 'reply.done')).toMatchObject({ grounded: false });
  });
});
