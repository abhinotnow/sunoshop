import { useEffect, useRef } from "react";
import { AskPanel } from "./components/AskPanel";
import { CameraStage } from "./components/CameraStage";
import { Captions } from "./components/Captions";
import { ControlDock } from "./components/ControlDock";
import { DialogCard } from "./components/DialogCard";
import { HoloStage } from "./components/HoloStage";
import { PipelinePanel } from "./components/PipelinePanel";
import { ResultPanel } from "./components/ResultPanel";
import { SettingsSheet } from "./components/SettingsSheet";
import { StartScreen } from "./components/StartScreen";
import { TopBar } from "./components/TopBar";
import { World3D } from "./components/World3D";
import { useOriel } from "./hooks/useOriel";
import { useSettings } from "./state/settings";
import { isTouch, prefersReducedMotion } from "./lib/platform";
import { t } from "./i18n/ui";

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const o = useOriel(videoRef);
  const { settings } = useSettings();

  // Keyboard and switch-access shortcuts (laptops, Bluetooth switches that send keys)
  useEffect(() => {
    if (o.phase === "start") return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select") || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const map: Record<string, () => void> = {
        " ": () => (o.phase === "result" ? o.newSign() : o.readNow()),
        a: o.again, m: o.more, s: o.spell, q: () => void o.startAsk(), c: o.flipCamera, escape: o.stop,
        y: () => o.runCommand("yes"), n: () => o.runCommand("no"),
      };
      if (map[k] && !o.showSettings) {
        e.preventDefault();
        map[k]();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [o]);

  // One 3D world for the whole session (kept mounted from Start to reading), never in high contrast.
  // Phones: the 3D street only on the start screen, so it never competes with the camera and capture.
  const world = settings.highContrast || (isTouch && o.phase !== "start") ? null : (
    <World3D state={o.phase === "start" ? "idle" : o.beacon} intensity={o.phase === "start" ? "hero" : "ambient"}
      reducedMotion={prefersReducedMotion()} />
  );

  if (o.phase === "start") return <>{world}<StartScreen onStart={() => void o.start()} /></>;

  return (
    <>{world}
    <div className={`app mode-${settings.mode}`}>
      <a className="skip-link" href="#result-heading">Skip to the reading</a>
      <TopBar o={o} />
      <main className="layout" id="main">
        <div className="col-left">
          <CameraStage o={o} videoRef={videoRef} />
          <ControlDock o={o} />
        </div>
        <div className="col-right">
          {!settings.highContrast && <HoloStage o={o} lang={settings.outLang} />}
          <ResultPanel o={o} />
          <AskPanel o={o} />
          <PipelinePanel pipeline={o.pipeline} />
        </div>
      </main>
      <Captions text={o.caption} lang={settings.outLang} />
      {o.audioBlocked && (
        <button className="tap-to-hear" onClick={o.tapToHear} lang={settings.outLang} autoFocus>
          {t("tapToHear", settings.outLang)}
        </button>
      )}
      <SettingsSheet o={o} />
      <DialogCard dialog={o.dialog} lang={settings.outLang} />
    </div>
    </>
  );
}
