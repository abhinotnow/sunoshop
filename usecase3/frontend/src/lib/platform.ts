/** Device facts that change behaviour (mostly iPhone/iPad Safari quirks). */

export const isIOS: boolean =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); // iPadOS reports as Mac

export const isTouch: boolean = "ontouchstart" in window || navigator.maxTouchPoints > 0;

export const prefersReducedMotion = (): boolean =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

export const isSecure: boolean = window.isSecureContext;

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
