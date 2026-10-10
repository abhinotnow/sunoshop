/**
 * Subtle 3D tilt that follows the mouse (desktop demos only). Sets --rx / --ry / --mx / --my on the element;
 * CSS does the rest. Off for touch screens and reduced motion, where moving panels would only get in the way.
 */
import { useEffect, useRef } from "react";
import { isTouch, prefersReducedMotion } from "../lib/platform";

export function useTilt<T extends HTMLElement>(max = 5) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || isTouch || prefersReducedMotion()) return;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        el.style.setProperty("--ry", `${(x * max * 2).toFixed(2)}deg`);
        el.style.setProperty("--rx", `${(-y * max * 2).toFixed(2)}deg`);
        el.style.setProperty("--mx", `${((x + 0.5) * 100).toFixed(1)}%`);
        el.style.setProperty("--my", `${((y + 0.5) * 100).toFixed(1)}%`);
      });
    };
    const onLeave = () => {
      cancelAnimationFrame(raf);
      el.style.setProperty("--rx", "0deg");
      el.style.setProperty("--ry", "0deg");
    };
    el.classList.add("tilt");
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      el.classList.remove("tilt");
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, [max]);
  return ref;
}
