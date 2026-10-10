/** Small inline icons (no icon font: works offline and scales with text). Decorative: aria-hidden. */
import type { ReactNode } from "react";

function Svg({ children, size = 22 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export const IconMic = () => <Svg><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></Svg>;
export const IconRepeat = () => <Svg><path d="M17 2l4 4-4 4" /><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4" /><path d="M21 13v2a3 3 0 0 1-3 3H3" /></Svg>;
export const IconPlus = () => <Svg><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></Svg>;
export const IconSpell = () => <Svg><path d="M4 18l4-12 4 12M5.5 14h5M15 10h5l-5 8h5" /></Svg>;
export const IconSparkle = () => <Svg><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></Svg>;
export const IconStop = () => <Svg><rect x="6" y="6" width="12" height="12" rx="2" /></Svg>;
export const IconFlipCamera = () => <Svg><path d="M20 7h-3l-2-3H9L7 7H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1z" /><path d="M9 13a3 3 0 0 1 5.2-2" /><path d="M15 13a3 3 0 0 1-5.2 2" /><path d="M14.5 9.5v1.7h-1.7M9.5 16.5v-1.7h1.7" /></Svg>;
export const IconSettings = () => <Svg><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></Svg>;
export const IconImage = () => <Svg><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M21 16l-5-5-9 9" /></Svg>;
export const IconCheck = ({ size }: { size?: number }) => <Svg size={size}><path d="M20 6L9 17l-5-5" /></Svg>;
export const IconAlert = ({ size }: { size?: number }) => <Svg size={size}><path d="M12 3l9.5 17h-19z" /><path d="M12 10v4M12 17.5v.5" /></Svg>;
export const IconMinus = ({ size }: { size?: number }) => <Svg size={size}><circle cx="12" cy="12" r="9" /><path d="M8 12h8" /></Svg>;
export const IconInfo = ({ size }: { size?: number }) => <Svg size={size}><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.5" /></Svg>;
export const IconScan = () => <Svg><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10" /></Svg>;
export const IconClose = () => <Svg><path d="M6 6l12 12M18 6L6 18" /></Svg>;
export const IconWifiOff = () => <Svg><path d="M2 8.8a15 15 0 0 1 4.2-2.6M22 8.8A15 15 0 0 0 10.7 5M5 12.6a10 10 0 0 1 5.2-2.5M19 12.6a10 10 0 0 0-2.3-1.6M8.5 16.4a5 5 0 0 1 7 0M12 20h.01M3 3l18 18" /></Svg>;
export const IconShield = () => <Svg><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M9 12l2 2 4-4" /></Svg>;
