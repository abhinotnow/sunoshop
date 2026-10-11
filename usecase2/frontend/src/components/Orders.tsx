// Accessible order tracking and returns panel with Indic-to-English reason translation, live-region announcements, and haptic feedback
// Exports default Orders component and OrdersProps interface
// Implements M2-18 (Tracking + returns) -> SYNC-D ready
// Depends on react, ../types, ../api, ../audio, ../i18n, ../voiceFilter

import React, { useState, useEffect } from 'react';
import {
  OrderItem,
  OrderStatusMessage,
  OrderReturnResultMessage,
} from '../types';
import { SunoApiClient } from '../api';
import { triggerHaptic } from '../audio';
import { Language } from '../i18n';
import { formatPriceINR } from '../voiceFilter';

export interface OrdersProps {
  apiClient: SunoApiClient;
  isOpen?: boolean;
  onClose?: () => void;
  onAnnounce?: (message: string, priority?: 'polite' | 'assertive') => void;
  currentLang?: Language;
  largeTargets?: boolean;
}

export default function Orders({
  apiClient,
  isOpen = true,
  onClose,
  onAnnounce,
  currentLang = 'en',
  largeTargets = false,
}: OrdersProps): React.ReactElement | null {
  const [orders, setOrders] = useState<OrderItem[]>([
    {
      order_id: 'ORD-320981',
      parent_asin: 'p_001',
      title: 'UltraCushion Pro Runner',
      price_inr: 3499,
      status: 'DELIVERED',
      next_step: 'Delivered on 9th Oct. Return window open until 16th Oct.',
      delivery_date: '9th October 2026',
      return_eligible: true,
    },
    {
      order_id: 'ORD-320982',
      parent_asin: 'p_002',
      title: 'AeroGrip Trail Walker',
      price_inr: 2799,
      status: 'OUT_FOR_DELIVERY',
      next_step: 'Arriving today by 5:00 PM via Bluedart Express.',
      delivery_date: '11th October 2026',
      return_eligible: false,
    },
  ]);

  const [selectedOrderIdForReturn, setSelectedOrderIdForReturn] = useState<string | null>(null);
  const [returnReasonInput, setReturnReasonInput] = useState<string>('');
  const [isListeningVoiceReason, setIsListeningVoiceReason] = useState<boolean>(false);
  const [returnFeedback, setReturnFeedback] = useState<{
    order_id: string;
    status: 'APPROVED' | 'INELIGIBLE';
    seller_note_en: string;
    pickup_date: string;
  } | null>(null);

  // Request latest orders on mount
  useEffect(() => {
    apiClient.send({ type: 'order.track' });
  }, [apiClient]);

  // Listen for order status and return result messages
  useEffect(() => {
    const unsubscribe = apiClient.onMessage((msg) => {
      if (msg.type === 'order.status') {
        const statusMsg = msg as OrderStatusMessage;
        setOrders(statusMsg.orders);
      } else if (msg.type === 'order.return_result') {
        const resultMsg = msg as OrderReturnResultMessage;
        setReturnFeedback(resultMsg);

        if (resultMsg.status === 'APPROVED') {
          triggerHaptic('success');
          onAnnounce?.(
            `Return approved for Order ${resultMsg.order_id}! Pickup scheduled for ${resultMsg.pickup_date}. Seller note recorded: ${resultMsg.seller_note_en}`,
            'assertive'
          );
        } else {
          triggerHaptic('error');
          onAnnounce?.(
            `Return request could not be processed: ${resultMsg.seller_note_en}`,
            'assertive'
          );
        }
      }
    });

    return () => unsubscribe();
  }, [apiClient, onAnnounce]);

  if (!isOpen) return null;

  // Handle Return Submission
  const handleInitiateReturn = (orderId: string, reasonText?: string) => {
    const reason = (reasonText || returnReasonInput).trim();
    if (!reason) {
      onAnnounce?.('Please provide or speak a reason for return.', 'assertive');
      return;
    }

    triggerHaptic('listening');
    onAnnounce?.(`Submitting return for order ${orderId}...`, 'polite');

    apiClient.send({
      type: 'order.return',
      order_id: orderId,
      reason,
      lang: currentLang,
    });

    setSelectedOrderIdForReturn(null);
    setReturnReasonInput('');
  };

  // Simulate speaking the reason aloud
  const handleVoiceSpeakReason = (orderId: string, sampleReason: string) => {
    setIsListeningVoiceReason(true);
    triggerHaptic('listening');
    onAnnounce?.(`Listening for return reason...`, 'polite');

    setTimeout(() => {
      setIsListeningVoiceReason(false);
      setReturnReasonInput(sampleReason);
      handleInitiateReturn(orderId, sampleReason);
    }, 400);
  };

  const targetMinClass = largeTargets ? 'min-h-[72px] min-w-[72px]' : 'min-h-[56px] min-w-[56px]';

  return (
    <section
      aria-labelledby="orders-panel-heading"
      className="w-full bg-brutal-surface border-4 border-coral-500 shadow-brutal p-6 sm:p-8 flex flex-col gap-6 text-left my-6"
    >
      {/* Header Landmark */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b-2 border-brutal-border pb-4">
        <div>
          <span className="text-xs font-mono font-bold tracking-widest uppercase text-coral-400 bg-coral-950/80 border border-coral-800 px-3 py-1 inline-block mb-1">
            SYNC-D GUARDIAN &bull; ORDERS \& RETURNS
          </span>
          <h2
            id="orders-panel-heading"
            className="text-2xl sm:text-3xl font-black font-mono text-white uppercase tracking-tight"
          >
            Order Tracking & Returns
          </h2>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              triggerHaptic('listening');
              apiClient.send({ type: 'order.track' });
              onAnnounce?.('Refreshed tracking status for all orders.', 'polite');
            }}
            aria-label="Refresh order status and delivery updates"
            className={`${targetMinClass} px-4 py-2 bg-brutal-card hover:bg-brutal-muted text-coral-400 border-2 border-brutal-border font-mono text-xs font-bold uppercase tracking-wider flex items-center justify-center`}
          >
            ↻ Refresh
          </button>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close orders panel"
              className={`${targetMinClass} px-5 py-2 bg-brutal-card hover:bg-brutal-muted text-white border-2 border-brutal-border font-mono text-xs font-bold uppercase tracking-wider flex items-center justify-center`}
            >
              Close
            </button>
          )}
        </div>
      </div>

      {/* Return Success Alert Banner */}
      {returnFeedback && returnFeedback.status === 'APPROVED' && (
        <div
          role="status"
          aria-live="assertive"
          data-testid="return-approved-banner"
          className="bg-emerald-950/70 border-2 border-emerald-500 p-5 flex flex-col gap-2 text-emerald-100 shadow-brutalSm"
        >
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="text-xl text-emerald-400">✓</span>
            <h3 className="text-base font-black font-mono uppercase text-emerald-400">
              Return Scheduled for Order {returnFeedback.order_id}
            </h3>
          </div>
          <p className="text-xs font-sans text-emerald-200">
            Pickup Date: <strong className="text-white font-mono">{returnFeedback.pickup_date}</strong>
          </p>
          <p className="text-xs font-mono bg-brutal-black/70 p-2.5 border border-emerald-800 text-emerald-300">
            Translated English Seller Note: &ldquo;{returnFeedback.seller_note_en}&rdquo;
          </p>
        </div>
      )}

      {/* Orders List */}
      <div className="flex flex-col gap-4">
        <ul
          role="list"
          aria-label="Past and current orders"
          className="flex flex-col gap-4"
        >
          {orders.map((order) => {
            const isDelivered = order.status === 'DELIVERED';
            const isReturnInitiated = order.status === 'RETURN_INITIATED';

            return (
              <li
                key={order.order_id}
                data-testid={`order-card-${order.order_id}`}
                className="bg-brutal-card border-2 border-brutal-border p-5 flex flex-col gap-4 shadow-brutalSm"
              >
                {/* Order Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-brutal-border pb-3">
                  <div>
                    <span className="text-xs font-mono text-coral-400 font-bold uppercase tracking-wider">
                      {order.order_id}
                    </span>
                    <h3 className="text-lg font-black font-mono text-white">
                      {order.title}
                    </h3>
                  </div>

                  {/* Status Badge */}
                  <div className="self-start sm:self-auto">
                    <span
                      data-testid={`order-status-${order.order_id}`}
                      className={`text-xs font-mono font-black uppercase px-3 py-1 border ${
                        isReturnInitiated
                          ? 'bg-coral-950 text-coral-400 border-coral-500'
                          : isDelivered
                          ? 'bg-emerald-950 text-emerald-400 border-emerald-500'
                          : 'bg-amber-950 text-amber-400 border-amber-500'
                      }`}
                    >
                      {order.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                </div>

                {/* Details & Next Step */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono">
                  <div className="bg-brutal-black p-3 border border-brutal-border/60">
                    <span className="text-brutal-grey block text-[10px] uppercase">Amount Paid</span>
                    <span className="text-white font-bold text-sm">{formatPriceINR(order.price_inr)}</span>
                  </div>
                  <div className="bg-brutal-black p-3 border border-brutal-border/60">
                    <span className="text-brutal-grey block text-[10px] uppercase">Delivery Info</span>
                    <span className="text-white font-bold text-sm">{order.delivery_date}</span>
                  </div>
                </div>

                {/* Next Step Banner */}
                <div className="bg-brutal-black/80 p-3 border border-brutal-border text-xs font-sans text-brutal-lightGrey flex items-start gap-2">
                  <span aria-hidden="true" className="text-coral-400 font-bold font-mono">ℹ</span>
                  <span>{order.next_step}</span>
                </div>

                {/* Return Seller Note if already initiated */}
                {isReturnInitiated && order.return_seller_note && (
                  <div className="bg-coral-950/40 p-3 border border-coral-800 text-xs font-mono text-coral-300">
                    <strong>Seller Note:</strong> {order.return_seller_note}
                  </div>
                )}

                {/* Return Action Workflow */}
                {order.return_eligible && !isReturnInitiated && (
                  <div className="pt-2 border-t border-brutal-border flex flex-col gap-3">
                    {selectedOrderIdForReturn === order.order_id ? (
                      /* Return Dialog Drawer */
                      <div
                        role="region"
                        aria-labelledby={`return-heading-${order.order_id}`}
                        className="bg-brutal-black p-4 border-2 border-coral-500 flex flex-col gap-3"
                      >
                        <h4
                          id={`return-heading-${order.order_id}`}
                          className="text-sm font-bold font-mono text-coral-400 uppercase"
                        >
                          Reason for Return
                        </h4>
                        <p className="text-xs font-sans text-brutal-grey">
                          Speak in Telugu, Hindi, or English (e.g. &ldquo;Size chala peddaga undi&rdquo;). SunoShop converts your voice into an English seller note.
                        </p>

                        <div className="flex flex-col sm:flex-row gap-2">
                          <input
                            type="text"
                            value={returnReasonInput}
                            onChange={(e) => setReturnReasonInput(e.target.value)}
                            placeholder="Enter or speak return reason..."
                            aria-label="Return reason text"
                            className="flex-1 min-h-[48px] px-3 bg-brutal-card border-2 border-brutal-border text-white font-mono text-xs focus:border-coral-500 focus:outline-none"
                          />

                          {/* Quick Voice Simulation Buttons */}
                          <button
                            type="button"
                            onClick={() => handleVoiceSpeakReason(order.order_id, 'Size chala peddaga undi, fit avvaledu')}
                            disabled={isListeningVoiceReason}
                            aria-label="Speak reason in Telugu: Size chala peddaga undi"
                            className={`${targetMinClass} px-3 py-2 bg-coral-500/20 hover:bg-coral-500 hover:text-brutal-black text-coral-300 border border-coral-500 font-mono text-xs font-bold uppercase`}
                          >
                            🎙️ Telugu: Size Peddaga Undi
                          </button>
                        </div>

                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => handleInitiateReturn(order.order_id)}
                            aria-label={`Confirm and submit return for ${order.title}`}
                            className={`${targetMinClass} px-5 py-2.5 bg-coral-500 hover:bg-coral-400 text-brutal-black font-mono text-xs font-black uppercase tracking-wider border-2 border-white shadow-brutalSm`}
                          >
                            Submit Return
                          </button>
                          <button
                            type="button"
                            onClick={() => setSelectedOrderIdForReturn(null)}
                            aria-label="Cancel return process"
                            className={`${targetMinClass} px-4 py-2.5 bg-brutal-card hover:bg-brutal-muted text-white border-2 border-brutal-border font-mono text-xs font-bold uppercase`}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setSelectedOrderIdForReturn(order.order_id)}
                        aria-label={`Initiate Return (7-Day Policy) for ${order.title}`}
                        className={`${targetMinClass} px-5 py-3 bg-coral-500/20 hover:bg-coral-500 hover:text-brutal-black text-coral-400 border-2 border-coral-500 font-mono text-xs font-black uppercase tracking-wider transition-all self-start flex items-center gap-2`}
                      >
                        <span>↩ Initiate Return (7-Day Policy)</span>
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
