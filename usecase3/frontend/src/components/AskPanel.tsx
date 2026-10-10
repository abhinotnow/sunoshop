import { useState } from "react";
import { IconMic } from "./Icons";
import { t } from "../i18n/ui";
import { useSettings } from "../state/settings";
import type { Oriel } from "../hooks/useOriel";

export function AskPanel({ o }: { o: Oriel }) {
  const { settings } = useSettings();
  const lang = settings.outLang;
  const [text, setText] = useState("");
  const a = o.askResult;

  return (
    <section className="panel glass ask" aria-labelledby="ask-heading">
      <div className="panel-head">
        <h2 id="ask-heading">{t("askTitle", lang)}</h2>
      </div>
      <p className="hint">{t("askHint", lang)}</p>
      <div className="ask-row">
        <button className={`mic-btn ${o.listening && o.phase === "asking" ? "is-live" : ""}`}
          onClick={() => (o.listening && o.phase === "asking" ? o.finishListening() : void o.startAsk())} disabled={o.busy}
          aria-label={o.listening ? t("stopRecording", lang) : t("record", lang)}>
          <IconMic />
          <span>{o.listening && o.phase === "asking" ? t("stopRecording", lang) : t("record", lang)}</span>
        </button>
        <form className="ask-form" onSubmit={(e) => { e.preventDefault(); o.askText(text); setText(""); }}>
          <label className="sr-only" htmlFor="ask-input">{t("typeQuestion", lang)}</label>
          <input id="ask-input" value={text} onChange={(e) => setText(e.target.value)} placeholder={t("typeQuestion", lang)}
            lang={settings.inLang} autoComplete="off" enterKeyHint="send" />
          <button className="btn" type="submit" disabled={!text.trim() || o.busy}>{t("send", lang)}</button>
        </form>
      </div>
      {a && (
        <dl className="qa">
          <dt>{t("youAsked", lang)}</dt>
          <dd lang={settings.inLang}>{a.question}</dd>
          <dt>{t("answer", lang)}{a.confidence ? ` · ${a.confidence}` : ""}</dt>
          <dd lang={a.answer_lang} className="answer">{a.answer}</dd>
        </dl>
      )}
    </section>
  );
}
