import { t } from "../i18n/ui";
import { useSettings } from "../state/settings";
import type { Pipeline } from "../hooks/useOriel";
import type { Stage } from "../types";

const LABELS: Record<string, { title: string; sub: string }> = {
  quality: { title: "Frames", sub: "sharpest of the burst" },
  read: { title: "Reader 1", sub: "Gemini Flash-Lite × 3" },
  second_reader: { title: "Reader 2 + OCR", sub: "independent ultra-high-res read · AnuvaadHub OCR" },
  verify: { title: "Verify", sub: "agreement + checks" },
  guidance: { title: "Guide", sub: "reposition or read again" },
  compose: { title: "Compose", sub: "templates · names protected" },
  tts: { title: "Speak", sub: "AnuvaadHub TTS" },
  asr: { title: "ASR", sub: "AnuvaadHub speech → text" },
  translate_in: { title: "Translate", sub: "your language → English" },
  ai: { title: "AI", sub: "Gemini, grounded in the sign" },
  translate_out: { title: "Translate", sub: "English → your language" },
};

function detailText(s: Stage): string {
  const d = s.detail ?? {};
  if (typeof d.text === "string" && d.text) return d.text;
  if (s.id === "quality" && Array.isArray(d.sharpness)) return `sharpness ${(d.sharpness as number[]).join(" / ")}`;
  if (s.id === "read") return s.notes.slice(-3).join(" · ");
  if (s.id === "second_reader") return [d.arbiter && `crop: ${d.arbiter}`, d.ocr && `ocr: ${d.ocr}`].filter(Boolean).join(" · ");
  if (s.id === "verify" && d.category) return `${d.category}: ${d.confirmed ?? 0} confirmed, ${d.uncertain ?? 0} to check`;
  if (s.id === "guidance" && d.action) return `${d.action}${Array.isArray(d.phrases) && d.phrases.length ? ` · ${(d.phrases as string[]).join(", ")}` : ""}`;
  if (s.id === "tts" && d.provider) return `voice: ${d.provider}`;
  if (s.id === "compose" && d.lines !== undefined) return `${d.lines} sentences`;
  return "";
}

export function PipelinePanel({ pipeline }: { pipeline: Pipeline | null }) {
  const { settings } = useSettings();
  if (!settings.showPipeline || !pipeline) return null;
  return (
    <section className="panel glass pipeline" aria-label={t("pipeline", settings.outLang)}>
      <div className="panel-head">
        <h2>{t("pipeline", settings.outLang)} · {pipeline.kind === "ask" ? "speech to speech" : "sign reading"}</h2>
        {pipeline.totalMs !== undefined && <span className="category">{Math.round(pipeline.totalMs)} ms</span>}
      </div>
      <ol className="stages">
        {pipeline.stages.map((s, i) => (
          <li key={s.id + i} className={`stage-node is-${s.status}`}>
            <span className="node-dot" aria-hidden="true" />
            <div className="node-body">
              <div className="node-title">
                <strong>{LABELS[s.id]?.title ?? s.id}</strong>
                {s.ms !== undefined && <span className="ms">{s.ms} ms</span>}
              </div>
              <p className="node-sub">{LABELS[s.id]?.sub}</p>
              {detailText(s) && <p className="node-detail">{detailText(s)}</p>}
            </div>
          </li>
        ))}
      </ol>
      {pipeline.error && <p className="pipeline-error" role="alert">{pipeline.error}</p>}
    </section>
  );
}
