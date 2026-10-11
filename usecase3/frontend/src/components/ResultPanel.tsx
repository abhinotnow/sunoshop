import { useEffect, useState, type CSSProperties } from "react";
import { IconAlert, IconCheck, IconInfo, IconMinus, IconPlus, IconRepeat, IconSparkle, IconSpell } from "./Icons";
import { t } from "../i18n/ui";
import { useSettings } from "../state/settings";
import { useTilt } from "../hooks/useTilt";
import type { Oriel } from "../hooks/useOriel";
import type { Lang, Line, Status } from "../types";

function StatusBadge({ status, lang }: { status: Status; lang: Lang }) {
  const icon = status === "confirmed" ? <IconCheck size={16} /> : status === "uncertain" ? <IconAlert size={16} />
    : status === "info" ? <IconInfo size={16} /> : <IconMinus size={16} />;
  return <span className={`badge-status st-${status}`}>{icon}{t(status, lang)}</span>;
}

function FactCard({ line, lang, index = 0 }: { line: Line; lang: Lang; index?: number }) {
  return (
    <li className={`fact st-${line.status}`} style={{ "--i": index } as CSSProperties}>
      <StatusBadge status={line.status} lang={lang} />
      <p className="fact-text" lang={line.lang_fallback ?? lang}>{line.text}</p>
    </li>
  );
}

export function ResultPanel({ o }: { o: Oriel }) {
  const { settings } = useSettings();
  const lang = o.result?.lang ?? settings.outLang;
  const [index, setIndex] = useState(0);
  const [showMore, setShowMore] = useState(false);
  const tilt = useTilt<HTMLElement>(3);
  const r = o.result;
  useEffect(() => {
    setIndex(0);
    setShowMore(false);
  }, [r]);

  if (!r) return null;
  const key = r.speech.key;
  const onePerScreen = settings.mode === "ageing" && key.length > 1;
  const shown = onePerScreen ? key.slice(index, index + 1) : key;

  return (
    <section ref={tilt} className="panel glass result" aria-labelledby="result-heading">
      <div className="panel-head">
        <h2 id="result-heading">{t(r.verified.sign_found ? "whatSignSays" : "whatISee", lang)}</h2>
        {r.verified.category && r.verified.category !== "none" && (
          <span className="category">{r.verified.category.replace(/_/g, " ")}</span>
        )}
      </div>

      {key.length === 0 ? (
        <p className="empty">—</p>
      ) : (
        <ul className="facts">{shown.map((l, i) => <FactCard key={l.id} line={l} lang={lang} index={i} />)}</ul>
      )}

      {onePerScreen && (
        <div className="pager">
          <button className="btn ghost" onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0}>{t("previous", lang)}</button>
          <span aria-live="polite">{index + 1} / {key.length}</span>
          <button className="btn ghost" onClick={() => setIndex((i) => Math.min(key.length - 1, i + 1))} disabled={index >= key.length - 1}>{t("next", lang)}</button>
        </div>
      )}

      <div className="actions" role="group" aria-label="Result actions">
        <button className="btn" onClick={o.again}><IconRepeat />{t("again", lang)}</button>
        <button className="btn" onClick={() => { setShowMore(true); o.more(); }} disabled={!r.speech.more.length}><IconPlus />{t("more", lang)}</button>
        <button className="btn" onClick={o.spell} disabled={!r.speech.spell.length}><IconSpell />{t("spell", lang)}</button>
        <button className="btn" onClick={o.simpler}><IconSparkle />{t("simpler", lang)}</button>
      </div>

      {showMore && r.speech.more.length > 0 && (
        <details open className="more">
          <summary><h3>{t("moreDetails", lang)}</h3></summary>
          <ul className="facts small">{r.speech.more.map((l, i) => <FactCard key={l.id} line={l} lang={lang} index={i} />)}</ul>
        </details>
      )}

      <details className="evidence">
        <summary>How Oriel checked this ({r.verified.votes} frames saw a sign · {r.timings_ms?.total ?? "?"} ms)</summary>
        <ul>
          {r.verified.fields.map((f, i) => (
            <li key={i}><code>{f.kind}</code> “{String(f.value)}” — <b>{f.status}</b>{f.votes ? ` · frames ${f.votes}` : ""}{f.reason ? ` · ${f.reason}` : ""}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}
