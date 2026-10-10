// Type definitions for SunoShop Product Knowledge Objects (PKO) and WebSocket client-server contract
// Exports all PKO, ClientMessage, and ServerMessage interfaces and unions
// Depends on nothing
export interface AltTexts {
  en: string;
  hi: string;
  te: string;
}

export interface ReviewDigest {
  pros: string[];
  cons: string[];
  claims_checked: string[];
}

export interface ProductKnowledgeObject {
  id: string;
  title: string;
  brand: string;
  category: string;
  price_inr: number;
  specs: Record<string, string>;
  alt_texts: AltTexts;
  size_chart: Array<Record<string, string>>;
  review_digest: ReviewDigest;
  review_chunks: string[];
}

export interface ShelfProduct {
  id: string;
  title: string;
  price_inr: number;
  pan: number; // -1 (left), 0 (center), +1 (right)
  alt_text: string;
}

export interface CartItem {
  product_id: string;
  title: string;
  price_inr: number;
  qty: number;
}

// Client -> Server (C->S) messages
export interface SessionStartMessage {
  type: 'session.start';
  lang: string;
  mode?: string;
  rate?: number;
}

export interface AudioUtteranceMessage {
  type: 'audio.utterance';
  audio: string; // Base64 or WAV payload
  lang?: string;
}

export interface UIEventMessage {
  type: 'ui.event';
  kind: 'tap_miss' | 'asr_timeout' | 'explain_again';
}

export interface CheckoutActionMessage {
  type: 'checkout.action';
  action: 'start' | 'confirm_audio' | 'cancel';
  phrase?: string;
}

export type ClientMessage =
  | SessionStartMessage
  | AudioUtteranceMessage
  | UIEventMessage
  | CheckoutActionMessage;

// Server -> Client (S->C) messages
export interface AsrResultMessage {
  type: 'asr.result';
  text: string;
  plausible: boolean;
}

export interface CheckAgainMessage {
  type: 'check_again';
  reason: string;
}

export interface ReplySentenceMessage {
  type: 'reply.sentence';
  idx: number;
  text: string;
  audio?: string;
  pause_ms?: number;
  rate?: number;
}

export interface ReplyDoneMessage {
  type: 'reply.done';
  grounded: boolean;
}

export interface ShelfResultsMessage {
  type: 'shelf.results';
  products: ShelfProduct[];
}

export interface CheckoutStateMessage {
  type: 'checkout.state';
  state: 'BROWSING' | 'CART_REVIEW' | 'GUARDED' | 'AWAITING_CONFIRM' | 'ORDER_PLACED';
  cart: CartItem[];
  removed_fees: string[];
}

export interface ConfirmChallengeMessage {
  type: 'confirm.challenge';
  phrase: string;
}

export interface AdaptOfferMessage {
  type: 'adapt.offer';
  adaptation: string;
  reason: string;
}

export interface ErrorMessage {
  type: 'error';
  code: string;
  fallback: 'retry' | 'offline';
}

export type ServerMessage =
  | AsrResultMessage
  | CheckAgainMessage
  | ReplySentenceMessage
  | ReplyDoneMessage
  | ShelfResultsMessage
  | CheckoutStateMessage
  | ConfirmChallengeMessage
  | AdaptOfferMessage
  | ErrorMessage;
