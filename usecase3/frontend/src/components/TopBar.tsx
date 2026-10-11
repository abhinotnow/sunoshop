import { IconSettings, IconWifiOff } from "./Icons";
import { LANG_NAMES, t } from "../i18n/ui";
import { useSettings } from "../state/settings";
import type { Oriel } from "../hooks/useOriel";
import type { Lang } from "../types";

export function TopBar({ o }: { o: Oriel }) {
  const { settings } = useSettings();
  const lang = settings.outLang;
  const status = o.speaking ? t("speaking", lang) : o.busy ? (o.phase === "asking" ? t("thinking", lang) : t("reading", lang))
    : o.listening ? t("listening", lang)
    : settings.watch && (o.phase === "scan" || o.phase === "result") ? t("watching", lang)
    : o.phase === "scan" ? t("scanning", lang) : "";
  const missing = o.health && (!o.health.gemini.configured || !Object.values(o.health.anuvaad.tts ?? {}).some(Boolean));

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-dot" aria-hidden="true" />
        <span className="brand-name">Oriel</span>
      </div>
      <div className="topbar-status" aria-live="polite">
        {status && <span className={`status-pill s-${o.beacon}`}><span className="pulse" aria-hidden="true" />{status}</span>}
        {!o.online && <span className="status-pill s-error"><IconWifiOff /> {t("offline", lang)}</span>}
        {missing && <span className="status-pill s-uncertain" title="Open settings to see what is missing">{t("setupMissing", lang)}</span>}
      </div>
      <div className="topbar-actions">
        <div className="seg" role="radiogroup" aria-label={t("outputLang", lang)}>
          {(Object.keys(LANG_NAMES) as Lang[]).map((l) => (
            <button key={l} role="radio" aria-checked={lang === l} lang={l} className={lang === l ? "is-on" : ""}
              onClick={() => o.setOutLang(l)}>{LANG_NAMES[l].native}</button>
          ))}
        </div>
        <button className="icon-btn" onClick={() => o.setShowSettings(true)} aria-label={t("settings", lang)}>
          <IconSettings />
        </button>
      </div>
    </header>
  );
}
