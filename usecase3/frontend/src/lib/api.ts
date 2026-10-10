import type { Health, Lang, PipelineEvent, Speech, Verified } from "../types";

const BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") ?? "";

export class ApiError extends Error {
  constructor(message: string, public code: string, public status = 0) {
    super(message);
  }
}

async function request(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(BASE + path, { ...init, signal: ctrl.signal });
    if (!res.ok) {
      let code = `http_${res.status}`;
      let message = res.statusText;
      try {
        const body = await res.json();
        const d = body.detail ?? body;
        code = d.code ?? code;
        message = d.message ?? (typeof d === "string" ? d : JSON.stringify(d));
      } catch {
        /* non-JSON error body */
      }
      throw new ApiError(message, code, res.status);
    }
    return res;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if ((e as Error).name === "AbortError") throw new ApiError("The server took too long to answer.", "timeout");
    throw new ApiError("Cannot reach the Oriel server.", navigator.onLine ? "network" : "offline");
  } finally {
    clearTimeout(timer);
  }
}

/** Retry only network-level failures (never 4xx), with backoff: 0.8 s, 1.6 s. */
async function withRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  let last: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const code = (e as ApiError).code;
      if (!(code === "network" || code === "timeout" || code === "http_502" || code === "http_503")) throw e;
      if (i < retries) await new Promise((r) => setTimeout(r, 800 * 2 ** i));
    }
  }
  throw last;
}

/** Reads a server-sent-event stream and calls onEvent for each `data:` block, live. */
async function streamEvents(path: string, body: FormData, onEvent: (ev: PipelineEvent) => void, timeoutMs = 90000) {
  const res = await request(path, { method: "POST", body }, timeoutMs);
  if (!res.body) {
    // very old browsers: no streaming, parse the whole body at once
    parseBlocks(await res.text(), onEvent);
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const cut = buffer.lastIndexOf("\n\n");
    if (cut >= 0) {
      parseBlocks(buffer.slice(0, cut), onEvent);
      buffer = buffer.slice(cut + 2);
    }
  }
  if (buffer.trim()) parseBlocks(buffer, onEvent);
}

function parseBlocks(text: string, onEvent: (ev: PipelineEvent) => void) {
  for (const block of text.split("\n\n")) {
    const line = block.split("\n").find((l) => l.startsWith("data: "));
    if (!line) continue;
    try {
      onEvent(JSON.parse(line.slice(6)) as PipelineEvent);
    } catch {
      /* ignore a malformed block */
    }
  }
}

export const api = {
  health: () => request("/api/health", {}, 8000).then((r) => r.json() as Promise<Health>),

  read(frames: Blob[], opts: { lang: Lang; mode: "standard" | "simple"; readsUsed: number; device: object; digitStyle: string },
    onEvent: (ev: PipelineEvent) => void) {
    const fd = new FormData();
    frames.forEach((f, i) => fd.append("frames", f, `frame${i}.jpg`));
    fd.append("lang", opts.lang);
    fd.append("mode", opts.mode);
    fd.append("reads_used", String(opts.readsUsed));
    fd.append("device", JSON.stringify(opts.device));
    fd.append("digit_style", opts.digitStyle);
    return withRetry(() => streamEvents("/api/read", fd, onEvent), 1);
  },

  ask(opts: { audio?: Blob; text?: string; inLang: Lang; outLang: Lang; context: Verified | null; frame?: Blob | null; confirmed?: boolean },
    onEvent: (ev: PipelineEvent) => void) {
    const fd = new FormData();
    if (opts.audio) fd.append("audio", opts.audio, "question.wav");
    if (opts.text) fd.append("text", opts.text);
    fd.append("in_lang", opts.inLang);
    fd.append("out_lang", opts.outLang);
    if (opts.context) fd.append("context", JSON.stringify(compactContext(opts.context)));
    if (opts.frame) fd.append("frame", opts.frame, "sign.jpg");
    fd.append("confirmed", String(Boolean(opts.confirmed)));
    return withRetry(() => streamEvents("/api/ask", fd, onEvent), 1);
  },

  speak: (text: string, lang: Lang) =>
    withRetry(() => request("/api/speak", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, lang }) }, 30000).then((r) => r.json() as Promise<{ audio_url: string | null; provider: string }>)),

  asr(audio: Blob, lang: Lang) {
    const fd = new FormData();
    fd.append("audio", audio, "speech.wav");
    fd.append("lang", lang);
    return withRetry(() => request("/api/asr", { method: "POST", body: fd }, 30000).then((r) => r.json() as Promise<{ text: string }>));
  },

  compose: (verified: Verified, lang: Lang, mode: "standard" | "simple", digitStyle: string) =>
    withRetry(() => request("/api/compose", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ verified, lang, mode, digit_style: digitStyle }) }, 45000)
      .then((r) => r.json() as Promise<{ speech: Speech; verified: Verified }>)),

  audioUrl: (path: string) => (path.startsWith("http") ? path : BASE + path),
};

/** Only what the AI needs: keeps the request small and the prompt focused. */
function compactContext(v: Verified) {
  return {
    sign_found: v.sign_found,
    category: v.category,
    fields: v.fields.map((f) => {
      const keep: Record<string, unknown> = { kind: f.kind, value: f.value, status: f.status };
      for (const k of ["role", "applies_to", "number", "countdown", "open", "close", "product", "texts"]) {
        if (f[k] !== undefined && f[k] !== null && f[k] !== "") keep[k] = f[k];
      }
      return keep;
    }),
  };
}
