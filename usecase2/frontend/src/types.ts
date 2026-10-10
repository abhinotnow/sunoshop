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
  parent_asin?: string;
  title: string;
  price_inr: number;
  pan: number; // -1 (left), 0 (center), +1 (right)
  alt_text: string;
}

export interface CartItem {
  product_id: string;
  parent_asin?: string;
  title: string;
  price_inr: number;
  qty?: number;
  quantity?: number;
  unit_price_inr?: number;
  total_price_inr?: number;
}

export interface RemovedFee {
  name: string;
  amount_inr?: number;
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
  audio?: string; // Base64 WAV
  audio_base64?: string; // Standard Base64 in CONTRACT.md
  content_type?: 'audio/wav';
  sample_rate_hz?: 16000;
  channels?: 1;
  duration_ms?: number;
  lang?: string;
}

export interface UIEventMessage {
  type: 'ui.event';
  kind: 'tap_miss' | 'asr_timeout' | 'explain_again';
}

export interface CheckoutActionMessage {
  type: 'checkout.action';
  action: 'start' | 'confirm_audio' | 'cancel';
  audio_base64?: string;
  phrase?: string;
}

export interface OrderItem {
  order_id: string;
  parent_asin?: string;
  title: string;
  price_inr: number;
  status: 'PROCESSING' | 'SHIPPED' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'RETURN_INITIATED';
  next_step: string;
  delivery_date: string;
  return_eligible: boolean;
  return_reason?: string;
  return_seller_note?: string;
  pickup_date?: string;
}

export interface OrderTrackActionMessage {
  type: 'order.track';
  order_id?: string;
}

export interface OrderReturnActionMessage {
  type: 'order.return';
  order_id: string;
  reason: string;
  lang?: string;
}

export type ClientMessage =
  | SessionStartMessage
  | AudioUtteranceMessage
  | UIEventMessage
  | CheckoutActionMessage
  | OrderTrackActionMessage
  | OrderReturnActionMessage;

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
  audio_base64?: string;
  content_type?: 'audio/wav';
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
  total_inr?: number;
  removed_fees: Array<string | RemovedFee>;
}

export interface ConfirmChallengeMessage {
  type: 'confirm.challenge';
  phrase: string;
  lang?: string;
  attempts_remaining?: number;
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

export interface OrderStatusMessage {
  type: 'order.status';
  orders: OrderItem[];
}

export interface OrderReturnResultMessage {
  type: 'order.return_result';
  order_id: string;
  status: 'APPROVED' | 'INELIGIBLE';
  seller_note_en: string;
  pickup_date: string;
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
  | ErrorMessage
  | OrderStatusMessage
  | OrderReturnResultMessage;


