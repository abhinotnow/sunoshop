// Brutalist coral red monogram logo with industrial typography
// Exports default Logo component
// Depends on react

import React from 'react';

export interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
}

export default function Logo({ size = 'md', showText = true }: LogoProps): React.ReactElement {
  const iconDimensions = {
    sm: 'w-8 h-8',
    md: 'w-11 h-11',
    lg: 'w-14 h-14',
  }[size];

  const textSizes = {
    sm: 'text-xl',
    md: 'text-2xl sm:text-3xl',
    lg: 'text-3xl sm:text-4xl',
  }[size];

  return (
    <div className="flex items-center gap-3 select-none">
      {/* Brutalist Monotone Coral Red Emblem */}
      <div
        className={`${iconDimensions} bg-brutal-black border-2 border-coral-500 shadow-brutalSm flex items-center justify-center p-1.5 transition-transform active:translate-x-0.5 active:translate-y-0.5`}
        aria-hidden="true"
      >
        <svg viewBox="0 0 48 48" fill="none" className="w-full h-full">
          {/* Brutalist Geometric S Monogram */}
          <path
            d="M8 8H40V16H16V20H40V40H8V32H32V28H8V8Z"
            fill="#ff4d4d"
          />
          {/* Flanking soundwave ticks */}
          <rect x="2" y="18" width="3" height="12" fill="#ff4d4d" />
          <rect x="43" y="18" width="3" height="12" fill="#ff4d4d" />
        </svg>
      </div>

      {showText && (
        <div className="flex flex-col">
          <span
            className={`${textSizes} font-black tracking-tighter uppercase text-white leading-none font-mono`}
          >
            SUNO<span className="text-coral-500 underline decoration-coral-500 decoration-4">SHOP</span>
          </span>
          <span className="text-[10px] sm:text-xs font-mono font-bold tracking-widest uppercase text-brutal-grey mt-0.5">
            VOICE eCommerce PROXY
          </span>
        </div>
      )}
    </div>
  );
}
