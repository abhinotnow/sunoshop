// Accessible product shelf with semantic list, heading hierarchy, spatial badges, and WCAG 2.5.7 non-draggable voice price filter
// Exports default Shelf component and ShelfProps
// Depends on react, ../types, ../i18n, ../audio, ../voiceFilter

import React, { useEffect, useRef, useState } from 'react';
import { ShelfProduct } from '../types';
import { Language } from '../i18n';
import { playSpatialShelf } from '../audio';
import { parseVoicePrice, formatPriceINR } from '../voiceFilter';

export interface ShelfProps {
  products: ShelfProduct[];
  currentLang?: Language;
  maxPrice?: number | null;
  voiceQuery?: string;
  onMaxPriceChange?: (price: number | null) => void;
  onSelectProduct?: (product: ShelfProduct) => void;
  onAddToCart?: (product: ShelfProduct) => void;
  onAnnounce?: (message: string) => void;
}

export default function Shelf({
  products,
  currentLang: _currentLang = 'en',
  maxPrice: controlledMaxPrice,
  voiceQuery,
  onMaxPriceChange,
  onSelectProduct,
  onAddToCart,
  onAnnounce,
}: ShelfProps): React.ReactElement {
  const previousProductsRef = useRef<string>('');
  const [isPlayingSpatial, setIsPlayingSpatial] = useState<boolean>(false);

  // Internal price filter state if not externally controlled
  const [internalMaxPrice, setInternalMaxPrice] = useState<number | null>(null);
  const activeMaxPrice = controlledMaxPrice !== undefined ? controlledMaxPrice : internalMaxPrice;

  const updatePriceCap = (newCap: number | null, source: 'voice' | 'button' | 'manual' = 'button') => {
    if (controlledMaxPrice === undefined) {
      setInternalMaxPrice(newCap);
    }
    onMaxPriceChange?.(newCap);

    if (newCap === null) {
      onAnnounce?.(`Price filter cleared. Showing all ${products.length} products.`);
    } else {
      const matchCount = products.filter((p) => p.price_inr <= newCap).length;
      if (matchCount === 0) {
        onAnnounce?.(
          `No products found under ${formatPriceINR(newCap)}. Use the plus button or say a higher amount to expand.`
        );
      } else {
        const sourceNotice = source === 'voice' ? 'Voice filter applied: ' : 'Budget adjusted: ';
        onAnnounce?.(
          `${sourceNotice}Under ${formatPriceINR(newCap)}. ${matchCount} ${matchCount === 1 ? 'product matches' : 'products match'}.`
        );
      }
    }
  };

  // Handle incoming voice queries like "under fifteen thousand"
  useEffect(() => {
    if (!voiceQuery) return;
    const parsed = parseVoicePrice(voiceQuery);
    if (parsed !== null && parsed !== activeMaxPrice) {
      updatePriceCap(parsed, 'voice');
    }
  }, [voiceQuery]);

  // Filter products by activeMaxPrice
  const filteredProducts = activeMaxPrice !== null
    ? products.filter((p) => p.price_inr <= activeMaxPrice)
    : products;

  // Announce when products update via live region without duplicating screen reader announcements
  useEffect(() => {
    if (filteredProducts.length === 0) return;
    const currentSignature = filteredProducts.map((p) => p.id).join(',');
    if (currentSignature !== previousProductsRef.current) {
      previousProductsRef.current = currentSignature;
      const topTitle = filteredProducts[0]?.title || 'Products';
      const announcement = `Showing ${filteredProducts.length} shelf products. Top match: ${topTitle}, ${formatPriceINR(filteredProducts[0]?.price_inr)}.`;
      onAnnounce?.(announcement);
    }
  }, [filteredProducts, onAnnounce]);

  const handlePlaySpatialPreview = async () => {
    if (isPlayingSpatial || filteredProducts.length === 0) return;
    setIsPlayingSpatial(true);
    onAnnounce?.('Playing spatial audio positions: Left, Center, Right.');
    try {
      await playSpatialShelf(filteredProducts, {
        durationPerItemMs: 300,
      });
    } finally {
      setIsPlayingSpatial(false);
    }
  };

  const handleStepDecrease = () => {
    const maxItemPrice = products.length > 0 ? Math.max(...products.map((p) => p.price_inr)) : 3000;
    const current = activeMaxPrice !== null ? activeMaxPrice : Math.ceil(maxItemPrice / 500) * 500;
    const next = Math.max(500, current - 500);
    updatePriceCap(next, 'button');
  };

  const handleStepIncrease = () => {
    const minItemPrice = products.length > 0 ? Math.min(...products.map((p) => p.price_inr)) : 1000;
    const current = activeMaxPrice !== null ? activeMaxPrice : Math.floor(minItemPrice / 500) * 500;
    const next = current + 500;
    updatePriceCap(next, 'button');
  };

  const handleClearFilter = () => {
    updatePriceCap(null, 'button');
  };

  const getPanLabel = (pan: number): { label: string; badgeClass: string } => {
    if (pan < -0.2) {
      return {
        label: 'Left Ear (Pan: -1.0)',
        badgeClass: 'bg-brutal-card text-coral-400 border-coral-500',
      };
    }
    if (pan > 0.2) {
      return {
        label: 'Right Ear (Pan: +1.0)',
        badgeClass: 'bg-brutal-card text-coral-400 border-coral-500',
      };
    }
    return {
      label: 'Center (Pan: 0.0)',
      badgeClass: 'bg-coral-500 text-brutal-black border-white',
    };
  };

  return (
    <section aria-labelledby="shelf-heading" className="w-full max-w-4xl mx-auto my-6 px-4">
      {/* 1. Shelf Section Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 pb-3 border-b-2 border-brutal-border">
        <div>
          <h2 id="shelf-heading" className="text-xl sm:text-2xl font-black font-mono uppercase tracking-tight text-white flex items-center gap-3">
            <span className="w-3 h-3 bg-coral-500 inline-block" aria-hidden="true" />
            Curated Product Shelf
          </h2>
          <p className="text-xs sm:text-sm text-brutal-grey font-mono mt-0.5">
            Top 3 grounded matches with spatial audio panning (Left &bull; Center &bull; Right)
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Spatial Audio Playback Button */}
          <button
            type="button"
            onClick={handlePlaySpatialPreview}
            disabled={isPlayingSpatial || filteredProducts.length === 0}
            aria-label="Play spatial audio orientation for the shelf products"
            className="min-h-[48px] px-3.5 py-2 bg-brutal-card hover:bg-brutal-muted text-coral-400 border-2 border-coral-500/80 font-mono text-xs font-bold uppercase tracking-wider flex items-center gap-2 shadow-brutalSm transition-all active:translate-x-0.5 active:translate-y-0.5 disabled:opacity-50"
          >
            <span aria-hidden="true">{isPlayingSpatial ? '🔊...' : '🎧'}</span>
            <span>{isPlayingSpatial ? 'Panning...' : 'Spatial Audio'}</span>
          </button>

          <span className="text-xs font-mono font-bold uppercase text-coral-400 border border-coral-500/60 px-2.5 py-2">
            {filteredProducts.length} of {products.length} Items
          </span>
        </div>
      </div>

      {/* 2. Accessible Voice & Step Price Filter (WCAG 2.5.7 Compliant - No Drag/Slider Interaction) */}
      <div
        role="region"
        aria-labelledby="price-filter-heading"
        className="mb-6 p-4 sm:p-5 bg-brutal-surface border-2 border-brutal-border shadow-brutalSm"
      >
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h3 id="price-filter-heading" className="text-sm font-bold font-mono uppercase tracking-wider text-coral-400 flex items-center gap-2">
              <span>🎙️</span> Voice Price Filter
            </h3>
            <p className="text-xs text-brutal-lightGrey font-sans mt-1">
              Speak constraints like <span className="text-coral-300 font-mono font-bold">"under ₹3,000"</span> or use the accessible step buttons below. No dragging required.
            </p>
          </div>

          {/* Stepper Buttons (>= 48px Touch Targets) */}
          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
            {/* Decrease Budget Cap Button */}
            <button
              type="button"
              onClick={handleStepDecrease}
              aria-label={`Decrease price limit by 500 rupees. Current cap: ${activeMaxPrice ? formatPriceINR(activeMaxPrice) : 'None'}`}
              className="min-h-[48px] min-w-[56px] px-4 py-2 bg-brutal-card hover:bg-brutal-muted active:bg-coral-950 text-white border-2 border-brutal-border hover:border-coral-500 font-mono text-sm font-black flex items-center justify-center shadow-brutalSm transition-all active:translate-x-0.5 active:translate-y-0.5"
            >
              - ₹500
            </button>

            {/* Current Cap Display Badge */}
            <div
              aria-live="polite"
              className="min-h-[48px] px-4 py-2 bg-brutal-black border-2 border-coral-500 flex flex-col items-center justify-center font-mono text-center min-w-[120px]"
            >
              <span className="text-[10px] text-brutal-grey uppercase font-bold tracking-wider">
                Active Cap
              </span>
              <span className="text-sm font-black text-coral-400">
                {activeMaxPrice !== null ? formatPriceINR(activeMaxPrice) : 'No Limit'}
              </span>
            </div>

            {/* Increase Budget Cap Button */}
            <button
              type="button"
              onClick={handleStepIncrease}
              aria-label={`Increase price limit by 500 rupees. Current cap: ${activeMaxPrice ? formatPriceINR(activeMaxPrice) : 'None'}`}
              className="min-h-[48px] min-w-[56px] px-4 py-2 bg-brutal-card hover:bg-brutal-muted active:bg-coral-950 text-white border-2 border-brutal-border hover:border-coral-500 font-mono text-sm font-black flex items-center justify-center shadow-brutalSm transition-all active:translate-x-0.5 active:translate-y-0.5"
            >
              + ₹500
            </button>

            {/* Clear Filter Button */}
            {activeMaxPrice !== null && (
              <button
                type="button"
                onClick={handleClearFilter}
                aria-label="Clear active price filter and show all products"
                className="min-h-[48px] px-3.5 py-2 bg-coral-500/20 hover:bg-coral-500 hover:text-brutal-black text-coral-400 border-2 border-coral-500 font-mono text-xs font-black uppercase tracking-wider transition-all"
              >
                Clear Cap
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 3. Empty State or Semantic Product List */}
      {filteredProducts.length === 0 ? (
        <div
          role="status"
          aria-live="polite"
          className="p-8 bg-brutal-surface border-2 border-dashed border-coral-500/60 text-center shadow-brutalSm my-4"
        >
          <p className="text-lg font-bold font-mono text-coral-400 uppercase">
            No products match under {activeMaxPrice ? formatPriceINR(activeMaxPrice) : ''}
          </p>
          <p className="text-xs text-brutal-grey font-mono mt-2">
            Use the + ₹500 button above or speak a higher amount to expand recommendations.
          </p>
          <button
            type="button"
            onClick={handleClearFilter}
            aria-label="Reset price filter to show all products"
            className="mt-4 min-h-[48px] px-6 py-2.5 bg-coral-500 text-brutal-black font-mono font-bold text-xs uppercase tracking-wider border-2 border-white shadow-brutalSm"
          >
            Show All Products
          </button>
        </div>
      ) : (
        <ol
          aria-label="Top recommended products"
          className="grid grid-cols-1 md:grid-cols-3 gap-6 list-none p-0 m-0"
        >
          {filteredProducts.map((product, index) => {
            const panInfo = getPanLabel(product.pan);

            return (
              <li
                key={product.id}
                className="bg-brutal-surface border-2 border-brutal-border hover:border-coral-500 shadow-brutalSm transition-all flex flex-col justify-between p-5"
              >
                <div>
                  {/* Spatial Audio & Position Badge */}
                  <div className="flex justify-between items-center gap-2 mb-3">
                    <span className="text-xs font-mono font-bold text-brutal-grey">
                      #0{index + 1}
                    </span>
                    <span
                      className={`text-[11px] font-mono font-bold uppercase px-2 py-0.5 border ${panInfo.badgeClass}`}
                      aria-label={`Spatial position: ${panInfo.label}`}
                    >
                      {panInfo.label.split(' ')[0]}
                    </span>
                  </div>

                  {/* Product Thumbnail with Descriptive Alt Text */}
                  <div className="w-full h-36 bg-brutal-black border border-brutal-border flex items-center justify-center p-3 mb-4 overflow-hidden">
                    <img
                      src={`/icons/icon-192.svg`}
                      alt={product.alt_text}
                      className="max-h-full max-w-full object-contain filter drop-shadow"
                      loading="lazy"
                    />
                  </div>

                  {/* Heading Hierarchy: h3 for Each Product Title */}
                  <h3 className="text-lg font-bold font-mono text-white leading-snug line-clamp-2">
                    {product.title}
                  </h3>

                  {/* Price Display */}
                  <p className="text-2xl font-black font-mono text-coral-500 mt-2">
                    {formatPriceINR(product.price_inr)}
                  </p>

                  {/* Spoken/Visual Alt Text Description */}
                  <p
                    className="text-xs text-brutal-lightGrey font-sans mt-3 line-clamp-3 bg-brutal-black/60 p-2.5 border border-brutal-border/60"
                    aria-label={`Product visual description: ${product.alt_text}`}
                  >
                    {product.alt_text}
                  </p>
                </div>

                {/* Accessible Action Buttons with >= 48px Touch Targets */}
                <div className="flex flex-col gap-2 mt-5 pt-3 border-t border-brutal-border">
                  <button
                    type="button"
                    onClick={() => onSelectProduct?.(product)}
                    aria-label={`Hear detailed specs for ${product.title}`}
                    className="min-h-[48px] w-full px-4 py-2.5 bg-brutal-card hover:bg-brutal-muted text-white border-2 border-brutal-border font-mono text-xs font-bold uppercase tracking-wider transition-all focus:outline-none focus:border-coral-500 active:translate-x-0.5 active:translate-y-0.5"
                  >
                    Hear Details
                  </button>
                  <button
                    type="button"
                    onClick={() => onAddToCart?.(product)}
                    aria-label={`Add ${product.title} to cart for ${formatPriceINR(product.price_inr)}`}
                    className="min-h-[48px] w-full px-4 py-2.5 bg-coral-500 hover:bg-coral-400 text-brutal-black font-mono text-xs font-black uppercase tracking-wider transition-all shadow-brutalSm border-2 border-white focus:outline-none active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
                  >
                    Add to Cart
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
