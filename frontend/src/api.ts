// Typed WebSocket client with an in-file mock server for offline/standalone operation
// Exports SunoApiClient, createApiClient, and MockSunoServer
// Depends on ./types
import {
  ClientMessage,
  ServerMessage,
  ShelfProduct,
  CartItem,
} from './types';

export type MessageHandler = (msg: ServerMessage) => void;

export interface SunoApiClient {
  connect: (url?: string) => Promise<void>;
  send: (msg: ClientMessage) => void;
  onMessage: (handler: MessageHandler) => () => void;
  disconnect: () => void;
  isMock: boolean;
}

// In-file mock server answering every message type with realistic data
export class MockSunoServer {
  private handlers: MessageHandler[] = [];
  private cart: CartItem[] = [
    {
      product_id: 'p_001',
      title: 'Comfort Walking Shoes',
      price_inr: 1999,
      qty: 1,
    },
  ];

  public addListener(handler: MessageHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  public emit(msg: ServerMessage): void {
    this.handlers.forEach((h) => h(msg));
  }

  public handleClientMessage(msg: ClientMessage): void {
    switch (msg.type) {
      case 'session.start': {
        this.emit({
          type: 'asr.result',
          text: 'Session started in ' + msg.lang,
          plausible: true,
        });
        break;
      }

      case 'audio.utterance': {
        // If utterance is flagged or empty, test check_again
        if (msg.audio === 'BAD_AUDIO') {
          this.emit({
            type: 'check_again',
            reason: 'Audio energy too low or background noise too high',
          });
          return;
        }

        // Emit ASR transcription result
        this.emit({
          type: 'asr.result',
          text: 'Show me running shoes with good cushion',
          plausible: true,
        });

        // Emit top-3 shelf results with left-center-right spatial pan
        const mockProducts: ShelfProduct[] = [
          {
            id: 'p_001',
            parent_asin: 'p_001',
            title: 'UltraCushion Pro Runner',
            price_inr: 3499,
            pan: -1.0, // Left
            alt_text: 'Black running shoe with white responsive foam sole',
          },
          {
            id: 'p_002',
            parent_asin: 'p_002',
            title: 'AeroGrip Trail Walker',
            price_inr: 2799,
            pan: 0.0, // Center
            alt_text: 'Navy blue trail shoe with high-traction rubber lugs',
          },
          {
            id: 'p_003',
            parent_asin: 'p_003',
            title: 'Slip-On Ortho Comfort',
            price_inr: 2199,
            pan: 1.0, // Right
            alt_text: 'Grey slip-on sneaker with memory foam insole',
          },
        ];

        this.emit({
          type: 'shelf.results',
          products: mockProducts,
        });

        // Emit synthesized spoken response sentence
        this.emit({
          type: 'reply.sentence',
          idx: 0,
          text: 'Found 3 cushioned shoes. The UltraCushion Pro on your left has highest support.',
          audio_base64: 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=',
          content_type: 'audio/wav',
          pause_ms: 300,
          rate: 1.0,
        });

        // Mark reply grounded & completed
        this.emit({
          type: 'reply.done',
          grounded: true,
        });
        break;
      }

      case 'ui.event': {
        const adaptationMap: Record<string, { adaptation: string; reason: string }> = {
          tap_miss: {
            adaptation: 'large_touch_targets',
            reason: 'Frequent touch offsets detected. Enlarge buttons to 72px?',
          },
          asr_timeout: {
            adaptation: 'prolonged_silence_window',
            reason: 'Repeated speech pauses detected. Extend listening window?',
          },
          explain_again: {
            adaptation: 'explain_simpler_mode',
            reason: 'Repeated clarification requests. Activate Simpler Explanation mode?',
          },
        };

        const offer = adaptationMap[msg.kind] || {
          adaptation: 'accessible_assist',
          reason: 'UI friction detected.',
        };

        this.emit({
          type: 'adapt.offer',
          adaptation: offer.adaptation,
          reason: offer.reason,
        });
        break;
      }

      case 'checkout.action': {
        if (msg.action === 'start') {
          // Emits checkout state with dark-pattern fee stripping
          this.emit({
            type: 'checkout.state',
            state: 'GUARDED',
            cart: this.cart,
            removed_fees: [
              'Pre-selected shipping protection (₹49)',
              'Priority handling fee (₹29)',
            ],
          });

          // Emits verbal confirmation challenge phrase
          this.emit({
            type: 'confirm.challenge',
            phrase: 'Confirm Blue Falcon',
          });
        } else if (msg.action === 'confirm_audio') {
          this.emit({
            type: 'checkout.state',
            state: 'ORDER_PLACED',
            cart: this.cart,
            removed_fees: [],
          });
        } else if (msg.action === 'cancel') {
          this.emit({
            type: 'checkout.state',
            state: 'BROWSING',
            cart: this.cart,
            removed_fees: [],
          });
        }
        break;
      }
    }
  }

  // Helper method to simulate backend error events for testing
  public emitError(code: string, fallback: 'retry' | 'offline'): void {
    this.emit({
      type: 'error',
      code,
      fallback,
    });
  }
}

// Client factory function
export function createApiClient(forceMock?: boolean): SunoApiClient {
  const useMock =
    forceMock !== undefined
      ? forceMock
      : (import.meta as any).env?.VITE_USE_MOCK !== 'false';

  const mockServer = new MockSunoServer();
  let ws: WebSocket | null = null;
  const handlers: MessageHandler[] = [];

  if (useMock) {
    mockServer.addListener((msg) => {
      handlers.forEach((h) => h(msg));
    });
  }

  return {
    isMock: useMock,

    connect: async (url = 'ws://localhost:8000/ws') => {
      if (useMock) {
        return;
      }

      return new Promise<void>((resolve, reject) => {
        try {
          ws = new WebSocket(url);
          ws.onmessage = (event) => {
            const parsed = JSON.parse(event.data) as ServerMessage;
            handlers.forEach((h) => h(parsed));
          };
          ws.onopen = () => resolve();
          ws.onerror = (err) => reject(err);
        } catch (err) {
          reject(err);
        }
      });
    },

    send: (msg: ClientMessage) => {
      if (useMock) {
        mockServer.handleClientMessage(msg);
      } else if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    },

    onMessage: (handler: MessageHandler) => {
      handlers.push(handler);
      return () => {
        const idx = handlers.indexOf(handler);
        if (idx !== -1) handlers.splice(idx, 1);
      };
    },

    disconnect: () => {
      if (ws) {
        ws.close();
        ws = null;
      }
    },
  };
}
