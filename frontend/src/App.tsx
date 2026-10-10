// Accessible shell with landmarks, skip-link, live-region announcer, and EN/HI/TE language switching
// Exports default App component and announce helper function
// Depends on react, ./i18n, ./api, ./components/Controls, ./components/Logo, ./components/Shelf

import React, { useState, useEffect, useMemo } from 'react';
import { Language, availableLanguages, getTranslation } from './i18n';
import { createApiClient } from './api';
import Controls from './components/Controls';
import Logo from './components/Logo';
import Shelf from './components/Shelf';
import { ShelfProduct } from './types';

// Initial default shelf recommendations for immediate accessibility
const DEFAULT_SHELF_PRODUCTS: ShelfProduct[] = [
  {
    id: 'p_001',
    title: 'UltraCushion Pro Runner',
    price_inr: 3499,
    pan: -1.0, // Left
    alt_text: 'Black running shoe with responsive white foam cushioning',
  },
  {
    id: 'p_002',
    title: 'AeroGrip Trail Walker',
    price_inr: 2799,
    pan: 0.0, // Center
    alt_text: 'Navy blue trail shoe with high-traction rubber lugs',
  },
  {
    id: 'p_003',
    title: 'Slip-On Ortho Comfort',
    price_inr: 2199,
    pan: 1.0, // Right
    alt_text: 'Grey slip-on sneaker with memory foam insole',
  },
];

// Global live-region announce helper
export function announce(message: string, priority: 'polite' | 'assertive' = 'polite'): void {
  const container = document.getElementById('aria-live-announcer');
  if (container) {
    container.setAttribute('aria-live', priority);
    container.textContent = '';
    setTimeout(() => {
      container.textContent = message;
    }, 50);
  }
}

export default function App(): React.ReactElement {
  const [lang, setLang] = useState<Language>('en');
  const [products, setProducts] = useState<ShelfProduct[]>(DEFAULT_SHELF_PRODUCTS);
  const t = getTranslation(lang);
  const apiClient = useMemo(() => createApiClient(), []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  // Listen for dynamic shelf updates from API client
  useEffect(() => {
    const unsubscribe = apiClient.onMessage((msg) => {
      if (msg.type === 'shelf.results') {
        setProducts(msg.products);
      }
    });
    return () => unsubscribe();
  }, [apiClient]);

  const handleLanguageChange = (newLang: Language) => {
    setLang(newLang);
    const updatedTranslation = getTranslation(newLang);
    announce(updatedTranslation.switchedLanguage, 'polite');
  };

  const handleSelectProduct = (product: ShelfProduct) => {
    announce(`Selected ${product.title}. Price: ₹${product.price_inr}`, 'assertive');
  };

  const handleAddToCart = (product: ShelfProduct) => {
    announce(`Added ${product.title} to cart. Total: ₹${product.price_inr}`, 'assertive');
  };

  return (
    <div className="min-h-screen flex flex-col bg-brutal-black text-brutal-white font-sans antialiased selection:bg-coral-500 selection:text-brutal-black">
      {/* 1. Accessible Skip Link */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-5 focus:py-3 focus:bg-coral-500 focus:text-brutal-black focus:font-black focus:border-2 focus:border-white focus:shadow-brutal focus:outline-none uppercase tracking-wider text-sm"
      >
        {t.skipLink}
      </a>

      {/* 2. Hidden Live Region for Screen Readers */}
      <div
        id="aria-live-announcer"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {t.liveRegionDefault}
      </div>

      {/* 3. Brutalist Header Landmark */}
      <header className="border-b-2 border-brutal-border bg-brutal-surface/95 backdrop-blur px-6 py-4 flex flex-col sm:flex-row justify-between items-center gap-4 sticky top-0 z-40">
        <div className="flex items-center gap-4">
          <Logo size="md" showText={true} />
          {/* Accessible hidden app name for testing & screen readers */}
          <span className="sr-only">{t.appName}</span>
        </div>

        {/* 4. Navigation Landmark / Language Switcher */}
        <nav aria-label={t.navLabel} className="flex items-center gap-3">
          <label htmlFor="language-select" className="sr-only">
            {t.languageSelectLabel}
          </label>
          <div className="flex items-center gap-2 bg-brutal-card border-2 border-brutal-border p-1 shadow-brutalSm">
            <span aria-hidden="true" className="text-sm px-2 text-coral-400 font-bold font-mono">
              LANG:
            </span>
            <select
              id="language-select"
              value={lang}
              onChange={(e) => handleLanguageChange(e.target.value as Language)}
              className="min-h-[48px] px-3 py-2 bg-brutal-black border-2 border-brutal-border text-brutal-white font-mono text-sm font-bold focus:border-coral-500 focus:outline-none cursor-pointer"
            >
              {availableLanguages.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
        </nav>
      </header>

      {/* 5. Main Content Landmark */}
      <main
        id="main-content"
        tabIndex={-1}
        className="flex-1 flex flex-col justify-start items-center p-4 sm:p-6 text-center outline-none max-w-5xl mx-auto w-full gap-8"
      >
        {/* Hero Voice Interaction Section */}
        <section
          aria-labelledby="status-heading"
          className="w-full bg-brutal-surface p-6 sm:p-8 border-2 border-brutal-border shadow-brutal flex flex-col items-center gap-4"
        >
          <div className="flex flex-col items-center gap-1">
            <span className="text-xs font-mono font-bold tracking-widest uppercase text-coral-400 bg-coral-950/60 border border-coral-800/80 px-3 py-1">
              VOICE-FIRST PROXY v0.1
            </span>
            <h1 id="status-heading" className="text-2xl sm:text-3xl font-black text-white uppercase tracking-tight mt-2 font-mono">
              {t.appName}
            </h1>
            <p className="text-brutal-grey text-sm sm:text-base max-w-md font-medium">
              {t.tagline}
            </p>
          </div>

          {/* Push-to-Talk Controls with Brutalist Coral Red Styling and Adaptation Prompts */}
          <Controls
            apiClient={apiClient}
            currentLang={lang}
            onStatusChange={(status) => announce(status, 'polite')}
            onAnnounce={(msg, prio) => announce(msg, prio)}
          />
        </section>

        {/* Spatial Product Shelf */}
        <Shelf
          products={products}
          currentLang={lang}
          onSelectProduct={handleSelectProduct}
          onAddToCart={handleAddToCart}
          onAnnounce={(msg) => announce(msg, 'polite')}
        />
      </main>

      {/* 6. Brutalist Footer */}
      <footer className="border-t-2 border-brutal-border bg-brutal-surface p-4 text-center text-xs font-mono text-brutal-grey flex flex-col sm:flex-row justify-between items-center gap-2 max-w-7xl mx-auto w-full px-6">
        <span>TEAM PPAP (TEAM ID: 320) &bull; MEGATHON 2026</span>
        <span className="text-coral-500 font-bold">100% WCAG AAA HIGH CONTRAST &bull; EN / HI / TE</span>
      </footer>
    </div>
  );
}
