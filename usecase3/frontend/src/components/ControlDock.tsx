import { useRef } from "react";
import { Beacon3D } from "./Beacon3D";
import { IconImage, IconMic, IconStop } from "./Icons";
import { t } from "../i18n/ui";
import { prefersReducedMotion } from "../lib/platform";
import { useSettings } from "../state/settings";
import type { Oriel } from "../hooks/useOriel";

/** The main control: the beacon itself is the big "read now" button (reachable by tap, Space or voice). */
export function ControlDock({ o }: { o: Oriel }) {
  const { settings } = useSettings();
  const lang = settings.outLang;
  const file = useRef<HTMLInputElement>(null);
  const mainLabel = o.phase === "result" ? t("newSign", lang) : t("readNow", lang);

  return (
    <div className="dock">
      <button className="dock-side" onClick={() => file.current?.click()} aria-label={t("upload", lang)}>
        <IconImage /><span>{t("upload", lang)}</span>
      </button>
      <input ref={file} type="file" accept="image/*" multiple hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) o.readFiles(files);
          e.target.value = "";
        }} />

      <button className={`dock-main ${o.busy ? "is-busy" : ""}`} aria-label={mainLabel} aria-busy={o.busy}
        onClick={() => (o.phase === "result" ? o.newSign() : o.readNow())} disabled={o.busy}>
        <Beacon3D state={o.beacon} level={o.level} reducedMotion={prefersReducedMotion()} className="dock-beacon" />
        <span className="dock-label">{o.busy ? t("reading", lang) : mainLabel}</span>
      </button>

      {o.speaking || o.listening ? (
        <button className="dock-side" onClick={o.stop} aria-label={t("stop", lang)}>
          <IconStop /><span>{t("stop", lang)}</span>
        </button>
      ) : (
        <button className="dock-side" onClick={() => void o.startAsk()} aria-label={t("ask", lang)} disabled={o.busy}>
          <IconMic /><span>{t("ask", lang)}</span>
        </button>
      )}
    </div>
  );
}
