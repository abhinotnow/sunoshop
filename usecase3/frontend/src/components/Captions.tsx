/** Live captions of everything Oriel says (also announced by VoiceOver through aria-live). */
export function Captions({ text, lang }: { text: string; lang: string }) {
  return (
    <div className="captions" role="status" aria-live="polite" aria-atomic="true" lang={lang}>
      {text && <p>{text}</p>}
    </div>
  );
}
