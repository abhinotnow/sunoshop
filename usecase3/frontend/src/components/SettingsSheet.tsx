import { useEffect, useRef } from "react";
import { IconClose } from "./Icons";
import { LANG_NAMES, t } from "../i18n/ui";
import { useSettings, type Settings } from "../state/settings";
import type { Oriel } from "../hooks/useOriel";
import type { Lang, Mode } from "../types";

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <span>{label}</span>
      <input type="checkbox" role="switch" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-ui" aria-hidden="true" />
    </label>
  );
}

function LangPicker({ label, value, onChange }: { label: string; value: Lang; onChange: (l: Lang) => void }) {
  return (
    <fieldset className="field">
      <legend>{label}</legend>
      <div className="seg wide">
        {(Object.keys(LANG_NAMES) as Lang[]).map((l) => (
          <button key={l} type="button" lang={l} className={value === l ? "is-on" : ""} aria-pressed={value === l}
            onClick={() => onChange(l)}>{LANG_NAMES[l].native}</button>
        ))}
      </div>
    </fieldset>
  );
}

export function SettingsSheet({ o }: { o: Oriel }) {
  const { settings: s, update, setMode } = useSettings();
  const lang = s.outLang;
  const ref = useRef<HTMLDivElement>(null);
  const set = <K extends keyof Settings>(k: K) => (v: Settings[K]) => update({ [k]: v } as Partial<Settings>);

  useEffect(() => {
    if (!o.showSettings) return;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && o.setShowSettings(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [o.showSettings]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!o.showSettings) return null;
  const h = o.health;
  const models = (kind: "mt" | "asr" | "tts" | "ocr") =>
    h ? Object.entries(h.anuvaad[kind] ?? {}).map(([k, ok]) => `${k}${ok ? " ✓" : " ✗"}`).join("  ") : "…";

  return (
    <div className="sheet-backdrop" onClick={() => o.setShowSettings(false)}>
      <div className="sheet glass" role="dialog" aria-modal="true" aria-labelledby="settings-title" tabIndex={-1} ref={ref}
        onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h2 id="settings-title">{t("settings", lang)}</h2>
          <button className="icon-btn" onClick={() => o.setShowSettings(false)} aria-label={t("close", lang)}><IconClose /></button>
        </div>

        <LangPicker label={t("listenLang", lang)} value={s.inLang} onChange={set("inLang")} />
        <LangPicker label={t("outputLang", lang)} value={s.outLang} onChange={(l) => o.setOutLang(l)} />

        <fieldset className="field">
          <legend>{t("mode", lang)}</legend>
          <div className="mode-cards">
            {([["visual", "modeVisual"], ["ageing", "modeAgeing"], ["hand_motor", "modeHandMotor"]] as [Mode, "modeVisual" | "modeAgeing" | "modeHandMotor"][]).map(([m, key]) => (
              <button key={m} type="button" className={`mode-card ${s.mode === m ? "is-on" : ""}`} aria-pressed={s.mode === m} onClick={() => setMode(m)}>
                {t(key, lang)}
              </button>
            ))}
          </div>
        </fieldset>

        <Toggle label={t("tapAnywhereSetting", lang)} value={s.tapAnywhere} onChange={set("tapAnywhere")} />
        <Toggle label={t("watchSetting", lang)} value={s.watchMode} onChange={set("watchMode")} />

        <fieldset className="field">
          <legend>{t("readingCamera", lang)}</legend>
          <div className="seg wide two">
            {(["environment", "user"] as const).map((f) => (
              <button key={f} type="button" className={s.scanCamera === f ? "is-on" : ""} aria-pressed={s.scanCamera === f}
                onClick={() => o.setScanCamera(f)}>{t(f === "user" ? "frontCamera" : "backCamera", lang)}</button>
            ))}
          </div>
        </fieldset>

        <label className="range">
          <span>{t("speechSpeed", lang)} · {s.speechRate.toFixed(2)}×</span>
          <input type="range" min={0.6} max={1.6} step={0.05} value={s.speechRate} onChange={(e) => update({ speechRate: Number(e.target.value) })} />
        </label>
        <label className="range">
          <span>{t("textSize", lang)} · {Math.round(s.textScale * 100)}%</span>
          <input type="range" min={1} max={1.8} step={0.1} value={s.textScale} onChange={(e) => update({ textScale: Number(e.target.value) })} />
        </label>

        <div className="toggles">
          <Toggle label={t("autoCapture", lang)} value={s.autoCapture} onChange={set("autoCapture")} />
          <Toggle label={t("handsFree", lang)} value={s.handsFree} onChange={set("handsFree")} />
          <Toggle label={t("headGestures", lang)} value={s.headGestures} onChange={set("headGestures")} />
          <Toggle label={t("simpleWords", lang)} value={s.simpleWords} onChange={set("simpleWords")} />
          <Toggle label={t("digitsEnglish", lang)} value={s.englishDigits} onChange={set("englishDigits")} />
          <Toggle label={t("highContrast", lang)} value={s.highContrast} onChange={set("highContrast")} />
          <Toggle label={t("showPipeline", lang)} value={s.showPipeline} onChange={set("showPipeline")} />
          <Toggle label={t("screenReader", lang)} value={s.screenReader} onChange={set("screenReader")} />
        </div>

        <details className="system">
          <summary>System status</summary>
          <dl>
            <dt>Gemini</dt><dd>{h ? (h.gemini.configured ? `${h.gemini.reader} + ${h.gemini.arbiter}` : "API key missing") : "…"}</dd>
            <dt>Translation</dt><dd>{models("mt")}</dd>
            <dt>Speech recognition</dt><dd>{models("asr")}</dd>
            <dt>Speech</dt><dd>{models("tts")}</dd>
            <dt>OCR</dt><dd>{models("ocr")}</dd>
            <dt>Known places</dt><dd>{h?.known_places ?? "…"}</dd>
          </dl>
          <p className="fine-print">{t("keyboardHint", lang)}</p>
        </details>
      </div>
    </div>
  );
}
