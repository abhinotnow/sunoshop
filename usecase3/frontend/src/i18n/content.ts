/** Spoken guidance and voice commands, imported from the shared /data folder (single source of truth). */
import phrasesJson from "../../../data/guidance_phrases.json";
import commandsJson from "../../../data/voice_commands.json";
import type { Lang } from "../types";

interface PhraseEntry {
  id: string;
  en: string;
  hi: string;
  te: string;
}

const PHRASES: Record<string, PhraseEntry> = Object.fromEntries(
  (phrasesJson.phrases as PhraseEntry[]).map((p) => [p.id, p]),
);

export function phraseText(id: string, lang: Lang): string {
  const p = PHRASES[id];
  return p ? p[lang] || p.en : "";
}

export function hasPhrase(id: string): boolean {
  return id in PHRASES;
}

export type Command =
  | "read" | "more" | "again" | "spell" | "slower" | "faster" | "simpler"
  | "yes" | "no" | "stop" | "settings" | "help" | "ask" | "camera" | "front_camera" | "back_camera";

const COMMANDS = commandsJson.commands as Record<Command, Record<Lang, string[]>>;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A command matches only when the whole utterance IS the command phrase, or the utterance has at
 * most 3 words and starts with it. So "what does this sign say" is a question, never a command.
 * English words are always accepted too, because many people mix English into Telugu and Hindi.
 */
export function matchCommand(transcript: string, lang: Lang): Command | null {
  const said = normalize(transcript);
  if (!said) return null;
  const words = said.split(" ");
  let best: { cmd: Command; len: number } | null = null;
  for (const cmd of Object.keys(COMMANDS) as Command[]) {
    const options = [...(COMMANDS[cmd][lang] ?? []), ...(lang === "en" ? [] : COMMANDS[cmd].en)];
    for (const phrase of options) {
      const p = normalize(phrase);
      const hit = said === p || (words.length <= 3 && (said.startsWith(p + " ") || said === p));
      if (hit && (!best || p.length > best.len)) best = { cmd, len: p.length };
    }
  }
  return best?.cmd ?? null;
}
