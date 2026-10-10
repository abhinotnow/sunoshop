export type Lang = "te" | "hi" | "en";
export type Mode = "visual" | "ageing" | "hand_motor";
export type Status = "confirmed" | "uncertain" | "unreadable" | "info";

export interface Field {
  kind: string;
  value: string;
  status: Status;
  role?: string;
  texts?: Partial<Record<Lang, string>>;
  votes?: string;
  reason?: string;
  checks?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface Verified {
  sign_found: boolean;
  category: string;
  box: number[];
  languages: string[];
  fields: Field[];
  votes: string;
  frames: number;
  issues: { cut_off_sides: string[]; quality: string[]; sign_count: number; unclear_parts: string[] };
  second_reader: Record<string, unknown>;
}

export interface Line {
  id: string;
  kind: string;
  status: Status;
  text: string;
  audio_url?: string | null;
  lang_fallback?: Lang;
}

export interface Speech {
  key: Line[];
  more: Line[];
  spell: Line[];
  empty: boolean;
}

export interface NextStep {
  action: "done" | "reread" | "guide" | "give_up";
  phrase_ids: string[];
  focus_box: number[] | null;
  reason: string;
}

export interface ReadResult {
  verified: Verified;
  speech: Speech;
  next_step: NextStep;
  reads_used: number;
  lang: Lang;
  mode: string;
  timings_ms: Record<string, number>;
}

export interface AskResult {
  question: string;
  question_en: string;
  answer_en: string;
  answer: string;
  answer_lang: Lang;
  audio_url: string | null;
  needs_confirmation: boolean;
  confidence: string;
  out_of_scope: boolean;
  timings_ms: Record<string, number>;
}

export type StageStatus = "pending" | "running" | "progress" | "done" | "skipped" | "error";

export interface Stage {
  id: string;
  status: StageStatus;
  ms?: number;
  detail?: Record<string, unknown>;
  notes: string[];
}

export interface PipelineEvent {
  type: "stage" | "result" | "error" | "end";
  stage?: string;
  status?: StageStatus;
  ms?: number;
  detail?: Record<string, unknown>;
  code?: string;
  message?: string;
  phrase_id?: string;
  [key: string]: unknown;
}

export type BeaconState = "idle" | "listening" | "thinking" | "speaking" | "success" | "uncertain" | "error";

export type Phase = "start" | "scan" | "reading" | "result" | "asking";

export interface Health {
  ok: boolean;
  gemini: { configured: boolean; reader: string; arbiter: string; ask: string };
  anuvaad: Record<"mt" | "asr" | "tts" | "ocr", Record<string, boolean>>;
  known_places: number;
}
