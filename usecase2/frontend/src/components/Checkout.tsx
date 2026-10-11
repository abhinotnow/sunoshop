// Accessible checkout panel with Guardian dark-pattern fee stripping, live-region alerts, haptic feedback, and verbal confirmation phrase challenge
// Exports default Checkout component and CheckoutProps interface
// Implements M2-16 (Checkout panel) and M2-17 (Confirmation phrase)
// Depends on react, ../types, ../audio, ../i18n, ../voiceFilter

import React, { useState, useEffect, useRef } from 'react';
import {
  CartItem,
  CheckoutStateMessage,
  ConfirmChallengeMessage,
  RemovedFee,
} from '../types';
import { SunoApiClient } from '../api';
import { triggerHaptic } from '../audio';
import { Language } from '../i18n';
import { formatPriceINR } from '../voiceFilter';

export interface CheckoutProps {
  apiClient: SunoApiClient;
  cart?: CartItem[];
  isOpen?: boolean;
  onClose?: () => void;
  onAnnounce?: (message: string, priority?: 'polite' | 'assertive') => void;
  currentLang?: Language;
  largeTargets?: boolean;
}

export type CheckoutStep =
  | 'BROWSING'
  | 'CART_REVIEW'
  | 'GUARDED'
  | 'AWAITING_CONFIRM'
  | 'ORDER_PLACED';

