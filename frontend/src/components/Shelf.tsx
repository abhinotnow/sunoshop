// Accessible product shelf with semantic list, heading hierarchy, spatial badges, and live region
// Exports default Shelf component and ShelfProps
// Depends on react, ../types, ../i18n, ../audio

import React, { useEffect, useRef, useState } from 'react';
import { ShelfProduct } from '../types';
import { Language } from '../i18n';
import { playSpatialShelf } from '../audio';

export interface ShelfProps {
  products: ShelfProduct[];
  currentLang?: Language;
  onSelectProduct?: (product: ShelfProduct) => void;
  onAddToCart?: (product: ShelfProduct) => void;
  onAnnounce?: (message: string) => void;
}

export default function Shelf({
  products,
  onSelectProduct,
  onAddToCart,
  onAnnounce,
}: ShelfProps): React.ReactElement {
  const previousProductsRef = useRef<string>('');
  const [isPlayingSpatial, setIsPlayingSpatial] = useState<boolean>(false);

  // Announce when products update via live region without duplicating screen reader announcements
  useEffect(() => {
    if (products.length === 0) return;
    const currentSignature = products.map((p) => p.id).join(',');
    if (currentSignature !== previousProductsRef.current) {
      previousProductsRef.current = currentSignature;
      const topTitle = products[0]?.title || 'Products';
      const announcement = `Found ${products.length} products. Top match: ${topTitle}, ₹${products[0]?.price_inr}.`;
      onAnnounce?.(announcement);
    }
  }, [products, onAnnounce]);

  const handlePlaySpatialPreview = async () => {
    if (isPlayingSpatial || products.length === 0) return;
    setIsPlayingSpatial(true);
    onAnnounce?.('Playing spatial audio positions: Left, Center, Right.');
    try {
      await playSpatialShelf(products, {
        durationPerItemMs: 300,
      });
    } finally {
      setIsPlayingSpatial(false);
    }
  };

  if (products.length === 0) {
    return (
      <section aria-labelledby="shelf-empty-heading" className="w-full max-w-4xl mx-auto my-6 p-6 bg-brutal-surface border-2 border-brutal-border text-center shadow-brutalSm">
        <h2 id="shelf-empty-heading" className="text-xl font-bold font-mono text-brutal-white uppercase tracking-tight">
          Product Shelf
        </h2>
        <p className="text-brutal-grey text-sm mt-2 font-mono">
          Ask a voice question above to explore curated products on your spatial shelf.
        </p>
      </section>
    );
  }

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
      {/* Shelf Section Header */}
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
            disabled={isPlayingSpatial}
            aria-label="Play spatial audio orientation for the 3 shelf products"
            className="min-h-[48px] px-3.5 py-2 bg-brutal-card hover:bg-brutal-muted text-coral-400 border-2 border-coral-500/80 font-mono text-xs font-bold uppercase tracking-wider flex items-center gap-2 shadow-brutalSm transition-all active:translate-x-0.5 active:translate-y-0.5 disabled:opacity-50"
          >
            <span aria-hidden="true">{isPlayingSpatial ? '🔊...' : '🎧'}</span>
            <span>{isPlayingSpatial ? 'Panning...' : 'Spatial Audio'}</span>
          </button>

          <span className="text-xs font-mono font-bold uppercase text-coral-400 border border-coral-500/60 px-2.5 py-2">
            {products.length} Items
          </span>
        </div>
      </div>

      {/* Semantic Ordered List for Accessibility */}
      <ol
        aria-label="Top 3 recommended products"
        className="grid grid-cols-1 md:grid-cols-3 gap-6 list-none p-0 m-0"
      >
        {products.map((product, index) => {
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
                  ₹{product.price_inr.toLocaleString('en-IN')}
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
                  aria-label={`Add ${product.title} to cart for ₹${product.price_inr}`}
                  className="min-h-[48px] w-full px-4 py-2.5 bg-coral-500 hover:bg-coral-400 text-brutal-black font-mono text-xs font-black uppercase tracking-wider transition-all shadow-brutalSm border-2 border-white focus:outline-none active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
                >
                  Add to Cart
                </button>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
