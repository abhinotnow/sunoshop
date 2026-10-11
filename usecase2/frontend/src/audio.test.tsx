// Unit tests for WAV encoding, VAD auto-capture, sentence playback, captions, haptics, and spatial audio panners
// Exports test suites for audio.ts and Controls.tsx
// Depends on vitest, @testing-library/react, ./audio, ./components/Controls

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import {
  encodeWAV,
  wavDurationMs,
  calculateRMS,
  EnergyVAD,
  SentencePlaybackQueue,
  calculateContrastRatio,
  triggerHaptic,
  HAPTIC_PATTERNS,
  playSpatialShelf,
  SpatialProductItem,
} from './audio';
import Controls from './components/Controls';
import { createApiClient } from './api';
import { ReplySentenceMessage } from './types';

describe('M2-04, M2-05, M2-06, M2-07, M2-11 Audio Processing, Captions, Haptics & Spatial Audio Tests', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('encodes exact 16kHz mono 16-bit PCM WAV header', () => {
    // Generate 160 samples (10 ms at 16 kHz)
    const samples = new Float32Array(160);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.sin((i / 160) * Math.PI * 2);
    }

    const wavBuffer = encodeWAV(samples, 16000);
    expect(wavBuffer.byteLength).toBe(44 + 160 * 2);

    const view = new DataView(wavBuffer);
    const readString = (offset: number, len: number) => {
      let str = '';
      for (let i = 0; i < len; i++) {
        str += String.fromCharCode(view.getUint8(offset + i));
      }
      return str;
    };

    // 1. RIFF chunk descriptor
    expect(readString(0, 4)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(36 + 160 * 2);
    expect(readString(8, 4)).toBe('WAVE');

    // 2. fmt sub-chunk
    expect(readString(12, 4)).toBe('fmt ');
    expect(view.getUint32(16, true)).toBe(16); // Subchunk1Size = 16 for PCM
    expect(view.getUint16(20, true)).toBe(1); // AudioFormat = 1 (PCM)
    expect(view.getUint16(22, true)).toBe(1); // NumChannels = 1 (Mono)
    expect(view.getUint32(24, true)).toBe(16000); // SampleRate = 16000
    expect(view.getUint32(28, true)).toBe(32000); // ByteRate = 16000 * 1 * 2 = 32000
    expect(view.getUint16(32, true)).toBe(2); // BlockAlign = 1 * 2 = 2
    expect(view.getUint16(34, true)).toBe(16); // BitsPerSample = 16

    // 3. data sub-chunk
    expect(readString(36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(160 * 2); // Subchunk2Size
  });

  it('computes the duration field required by the audio WebSocket contract', () => {
    const wav = new Blob([encodeWAV(new Float32Array(16000), 16000)], { type: 'audio/wav' });
    expect(wavDurationMs(wav)).toBe(1000);
  });

  it('calculates RMS energy correctly for silent and active audio', () => {
    const silentSamples = new Float32Array(100); // all zeros
    expect(calculateRMS(silentSamples)).toBe(0);

    // Audio with DC amplitude 0.5
    const activeSamples = new Float32Array(100).fill(0.5);
    expect(calculateRMS(activeSamples)).toBeCloseTo(0.5, 4);
  });

  it('VAD starts on synthetic speech and stops on synthetic silence', () => {
    // 1600 samples per chunk = 100 ms at 16000 Hz
    const vad = new EnergyVAD({
      speechThreshold: 0.02,
      silenceThreshold: 0.01,
      silenceDurationMs: 300,   // 3 chunks of silence to trigger stop
      minSpeechDurationMs: 200, // 2 chunks of speech minimum
      sampleRate: 16000,
    });

    const silentChunk = new Float32Array(1600); // all 0, RMS = 0
    const speechChunk = new Float32Array(1600); // sine wave, amplitude 0.2, RMS ~ 0.14
    for (let i = 0; i < 1600; i++) {
      speechChunk[i] = 0.2 * Math.sin((i / 50) * Math.PI * 2);
    }

    // 1. Initial silence: speech should not start
    const step1 = vad.processChunk(silentChunk);
    expect(step1.speechStarted).toBe(false);
    expect(step1.isSpeaking).toBe(false);
    expect(step1.speechEnded).toBe(false);

    // 2. Speech arrives: speech starts
    const step2 = vad.processChunk(speechChunk);
    expect(step2.speechStarted).toBe(true);
    expect(step2.isSpeaking).toBe(true);
    expect(step2.speechEnded).toBe(false);

    // 3. Continued speech: stays speaking
    const step3 = vad.processChunk(speechChunk);
    expect(step3.speechStarted).toBe(false);
    expect(step3.isSpeaking).toBe(true);
    expect(step3.speechEnded).toBe(false);

    // 4. First silent chunk (100 ms of silence): not enough to stop (threshold is 300 ms)
    const step4 = vad.processChunk(silentChunk);
    expect(step4.isSpeaking).toBe(true);
    expect(step4.speechEnded).toBe(false);

    // 5. Second silent chunk (200 ms total silence): still not enough
    const step5 = vad.processChunk(silentChunk);
    expect(step5.isSpeaking).toBe(true);
    expect(step5.speechEnded).toBe(false);

    // 6. Third silent chunk (300 ms total silence): triggers speech stop!
    const step6 = vad.processChunk(silentChunk);
    expect(step6.isSpeaking).toBe(false);
    expect(step6.speechEnded).toBe(true);
  });

  it('renders push-to-talk button with >=48px touch target and accessible name', () => {
    const mockClient = createApiClient(true);
    render(<Controls apiClient={mockClient} currentLang="en" />);

    const button = screen.getByRole('button', { name: /start recording voice query/i });
    expect(button).toBeDefined();

    // Check accessible name and ARIA pressed
    expect(button.getAttribute('aria-label')).toBe('Start recording voice query');
    expect(button.getAttribute('aria-pressed')).toBe('false');

    // Ensure touch target meets >=48px requirement
    expect(button.className).toContain('min-h-');
    expect(button.className).toContain('min-w-');
    expect(button.className).toMatch(/min-h-\[(56|64|72)px\]/);
    expect(button.className).toMatch(/min-w-\[(56|64|72)px\]/);
  });

  it('supports toggling between Push-to-Talk and Auto VAD modes', () => {
    const mockClient = createApiClient(true);
    render(<Controls apiClient={mockClient} currentLang="en" />);

    const pttButton = screen.getByRole('button', { name: /^push-to-talk$/i });
    const vadButton = screen.getByRole('button', { name: /auto vad \(hands-free\)/i });

    expect(pttButton).toBeDefined();
    expect(vadButton).toBeDefined();

    // Both mode toggle buttons must meet >= 48px touch target
    expect(pttButton.className).toContain('min-h-[48px]');
    expect(vadButton.className).toContain('min-h-[48px]');

    // Initially in push-to-talk mode
    expect(pttButton.getAttribute('aria-pressed')).toBe('true');
    expect(vadButton.getAttribute('aria-pressed')).toBe('false');

    // Click Auto VAD toggle
    fireEvent.click(vadButton);
    expect(pttButton.getAttribute('aria-pressed')).toBe('false');
    expect(vadButton.getAttribute('aria-pressed')).toBe('true');

    // Main action button updates to hands-free label
    const mainButton = screen.getByRole('button', { name: /start hands-free voice detection/i });
    expect(mainButton).toBeDefined();
  });

  it('plays out-of-order reply sentences strictly in idx order with pauses and rates', async () => {
    const playedOrder: number[] = [];
    const playedRates: (number | undefined)[] = [];

    const queue = new SentencePlaybackQueue({
      playHandler: async (sentence) => {
        playedOrder.push(sentence.idx);
        playedRates.push(sentence.rate);
      },
    });

    const s0: ReplySentenceMessage = {
      type: 'reply.sentence',
      idx: 0,
      text: 'First sentence.',
      pause_ms: 10,
      rate: 1.0,
    };
    const s1: ReplySentenceMessage = {
      type: 'reply.sentence',
      idx: 1,
      text: 'Second sentence.',
      pause_ms: 10,
      rate: 0.9,
    };
    const s2: ReplySentenceMessage = {
      type: 'reply.sentence',
      idx: 2,
      text: 'Third sentence.',
      pause_ms: 10,
      rate: 0.8,
    };

    // Enqueue deliberately out of order: 2, then 0, then 1
    queue.enqueue(s2);
    expect(playedOrder).toEqual([]); // idx 0 not arrived yet, cannot play idx 2

    queue.enqueue(s0); // idx 0 arrives -> plays idx 0, then waits for idx 1
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(playedOrder).toEqual([0]);

    queue.enqueue(s1); // idx 1 arrives -> plays idx 1, then immediately plays idx 2
    await new Promise((resolve) => setTimeout(resolve, 60));

    // Must be in strict order: 0, 1, 2
    expect(playedOrder).toEqual([0, 1, 2]);
    expect(playedRates).toEqual([1.0, 0.9, 0.8]);
  });

  it('caption bar colors meet WCAG AAA contrast ratio >= 7:1', () => {
    // White text on pure black background
    const whiteOnBlack = calculateContrastRatio('#ffffff', '#000000');
    expect(whiteOnBlack).toBe(21);
    expect(whiteOnBlack).toBeGreaterThanOrEqual(7.0);

    // High-visibility yellow on black background
    const yellowOnBlack = calculateContrastRatio('#facc15', '#000000');
    expect(yellowOnBlack).toBeGreaterThanOrEqual(7.0);
  });

  it('renders high-contrast caption bar when reply.sentence message is received', async () => {
    const mockClient = createApiClient(true);
    render(<Controls apiClient={mockClient} currentLang="en" />);

    // Simulate incoming reply.sentence message
    act(() => {
      mockClient.send({
        type: 'audio.utterance',
        audio: 'dGVzdA==',
        duration_ms: 1000,
      });
    });

    // Mock server automatically emits reply.sentence messages
    const captionBar = await screen.findByRole('status');
    expect(captionBar).toBeDefined();
    expect(captionBar.getAttribute('aria-live')).toBe('polite');
    expect(captionBar.textContent?.toLowerCase()).toContain('live caption');
  });

  describe('M2-07 Haptics Vibration Tests', () => {
    it('safely no-ops and returns false when navigator.vibrate is unsupported', () => {
      // In jsdom environment, navigator.vibrate is normally undefined
      const originalVibrate = (navigator as any).vibrate;
      delete (navigator as any).vibrate;

      expect(triggerHaptic('listening')).toBe(false);
      expect(triggerHaptic('success')).toBe(false);
      expect(triggerHaptic('error')).toBe(false);

      if (originalVibrate) {
        (navigator as any).vibrate = originalVibrate;
      }
    });

    it('triggers distinct vibration patterns when navigator.vibrate is supported', () => {
      const mockVibrate = vi.fn().mockReturnValue(true);
      (navigator as any).vibrate = mockVibrate;

      // 1. Listening pattern
      const listeningResult = triggerHaptic('listening');
      expect(listeningResult).toBe(true);
      expect(mockVibrate).toHaveBeenCalledWith(HAPTIC_PATTERNS.listening);
      expect(mockVibrate).toHaveBeenCalledWith(40);

      // 2. Success pattern
      const successResult = triggerHaptic('success');
      expect(successResult).toBe(true);
      expect(mockVibrate).toHaveBeenCalledWith(HAPTIC_PATTERNS.success);
      expect(mockVibrate).toHaveBeenCalledWith([50, 60, 50]);

      // 3. Error pattern
      const errorResult = triggerHaptic('error');
      expect(errorResult).toBe(true);
      expect(mockVibrate).toHaveBeenCalledWith(HAPTIC_PATTERNS.error);
      expect(mockVibrate).toHaveBeenCalledWith([150, 80, 150, 80, 200]);
    });

    it('safely handles unexpected exceptions in navigator.vibrate without throwing', () => {
      const throwingVibrate = vi.fn().mockImplementation(() => {
        throw new Error('Vibration permission denied');
      });
      (navigator as any).vibrate = throwingVibrate;

      expect(() => triggerHaptic('listening')).not.toThrow();
      expect(triggerHaptic('listening')).toBe(false);
    });
  });

  describe('M2-11 Spatial Audio Panning Tests', () => {
    it('creates three StereoPannerNodes with exact pan values -1, 0, and 1 for top-3 products', async () => {
      const top3Products: SpatialProductItem[] = [
        { id: 'p_1', title: 'Running Shoe Left', pan: -1.0 },
        { id: 'p_2', title: 'Trail Shoe Center', pan: 0.0 },
        { id: 'p_3', title: 'Sneaker Right', pan: 1.0 },
      ];

      const pannersCreated: any[] = [];
      const mockCreateStereoPanner = vi.fn().mockImplementation(() => {
        const panner = {
          pan: { value: 0 },
          connect: vi.fn(),
        };
        pannersCreated.push(panner);
        return panner;
      });

      const mockAudioContext: any = {
        createStereoPanner: mockCreateStereoPanner,
        createOscillator: vi.fn().mockReturnValue({
          type: 'sine',
          frequency: { setValueAtTime: vi.fn() },
          connect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
        }),
        createGain: vi.fn().mockReturnValue({
          gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
          connect: vi.fn(),
        }),
        destination: {},
        currentTime: 0,
      };

      const result = await playSpatialShelf(top3Products, {
        audioContext: mockAudioContext,
        durationPerItemMs: 10,
      });

      // Done when: test asserts three panners with the right pan values
      expect(mockCreateStereoPanner).toHaveBeenCalledTimes(3);
      expect(pannersCreated.length).toBe(3);
      expect(pannersCreated[0].pan.value).toBe(-1.0);
      expect(pannersCreated[1].pan.value).toBe(0.0);
      expect(pannersCreated[2].pan.value).toBe(1.0);
      expect(result.pannersUsed).toEqual([-1.0, 0.0, 1.0]);
      expect(result.fallbackUsed).toBe(false);
    });

    it('falls back to sequential mono playback when stereo panner is unavailable', async () => {
      const top3Products: SpatialProductItem[] = [
        { id: 'p_1', title: 'Item 1', pan: -1.0 },
        { id: 'p_2', title: 'Item 2', pan: 0.0 },
        { id: 'p_3', title: 'Item 3', pan: 1.0 },
      ];

      const itemsStarted: number[] = [];
      const result = await playSpatialShelf(top3Products, {
        audioContext: {} as any,
        durationPerItemMs: 10,
        onItemStart: (_item, _index, pan) => {
          itemsStarted.push(pan);
        },
      });

      expect(result.fallbackUsed).toBe(true);
      expect(result.pannersUsed).toEqual([0, 0, 0]);
      expect(itemsStarted).toEqual([0, 0, 0]); // all mono centered
    });
  });
});

