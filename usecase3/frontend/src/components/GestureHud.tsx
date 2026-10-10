import { t } from "../i18n/ui";
import type { HeadGesture, HeadPose } from "../lib/headGestures";
import type { Lang } from "../types";

const LABEL: Record<HeadGesture, string> = { nod: "Nod · yes", shake: "Shake · no", tilt_right: "Tilt right · again", tilt_left: "Tilt left · new sign" };

function Bar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = Math.max(-1, Math.min(1, value / max));
  return (
    <div className="g-bar">
      <span>{label}</span>
      <div className="g-track"><div className="g-fill" style={{ left: `${50 + Math.min(0, pct) * 50}%`, width: `${Math.abs(pct) * 50}%` }} /></div>
    </div>
  );
}

export function GestureHud({ pose, last, lang }: { pose: HeadPose | null; last: HeadGesture | null; lang: Lang }) {
  return (
    <div className="gesture-hud glass" aria-live="assertive">
      <p className="g-title">MediaPipe · 478 landmarks {pose?.face ? "" : "· looking for a face"}</p>
      <Bar label="Yaw" value={pose?.yaw ?? 0} max={0.3} />
      <Bar label="Pitch" value={pose?.pitch ?? 0} max={0.25} />
      <Bar label="Roll" value={pose?.roll ?? 0} max={30} />
      {last && <p className="g-last">{LABEL[last]}</p>}
      <p className="g-help">{t("gestureHelp", lang)}</p>
    </div>
  );
}