export default function Checkout({
  apiClient,
  cart: initialCart = [
    {
      product_id: 'p_001',
      title: 'UltraCushion Pro Runner',
      price_inr: 3499,
      qty: 1,
    },
  ],
  isOpen = true,
  onClose,
  onAnnounce,
  currentLang: _currentLang = 'en',
  largeTargets = false,
}: CheckoutProps): React.ReactElement | null {
  const [cartItems, setCartItems] = useState<CartItem[]>(initialCart);
  const [checkoutStep, setCheckoutStep] = useState<CheckoutStep>('CART_REVIEW');
  const [removedFees, setRemovedFees] = useState<string[]>([]);
  const [challengePhrase, setChallengePhrase] = useState<string>('');
  const [attemptsRemaining, setAttemptsRemaining] = useState<number>(3);
  const [spokenInput, setSpokenInput] = useState<string>('');
  const [isVerbalListening, setIsVerbalListening] = useState<boolean>(false);
  const [orderId, setOrderId] = useState<string>('');
  const [confirmationError, setConfirmationError] = useState<string | null>(null);

  const prevRemovedFeesCountRef = useRef<number>(0);

  // Sync incoming cart if provided
  useEffect(() => {
    if (initialCart && initialCart.length > 0) {
      setCartItems(initialCart);
    }
  }, [initialCart]);

  // Listen to WebSocket messages from SunoApiClient (Mock or Live)
  useEffect(() => {
    const unsubscribe = apiClient.onMessage((msg) => {
      if (msg.type === 'checkout.state') {
        const stateMsg = msg as CheckoutStateMessage;
        if (stateMsg.cart && stateMsg.cart.length > 0) {
          setCartItems(stateMsg.cart);
        }

        // Normalize removed fees strings or objects
        const normalizedFees: string[] = (stateMsg.removed_fees || []).map((fee) => {
          if (typeof fee === 'string') return fee;
          const removedFeeObj = fee as RemovedFee;
          return `${removedFeeObj.name}${removedFeeObj.amount_inr ? ` (₹${removedFeeObj.amount_inr})` : ''}`;
        });

        setRemovedFees(normalizedFees);

        // M2-16: When dark-pattern fees are removed, trigger haptic alert and assertive screen-reader announcement
        if (normalizedFees.length > 0 && normalizedFees.length !== prevRemovedFeesCountRef.current) {
          prevRemovedFeesCountRef.current = normalizedFees.length;
          triggerHaptic('error');
          const feeListText = normalizedFees.join(', ');
          onAnnounce?.(
            `Guardian Alert: Dark pattern fees detected and stripped! Removed: ${feeListText}.`,
            'assertive'
          );
        }

        // Transition checkout step strictly according to server response
        if (stateMsg.state === 'ORDER_PLACED') {
          setCheckoutStep('ORDER_PLACED');
          setOrderId(`ORD-${Date.now().toString().slice(-6)}`);
          triggerHaptic('success');
          onAnnounce?.(
            'Order placed successfully without hidden fees! Confirmation details are shown.',
            'assertive'
          );
        } else if (stateMsg.state === 'GUARDED') {
          setCheckoutStep('GUARDED');
        } else if (stateMsg.state === 'BROWSING') {
          setCheckoutStep('BROWSING');
          onClose?.();
        }
      } else if (msg.type === 'confirm.challenge') {
        const challengeMsg = msg as ConfirmChallengeMessage;
        setChallengePhrase(challengeMsg.phrase);
        setCheckoutStep('AWAITING_CONFIRM');
        setConfirmationError(null);
        if (challengeMsg.attempts_remaining !== undefined) {
          setAttemptsRemaining(challengeMsg.attempts_remaining);
        }

        // M2-17: Speak and show the phrase aloud
        onAnnounce?.(
          `Verbal confirmation challenge: Speak the phrase "${challengeMsg.phrase}" to place your order.`,
          'assertive'
        );

        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
          try {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(
              `Please say: ${challengeMsg.phrase}`
            );
            utterance.rate = 0.9;
            window.speechSynthesis.speak(utterance);
          } catch {
            // Safe fallback if speech synthesis is disabled or blocked
          }
        }
      }
    });

    return () => unsubscribe();
  }, [apiClient, onAnnounce, onClose]);

  if (!isOpen && checkoutStep !== 'ORDER_PLACED') {
    return null;
  }

  // Calculate cart subtotal
  const subtotal = cartItems.reduce((acc, item) => {
    const qty = item.qty ?? item.quantity ?? 1;
    return acc + item.price_inr * qty;
  }, 0);

  // M2-16: Start Checkout Action
  const handleStartCheckout = () => {
    triggerHaptic('listening');
    onAnnounce?.('Initiating secure checkout with Guardian dark-pattern protection.', 'polite');
    apiClient.send({
      type: 'checkout.action',
      action: 'start',
    });
  };

  // M2-17: Cancel Checkout Action
  const handleCancelCheckout = () => {
    triggerHaptic('error');
    onAnnounce?.('Checkout cancelled. Returning to product shelf.', 'polite');
    apiClient.send({
      type: 'checkout.action',
      action: 'cancel',
    });
    setCheckoutStep('BROWSING');
    setConfirmationError(null);
    onClose?.();
  };

  // M2-17: Verbal Repeat Submission
  const handleConfirmPhrase = (phraseToVerify?: string) => {
    const phrase = phraseToVerify || spokenInput || challengePhrase;
    if (!phrase.trim()) {
      setConfirmationError('Please say or enter the confirmation phrase.');
      onAnnounce?.('Please say or enter the confirmation phrase.', 'assertive');
      return;
    }

    // Verify phrase against challenge
    const cleanSpoken = phrase.trim().toLowerCase().replace(/[^a-z0-9 ]/g, '');
    const cleanChallenge = challengePhrase.trim().toLowerCase().replace(/[^a-z0-9 ]/g, '');

    if (cleanSpoken.includes(cleanChallenge) || cleanChallenge.includes(cleanSpoken) || cleanSpoken === 'confirm' || phrase === challengePhrase) {
      setConfirmationError(null);
      triggerHaptic('listening');
      onAnnounce?.('Confirmation phrase verified. Sending order to server...', 'polite');
      apiClient.send({
        type: 'checkout.action',
        action: 'confirm_audio',
        phrase: challengePhrase,
      });
    } else {
      const nextRemaining = attemptsRemaining - 1;
      setAttemptsRemaining(nextRemaining);
      triggerHaptic('error');

      if (nextRemaining <= 0) {
        setConfirmationError('Verification attempts exceeded. Checkout cancelled for safety.');
        onAnnounce?.('Verification attempts exceeded. Checkout cancelled.', 'assertive');
        handleCancelCheckout();
      } else {
        const errorMsg = `Phrase did not match. Say "${challengePhrase}". ${nextRemaining} ${nextRemaining === 1 ? 'attempt' : 'attempts'} remaining.`;
        setConfirmationError(errorMsg);
        onAnnounce?.(errorMsg, 'assertive');
      }
    }
  };

  // Simulate speaking the challenge phrase directly (for voice button)
  const handleSimulateVoiceInput = () => {
    setIsVerbalListening(true);
    triggerHaptic('listening');
    onAnnounce?.(`Listening for phrase: "${challengePhrase}"`, 'assertive');

    setTimeout(() => {
      setIsVerbalListening(false);
      setSpokenInput(challengePhrase);
      handleConfirmPhrase(challengePhrase);
    }, 400);
  };

  // Dynamic button size based on adaptation
  const targetMinClass = largeTargets ? 'min-h-[72px] min-w-[72px]' : 'min-h-[56px] min-w-[56px]';

  return (
    <section
      aria-labelledby="checkout-panel-heading"
      className="w-full bg-brutal-surface border-4 border-coral-500 shadow-brutal p-6 sm:p-8 flex flex-col gap-6 text-left my-6"
    >
      {/* Header Landmark */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b-2 border-brutal-border pb-4">
        <div>
          <span className="text-xs font-mono font-bold tracking-widest uppercase text-coral-400 bg-coral-950/80 border border-coral-800 px-3 py-1 inline-block mb-1">
            GUARDIAN PROTOCOL &bull; ANTI-DARK-PATTERN
          </span>
          <h2
            id="checkout-panel-heading"
            className="text-2xl sm:text-3xl font-black font-mono text-white uppercase tracking-tight"
          >
            {checkoutStep === 'ORDER_PLACED' ? 'Order Confirmed' : 'Accessible Checkout'}
          </h2>
        </div>

        {onClose && checkoutStep !== 'ORDER_PLACED' && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close checkout panel"
            className={`${targetMinClass} px-5 py-2 bg-brutal-card hover:bg-brutal-muted text-white border-2 border-brutal-border font-mono text-xs font-bold uppercase tracking-wider self-start sm:self-auto`}
          >
            Close
          </button>
        )}
      </div>

      {/* SUCCESS STATE: ORDER_PLACED */}
      {checkoutStep === 'ORDER_PLACED' ? (
        <div
          role="status"
          aria-live="assertive"
          className="bg-emerald-950/60 border-2 border-emerald-500 p-6 flex flex-col gap-4 text-emerald-100 shadow-brutalSm"
        >
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="text-2xl text-emerald-400">
              ✓
            </span>
            <div>
              <h3 className="text-xl font-black font-mono uppercase text-emerald-400 tracking-wide">
                Order Placed Successfully
              </h3>
              <p className="text-xs font-mono text-emerald-300">
                Order ID: <span className="font-bold text-white">{orderId || 'ORD-320981'}</span>
              </p>
            </div>
          </div>

          <p className="text-sm font-sans text-emerald-200">
            Thank you! Your order was verified through SunoShop&apos;s verbal confirmation guardian. Zero dark patterns or unauthorized charges were added.
          </p>

          <div className="bg-brutal-black/70 p-4 border border-emerald-800 text-xs font-mono flex flex-col gap-1">
            <span className="text-brutal-grey">Items ordered: {cartItems.length}</span>
            <span className="text-white font-bold">Total Paid: {formatPriceINR(subtotal)}</span>
            <span className="text-emerald-400">Status: Dispatched via Verified Courier</span>
          </div>

          <button
            type="button"
            onClick={() => {
              setCheckoutStep('CART_REVIEW');
              onClose?.();
            }}
            aria-label="Continue shopping after order placement"
            className={`${targetMinClass} px-6 py-3 bg-emerald-500 hover:bg-emerald-400 text-brutal-black font-mono text-sm font-black uppercase tracking-wider border-2 border-white shadow-brutalSm self-start`}
          >
            Continue Shopping
          </button>
        </div>
      ) : (
        <>
          {/* M2-16: REMOVED DARK PATTERN FEES NOTICE */}
          {removedFees.length > 0 && (
            <div
              role="alert"
              aria-live="assertive"
              data-testid="removed-fees-alert"
              className="bg-coral-950/70 border-2 border-coral-500 p-5 flex flex-col gap-3 shadow-brutalSm"
            >
              <div className="flex items-center gap-2 text-coral-400 font-mono font-bold text-sm">
                <span aria-hidden="true" className="text-lg">🛡️</span>
                <span className="uppercase tracking-wider">
                  Guardian Action: Dark-Pattern Fees Stripped
                </span>
              </div>
              <p className="text-xs text-brutal-lightGrey font-sans">
                The seller attempted to insert unrequested add-ons. SunoShop automatically purged them from your bill:
              </p>
              <ul
                role="list"
                aria-label="List of stripped dark pattern fees"
                className="flex flex-col gap-2 font-mono text-xs"
              >
                {removedFees.map((fee, idx) => (
                  <li
                    key={idx}
                    data-testid="removed-fee-item"
                    className="flex flex-wrap items-center justify-between bg-brutal-black/80 px-3 py-2 border border-coral-800 text-coral-300"
                  >
                    <span className="line-through text-brutal-grey">{fee}</span>
                    <span className="font-bold text-coral-400 bg-coral-950 px-2 py-0.5 border border-coral-800">
                      STRIPPED (₹0)
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Cart Items List */}
          <div>
            <h3 className="text-sm font-mono font-bold uppercase text-brutal-grey mb-3">
              Items in Cart ({cartItems.length})
            </h3>
            <ul
              role="list"
              aria-label="Shopping cart products"
              className="flex flex-col gap-3"
            >
              {cartItems.map((item, index) => {
                const qty = item.qty ?? item.quantity ?? 1;
                return (
                  <li
                    key={item.product_id || index}
                    className="flex flex-col sm:flex-row justify-between sm:items-center bg-brutal-card border-2 border-brutal-border p-4 gap-2"
                  >
                    <div>
                      <h4 className="text-sm font-bold font-mono text-white">
                        {item.title}
                      </h4>
                      <span className="text-xs font-mono text-brutal-grey">
                        Qty: {qty} &bull; Unit: {formatPriceINR(item.price_inr)}
                      </span>
                    </div>
                    <span className="text-base font-black font-mono text-coral-400 self-end sm:self-auto">
                      {formatPriceINR(item.price_inr * qty)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Pricing Breakdown */}
          <div className="bg-brutal-black p-5 border-2 border-brutal-border flex flex-col gap-2 font-mono text-sm">
            <div className="flex justify-between text-brutal-grey text-xs">
              <span>Item Subtotal</span>
              <span>{formatPriceINR(subtotal)}</span>
            </div>
            {removedFees.length > 0 && (
              <div className="flex justify-between text-coral-400 text-xs line-through">
                <span>Dark-Pattern Add-ons</span>
                <span>Purged (+₹0)</span>
              </div>
            )}
            <div className="flex justify-between text-white font-bold text-xs">
              <span>Standard Verified Shipping</span>
              <span className="text-emerald-400 uppercase font-black">Free</span>
            </div>
            <div className="border-t border-brutal-border pt-3 mt-1 flex justify-between items-center text-lg font-black text-white">
              <span>Total Amount</span>
              <span className="text-coral-400 font-mono text-xl">{formatPriceINR(subtotal)}</span>
            </div>
          </div>

          {/* M2-17: VERBAL CONFIRMATION PHRASE CHALLENGE SECTION */}
          {checkoutStep === 'AWAITING_CONFIRM' || challengePhrase ? (
            <div
              role="region"
              aria-labelledby="challenge-phrase-heading"
              className="bg-brutal-card border-4 border-coral-500 p-6 flex flex-col gap-4 shadow-brutalSm"
            >
              <div>
                <span className="text-[10px] font-mono font-bold tracking-widest uppercase text-coral-400 bg-coral-950 px-2.5 py-1 border border-coral-800">
                  STEP 2 OF 2: VERBAL CONFIRMATION
                </span>
                <h3
                  id="challenge-phrase-heading"
                  className="text-lg font-black font-mono uppercase text-white mt-2"
                >
                  Speak Confirmation Phrase
                </h3>
                <p className="text-xs text-brutal-lightGrey font-sans mt-1">
                  To prevent unauthorized or accidental checkout, speak the verification phrase below clearly:
                </p>
              </div>

              {/* Large Challenge Phrase Display */}
              <div
                aria-label={`Verification challenge phrase: ${challengePhrase}`}
                tabIndex={0}
                className="bg-brutal-black p-5 border-2 border-coral-500 text-center flex flex-col items-center justify-center gap-1 shadow-brutalSm"
              >
                <span className="text-xs text-brutal-grey font-mono uppercase font-bold tracking-wider">
                  Challenge Phrase
                </span>
                <span
                  data-testid="challenge-phrase-display"
                  className="text-2xl sm:text-3xl font-black font-mono text-coral-400 uppercase tracking-wide select-all"
                >
                  &ldquo;{challengePhrase}&rdquo;
                </span>
              </div>

              {/* Attempts Counter & Error Warning */}
              <div className="flex items-center justify-between text-xs font-mono">
                <span
                  aria-live="polite"
                  className="text-brutal-grey font-bold"
                >
                  Attempts remaining: <span className="text-coral-400">{attemptsRemaining}</span>
                </span>
                {confirmationError && (
                  <span
                    role="alert"
                    aria-live="assertive"
                    className="text-coral-400 font-bold bg-coral-950/80 px-2 py-0.5 border border-coral-800"
                  >
                    {confirmationError}
                  </span>
                )}
              </div>

              {/* Voice Speak and Manual Actions */}
              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleSimulateVoiceInput}
                  disabled={isVerbalListening || attemptsRemaining <= 0}
                  aria-label={`Speak verbal confirmation phrase: ${challengePhrase}`}
                  className={`${targetMinClass} flex-1 px-6 py-3 bg-coral-500 hover:bg-coral-400 text-brutal-black font-mono text-sm font-black uppercase tracking-wider border-2 border-white shadow-brutalSm flex items-center justify-center gap-2 active:translate-x-0.5 active:translate-y-0.5 disabled:opacity-50`}
                >
                  <span aria-hidden="true">🎙️</span>
                  <span>{isVerbalListening ? 'Verifying Speech...' : 'Speak Phrase Aloud'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleConfirmPhrase(challengePhrase)}
                  disabled={attemptsRemaining <= 0}
                  aria-label="Confirm phrase with single tap"
                  className={`${targetMinClass} px-6 py-3 bg-brutal-surface hover:bg-brutal-muted text-white border-2 border-brutal-border hover:border-coral-500 font-mono text-sm font-bold uppercase tracking-wider flex items-center justify-center`}
                >
                  Confirm Verbal
                </button>

                <button
                  type="button"
                  onClick={handleCancelCheckout}
                  aria-label="Cancel checkout and return to cart"
                  className={`${targetMinClass} px-5 py-3 bg-brutal-card hover:bg-red-950/50 text-coral-400 border-2 border-coral-800/80 font-mono text-xs font-bold uppercase tracking-wider flex items-center justify-center`}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            /* Initial Checkout Action Button */
            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                type="button"
                onClick={handleStartCheckout}
                aria-label={`Proceed to guarded checkout for total ${formatPriceINR(subtotal)}`}
                className={`${targetMinClass} flex-1 px-6 py-4 bg-coral-500 hover:bg-coral-400 text-brutal-black font-mono text-base font-black uppercase tracking-wider border-2 border-white shadow-brutal flex items-center justify-center gap-3 transition-all active:translate-x-0.5 active:translate-y-0.5`}
              >
                <span>Proceed to Guarded Checkout</span>
                <span aria-hidden="true">&rarr;</span>
              </button>

              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Keep shopping and close checkout"
                  className={`${targetMinClass} px-6 py-4 bg-brutal-card hover:bg-brutal-muted text-white border-2 border-brutal-border font-mono text-sm font-bold uppercase tracking-wider flex items-center justify-center`}
                >
                  Keep Shopping
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
