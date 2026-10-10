import { Beacon3D } from "./Beacon3D";
import { LANG_NAMES, t } from "../i18n/ui";
import { useSettings } from "../state/settings";
import { prefersReducedMotion } from "../lib/platform";
import { useTilt } from "../hooks/useTilt";
import type { Lang, Mode } from "../types";

const MODES: { id: Mode; key: "modeVisual" | "modeAgeing" | "modeHandMotor" }[] = [
  { id: "visual", key: "modeVisual" },
  { id: "ageing", key: "modeAgeing" },
  { id: "hand_motor", key: "modeHandMotor" },
];

export function StartScreen({ onStart }: { onStart: () => void }) {
  const { settings, update, setMode } = useSettings();
  const lang = settings.outLang;
  const tilt = useTilt<HTMLElement>(4);

  return (
    <main className="start" id="main">
      <div className="start-hero">
        <Beacon3D state="idle" reducedMotion={prefersReducedMotion()} className="start-beacon" />
        <div className="start-copy">
          <p className="eyebrow">Megathon 2026 · Accessible AI for All</p>
          <h1 className="brand-title">Oriel</h1>
          <p className="tagline">{t("tagline", lang)}</p>
          <p className="intro">{t("intro", lang)}</p>
        </div>
      </div>

      <section ref={tilt} className="start-panel glass" aria-labelledby="lang-heading">
        <h2 id="lang-heading" className="panel-title">{t("chooseLanguage", lang)}</h2>
        <div className="lang-grid" role="radiogroup" aria-labelledby="lang-heading">
          {(Object.keys(LANG_NAMES) as Lang[]).map((l) => (
            <button key={l} role="radio" aria-checked={settings.outLang === l} lang={l}
              className={`lang-btn ${settings.outLang === l ? "is-on" : ""}`}
              onClick={() => update({ inLang: l, outLang: l })}>
              <span className="lang-native">{LANG_NAMES[l].native}</span>
              <span className="lang-en">{LANG_NAMES[l].english}</span>
            </button>
          ))}
        </div>

        <h2 className="panel-title" id="mode-heading">{t("mode", lang)}</h2>
        <div className="mode-row" role="radiogroup" aria-labelledby="mode-heading">
          {MODES.map((m) => (
            <button key={m.id} role="radio" aria-checked={settings.mode === m.id}
              className={`chip ${settings.mode === m.id ? "is-on" : ""}`} onClick={() => setMode(m.id)}>
              {t(m.key, lang)}
            </button>
          ))}
        </div>

        <button className="start-btn" onClick={onStart} autoFocus>
          {t("startButton", lang)}
        </button>
        <p className="fine-print">{t("keyboardHint", lang)}</p>
      </section>
    </main>
  );
}
