import { useEffect } from "react";
import { api } from "../lib/api";
import { Beacon3D } from "./Beacon3D";
import { LANG_NAMES, t } from "../i18n/ui";
import { useSettings } from "../state/settings";
import { prefersReducedMotion } from "../lib/platform";
import { useTilt } from "../hooks/useTilt";
import type { Oriel } from "../hooks/useOriel";
import type { Lang, Mode } from "../types";

const MODES: { id: Mode; key: "modeVisual" | "modeAgeing" | "modeHandMotor" }[] = [
  { id: "visual", key: "modeVisual" },
  { id: "ageing", key: "modeAgeing" },
  { id: "hand_motor", key: "modeHandMotor" },
];

export function StartScreen({ o }: { o: Oriel }) {
  const onStart = () => void o.start();
  const { settings, update, setMode } = useSettings();
  // Wake the server while the user picks a language (free hosting sleeps and needs ~30-60 s to start).
  useEffect(() => {
    void api.health().catch(() => undefined);
  }, []);
  const lang = settings.outLang;
  const tilt = useTilt<HTMLElement>(4);

  return (
    <main className="start" id="main" onClick={(e) => {
      // a blind user cannot find the buttons: a tap anywhere else starts the spoken setup
      if (!(e.target as HTMLElement).closest("button, a, input, select, [role=radio]")) void o.onboard();
    }}>
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
        <div className="tap-start">
          <p lang="te">{t("start", "te")}</p>
          <p lang="hi">{t("start", "hi")}</p>
          <p lang="en">{t("start", "en")}</p>
        </div>
        <p className="fine-print">{t("keyboardHint", lang)}</p>
      </section>
      {o.onboardStep !== "idle" && (
        <div className="onboard" onClick={(e) => { e.stopPropagation(); o.onboardTap(); }} role="dialog" aria-live="polite">
          <div className={`onboard-orb ${o.listening ? "is-listening" : ""}`} aria-hidden="true" />
          {o.onboardStep === "language" ? (
            <ol className="onboard-options">
              <li lang="te"><b>1</b> తెలుగు</li>
              <li lang="hi"><b>2</b> हिंदी</li>
              <li lang="en"><b>3</b> English</li>
            </ol>
          ) : (
            <ol className="onboard-options" lang={settings.outLang}>
              <li><b>1</b> {t("modeVisual", settings.outLang)}</li>
              <li><b>2</b> {t("modeAgeing", settings.outLang)}</li>
              <li><b>3</b> {t("modeHandMotor", settings.outLang)}</li>
            </ol>
          )}
          {o.onboardStep === "language" ? (
            <div className="onboard-hint">
              {(["te", "hi", "en"] as Lang[]).map((l) => <p key={l} lang={l}>{t("choiceHint", l)}</p>)}
            </div>
          ) : (
            <p className="onboard-hint" lang={settings.outLang}>{t("choiceHint", settings.outLang)}</p>
          )}
          <button className="onboard-skip" onClick={(e) => { e.stopPropagation(); o.skipOnboarding(); }}>Skip ›</button>
        </div>
      )}
    </main>
  );
}
