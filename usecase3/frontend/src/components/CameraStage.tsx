import type { RefObject } from "react";
import { GestureHud } from "./GestureHud";
import { IconFlipCamera, IconShield } from "./Icons";
import { t } from "../i18n/ui";
import { useSettings } from "../state/settings";
import type { Oriel } from "../hooks/useOriel";

/** Boxes come from the unmirrored frames the server read; the front-camera preview is mirrored, so flip x. */
function boxStyle(box: number[] | null | undefined, mirrored = false) {
  if (!box || box.length !== 4) return undefined;
  const [y0, x0, y1, x1] = box;
  const left = mirrored ? 1000 - x1 : x0;
  return { top: `${y0 / 10}%`, left: `${left / 10}%`, height: `${(y1 - y0) / 10}%`, width: `${(x1 - x0) / 10}%` };
}

export function CameraStage({ o, videoRef }: { o: Oriel; videoRef: RefObject<HTMLVideoElement | null> }) {
  const { settings } = useSettings();
  const lang = settings.outLang;
  // only draw the sign box on the camera that took the photo
  const signBox = o.phase === "result" && o.facing === settings.scanCamera ? o.result?.verified.box : null;
  const mirrored = o.facing === "user";

  return (
    <section className={`stage ${o.facing === "user" ? "is-front" : ""} phase-${o.phase}`} aria-label="Camera">
      <video ref={videoRef} className="stage-video" playsInline muted autoPlay aria-hidden="true" />
      <div className="stage-shade" aria-hidden="true" />
      <div className="reticle" aria-hidden="true"><i /><i /><i /><i /></div>
      {o.busy && o.phase === "reading" && <><div className="scan-grid" aria-hidden="true" /><div className="scanline" aria-hidden="true" /></>}
      {o.focusBox && <div className="focus-box" style={boxStyle(o.focusBox, mirrored)} aria-hidden="true" />}
      {signBox && signBox.length === 4 && (
        <div className="sign-box" style={boxStyle(signBox, mirrored)} aria-hidden="true">
          <span className="sign-tag">Sign · {o.result?.verified.votes} frames</span>
        </div>
      )}

      <div className="stage-badges">
        {o.faceBlur === "on" && <span className="badge"><IconShield /> Faces blurred on device</span>}
        {o.faceBlur === "off" && <span className="badge warn">Face blur unavailable</span>}
        {settings.autoCapture && o.phase === "scan" && <span className="badge">Zero-tap</span>}
      </div>

      <button className="cam-flip" onClick={o.flipCamera} disabled={o.busy}
        aria-label={`${t("switchCamera", lang)}: ${t(settings.scanCamera === "user" ? "backCamera" : "frontCamera", lang)}`}>
        <IconFlipCamera />
        <span>{t(settings.scanCamera === "user" ? "frontCamera" : "backCamera", lang)}</span>
      </button>

      {o.cameraError && (
        <div className="stage-error" role="alert">
          <strong>{t("cameraOff", lang)}</strong>
          <p>{o.cameraError === "denied" ? "Allow camera access in Settings › Safari › Camera, then reload." : o.cameraError}</p>
        </div>
      )}
      {o.facing === "user" && settings.headGestures && <GestureHud pose={o.pose} last={o.lastGesture} lang={lang} />}
    </section>
  );
}
