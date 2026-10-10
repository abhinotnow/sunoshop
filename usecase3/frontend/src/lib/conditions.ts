/**
 * Condition inference: during the first minutes, notice signals that a different mode would help,
 * then OFFER it by voice. Oriel never switches mode silently; it waits for "yes".
 *
 *   hand_motor  phone jitter while the user is trying to hold still   (motion.jitter > 0.6 m/s^2)
 *   visual      camera pointed at ground/sky a lot, or 2+ failed aims  (tilt or no-sign guidance)
 *   ageing      2+ "again" requests, or slow replies to questions (> 4 s)
 */
import { MOTION } from "./motion";
import type { Mode } from "../types";

export class ConditionInference {
  private aimFailures = 0;
  private againCount = 0;
  private slowReplies = 0;
  private tremorHits = 0;
  private offered = new Set<Mode>();

  constructor(private currentMode: () => Mode, private seen: () => Partial<Record<Mode, boolean>>) {}

  noteAimFailure() { this.aimFailures++; }
  noteAgain() { this.againCount++; }
  noteReplyDelay(ms: number) { if (ms > 4000) this.slowReplies++; }
  noteJitter(std: number | null) { if (std !== null && std > MOTION.tremorStd) this.tremorHits++; }

  /** Returns a mode to offer now, at most once per mode. */
  suggestion(): Mode | null {
    const candidates: [Mode, boolean][] = [
      ["hand_motor", this.tremorHits >= 3],
      ["visual", this.aimFailures >= 2],
      ["ageing", this.againCount >= 2 || this.slowReplies >= 2],
    ];
    for (const [mode, hit] of candidates) {
      if (hit && mode !== this.currentMode() && !this.offered.has(mode) && !this.seen()[mode]) {
        this.offered.add(mode);
        return mode;
      }
    }
    return null;
  }
}
