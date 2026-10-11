/**
 * The Oriel hologram: a live, touchable 3D view of what the assistant is doing.
 *
 *  - the AI core (tap it to read / start a new sign) breathes with Oriel's state and pulses with its voice
 *  - the pipeline stages orbit the core and light up live from the server's stage events; energy flows along
 *    the arcs, a shockwave marks each finished stage; tap a stage to see what it did (models, timings, text)
 *  - the result materialises as a holographic sign, each fact marked confirmed (green) or "please check"
 *    (amber); tap it to hear it again
 *  - drag to spin (with momentum), tilt the phone to look around, taps send ripples
 *
 * Purely visual and aria-hidden: everything shown here is also in the result and pipeline panels as text.
 * Not mounted in high-contrast mode; still (no animation) when the user prefers reduced motion.
 */
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { FRAG, PALETTE, VERT } from "./Beacon3D";
import { LABELS, detailText } from "./PipelinePanel";
import { t } from "../i18n/ui";
import { isTouch, prefersReducedMotion } from "../lib/platform";
import type { Oriel } from "../hooks/useOriel";
import type { Lang, ReadResult, Stage } from "../types";

const STATUS_COLOR: Record<string, string> = {
  pending: "#33427a", running: "#a78bfa", progress: "#a78bfa", done: "#4ade80", skipped: "#5b6785", error: "#f87171",
};
const OK = "#4ade80";
const CHECK = "#fbbf24";
const RING_R = 3.05;

function textSprite(text: string, color = "#dbe6ff", size = 46): THREE.Sprite {
  const c = document.createElement("canvas");
  const g = c.getContext("2d")!;
  g.font = `700 ${size}px Inter, system-ui, sans-serif`;
  const w = Math.ceil(g.measureText(text).width) + 40;
  c.width = w;
  c.height = size + 30;
  const g2 = c.getContext("2d")!;
  g2.font = `700 ${size}px Inter, system-ui, sans-serif`;
  g2.textBaseline = "middle";
  g2.fillStyle = "rgba(5,8,22,0.72)";
  g2.beginPath();
  g2.roundRect?.(2, 2, w - 4, c.height - 4, 18);
  g2.fill();
  g2.fillStyle = color;
  g2.fillText(text, 20, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  const h = 0.32;
  sp.scale.set((h * w) / c.height, h, 1);
  return sp;
}

function glowTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.3, "rgba(255,255,255,0.35)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/** The holographic sign: header + up to 3 key lines with a status chip each. */
function paintBoard(canvas: HTMLCanvasElement, res: ReadResult | null, lang: Lang) {
  const g = canvas.getContext("2d")!;
  const W = canvas.width, H = canvas.height;
  g.clearRect(0, 0, W, H);
  if (!res) return;
  const lines = res.speech.key.slice(0, 2); // the hologram shows the first two facts; the panel lists all
  const confirmed = lines.some((l) => l.status === "confirmed");
  const edge = confirmed ? OK : CHECK;
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "rgba(10,22,48,0.92)");
  grad.addColorStop(1, "rgba(6,12,30,0.92)");
  g.fillStyle = grad;
  g.beginPath();
  g.roundRect?.(8, 8, W - 16, H - 16, 36);
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = edge;
  g.shadowColor = edge;
  g.shadowBlur = 30;
  g.stroke();
  g.shadowBlur = 0;
  for (let y = 20; y < H - 20; y += 6) { // hologram scanlines
    g.fillStyle = "rgba(126,249,230,0.035)";
    g.fillRect(16, y, W - 32, 2);
  }
  const font = lang === "te" ? "'Noto Sans Telugu'" : lang === "hi" ? "'Noto Sans Devanagari'" : "Inter";
  g.fillStyle = "#9fb3e8";
  g.font = `800 34px Inter, system-ui, sans-serif`;
  g.textBaseline = "top";
  g.fillText(t("whatSignSays", lang).toUpperCase(), 48, 40);
  const cat = res.verified.category && res.verified.category !== "none" ? res.verified.category.replace(/_/g, " ") : "";
  if (cat) {
    g.font = `700 28px Inter, system-ui, sans-serif`;
    const w = g.measureText(cat).width + 36;
    g.fillStyle = "rgba(148,197,255,0.16)";
    g.beginPath();
    g.roundRect?.(W - w - 48, 34, w, 46, 23);
    g.fill();
    g.fillStyle = "#cfe0ff";
    g.fillText(cat, W - w - 30, 42);
  }
  let y = 112;
  const maxW = W - 180;
  for (const l of lines) {
    const ok = l.status === "confirmed";
    const col = ok ? OK : l.status === "info" ? "#93c5fd" : CHECK;
    g.fillStyle = col;
    g.beginPath();
    g.arc(78, y + 30, 26, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#06121f";
    g.font = `900 34px Inter, system-ui, sans-serif`;
    g.textAlign = "center";
    g.fillText(ok ? "✓" : l.status === "info" ? "i" : "?", 78, y + 12);
    g.textAlign = "left";
    g.fillStyle = "#f4f7ff";
    g.font = `700 44px ${font}, Inter, system-ui, sans-serif`;
    const words = l.text.split(" ");
    let row = "";
    let rows = 0;
    for (const w of words) {
      const next = row ? `${row} ${w}` : w;
      if (g.measureText(next).width > maxW && row) {
        g.fillText(row, 126, y + rows * 54);
        rows++;
        row = w;
        if (rows >= 2) break;
      } else row = next;
    }
    if (rows < 2 && row) {
      g.fillText(row, 126, y + rows * 54);
      rows++;
    }
    y += rows * 54 + 30;
    if (y > H - 70) break;
  }
}

interface NodeObj {
  id: string;
  group: THREE.Group;
  orb: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  glow: THREE.Sprite;
  label: THREE.Sprite;
  status: string;
  color: THREE.Color;
}

export function HoloStage({ o, lang }: { o: Oriel; lang: Lang }) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef({ o, lang });
  live.current = { o, lang };
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const focus = useRef<string | null>(null); // the stage under the pointer or pinned, read by the render loop
  focus.current = picked ?? hover?.id ?? null;
  const reduced = prefersReducedMotion();

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch {
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isTouch ? 1.25 : 1.75));
    el.appendChild(renderer.domElement);
    const canvas = renderer.domElement;
    canvas.style.touchAction = "pan-y"; // vertical swipes still scroll the page on phones

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0, 1.35, 9.4);
    camera.lookAt(0, 0.55, 0);
    const disposables: { dispose: () => void }[] = [];
    const keep = <T extends { dispose: () => void }>(x: T): T => (disposables.push(x), x);
    const glowTex = keep(glowTexture());

    const rig = new THREE.Group(); // everything that spins with a drag
    scene.add(rig);

    // ---- AI core
    const coreU = { uTime: { value: 0 }, uAmp: { value: 0.14 }, uA: { value: new THREE.Color(PALETTE.idle.a) },
      uB: { value: new THREE.Color(PALETTE.idle.b) } };
    const core = new THREE.Mesh(keep(new THREE.IcosahedronGeometry(1.05, 32)),
      keep(new THREE.ShaderMaterial({ uniforms: coreU, vertexShader: VERT, fragmentShader: FRAG, transparent: true })));
    rig.add(core);
    const coreGlowMat = keep(new THREE.SpriteMaterial({ map: glowTex, color: PALETTE.idle.b, transparent: true,
      opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    const coreGlow = new THREE.Sprite(coreGlowMat);
    coreGlow.scale.set(4.4, 4.4, 1);
    scene.add(coreGlow);

    // ---- voice ring: 72 bars around the core, driven by the speech level
    const bars: THREE.Mesh[] = [];
    const barMat = keep(new THREE.MeshBasicMaterial({ color: PALETTE.idle.b, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false }));
    const barGeo = keep(new THREE.BoxGeometry(0.035, 1, 0.035));
    const voice = new THREE.Group();
    for (let i = 0; i < 72; i++) {
      const b = new THREE.Mesh(barGeo, barMat);
      const a = (i / 72) * Math.PI * 2;
      b.position.set(Math.cos(a) * 1.55, Math.sin(a) * 1.55, 0);
      b.rotation.z = a - Math.PI / 2;
      voice.add(b);
      bars.push(b);
    }
    scene.add(voice); // faces the camera, does not spin with the rig

    // ---- pipeline ring
    const ring = new THREE.Group();
    ring.rotation.x = 0.42;
    rig.add(ring);
    const orbitLine = new THREE.Mesh(keep(new THREE.TorusGeometry(RING_R, 0.008, 6, 200)),
      keep(new THREE.MeshBasicMaterial({ color: "#3b5bdb", transparent: true, opacity: 0.35 })));
    orbitLine.rotation.x = Math.PI / 2;
    ring.add(orbitLine);
    const nodeGeo = keep(new THREE.SphereGeometry(0.17, 24, 16));
    let nodes: NodeObj[] = [];
    let arcs: { curve: THREE.QuadraticBezierCurve3; line: THREE.Line; mat: THREE.LineBasicMaterial }[] = [];
    let nodeKey = "";

    const buildRing = (stages: Stage[]) => {
      nodes.forEach((n) => { ring.remove(n.group); n.mat.dispose(); (n.glow.material as THREE.Material).dispose();
        (n.label.material as THREE.SpriteMaterial).map?.dispose(); (n.label.material as THREE.Material).dispose(); });
      arcs.forEach((a) => { ring.remove(a.line); a.line.geometry.dispose(); a.mat.dispose(); });
      nodes = [];
      arcs = [];
      const n = stages.length;
      stages.forEach((s, i) => {
        const ang = (i / n) * Math.PI * 2 - Math.PI / 2;
        const group = new THREE.Group();
        group.position.set(Math.cos(ang) * RING_R, 0, Math.sin(ang) * RING_R);
        const mat = new THREE.MeshBasicMaterial({ color: STATUS_COLOR.pending });
        const orb = new THREE.Mesh(nodeGeo, mat);
        orb.userData = { stage: s.id };
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: STATUS_COLOR.pending, transparent: true,
          opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
        glow.scale.set(1.1, 1.1, 1);
        const label = textSprite(LABELS[s.id]?.title ?? s.id);
        label.position.y = 0.46;
        group.add(glow, orb, label);
        ring.add(group);
        nodes.push({ id: s.id, group, orb, mat, glow, label, status: "pending", color: new THREE.Color(STATUS_COLOR.pending) });
      });
      for (let i = 0; i < n - 1; i++) {
        const a = nodes[i].group.position, b = nodes[i + 1].group.position;
        const mid = a.clone().add(b).multiplyScalar(0.5);
        mid.multiplyScalar(1.22).setY(0.55);
        const curve = new THREE.QuadraticBezierCurve3(a.clone(), mid, b.clone());
        const mat = new THREE.LineBasicMaterial({ color: "#3b4f8f", transparent: true, opacity: 0.6 });
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(40)), mat);
        ring.add(line);
        arcs.push({ curve, line, mat });
      }
    };

    // ---- energy packets, shockwaves, ripples
    const packets: { sp: THREE.Sprite; arc: number; t: number }[] = [];
    const packetMat = keep(new THREE.SpriteMaterial({ map: glowTex, color: "#c4f5ff", transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false }));
    const waveGeo = keep(new THREE.RingGeometry(0.2, 0.26, 48));
    const waves: { mesh: THREE.Mesh; t: number; mat: THREE.MeshBasicMaterial }[] = [];
    const spawnWave = (parent: THREE.Object3D, color: string, facing: "up" | "camera" = "up") => {
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false });
      const mesh = new THREE.Mesh(waveGeo, mat);
      if (facing === "up") mesh.rotation.x = -Math.PI / 2;
      parent.add(mesh);
      waves.push({ mesh, t: 0, mat });
    };

    // ---- particles
    const count = isTouch ? 420 : 900;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 1.6 + Math.random() * 3.4;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      pos.set([r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * 0.6, r * Math.sin(ph) * Math.sin(th)], i * 3);
    }
    const pGeo = keep(new THREE.BufferGeometry());
    pGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const pMat = keep(new THREE.PointsMaterial({ size: 0.035, color: PALETTE.idle.b, transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false }));
    const dust = new THREE.Points(pGeo, pMat);
    rig.add(dust);

    // ---- holographic sign
    const boardCanvas = document.createElement("canvas");
    boardCanvas.width = 1024;
    boardCanvas.height = 420;
    const boardTex = keep(new THREE.CanvasTexture(boardCanvas));
    boardTex.colorSpace = THREE.SRGBColorSpace;
    const boardMat = keep(new THREE.MeshBasicMaterial({ map: boardTex, transparent: true, depthWrite: false }));
    const board = new THREE.Mesh(keep(new THREE.PlaneGeometry(5.4, 5.4 * 420 / 1024)), boardMat);
    board.position.set(0, 1.45, 2.2);
    board.scale.set(1, 0.001, 1);
    board.visible = false;
    scene.add(board);
    const boardGlowMat = keep(new THREE.SpriteMaterial({ map: glowTex, color: OK, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false }));
    const boardGlow = new THREE.Sprite(boardGlowMat);
    boardGlow.scale.set(6, 3.6, 1);
    boardGlow.position.copy(board.position).setZ(1.8);
    scene.add(boardGlow);
    let boardFor: ReadResult | null = null;
    let boardShow = 0;

    // ---- size
    const resize = () => {
      const w = el.clientWidth || 1, h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      camera.aspect = w / h;
      camera.position.z = w / h < 1 ? 11.5 : 9.4; // narrow phones: step back so the ring fits
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    // ---- interaction: drag to spin (momentum), hover/tap with a raycaster, phone tilt
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let dragging = false, moved = 0, lastX = 0, lastY = 0, spinV = 0.0025, tiltX = 0, tiltTarget = 0;
    let gravX = 0, gravY = 0;
    const pick = (cx: number, cy: number): THREE.Object3D | null => {
      const r = canvas.getBoundingClientRect();
      ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const targets: THREE.Object3D[] = [core, ...nodes.map((n) => n.orb)];
      if (board.visible && board.scale.y > 0.5) targets.push(board);
      return ray.intersectObjects(targets, false)[0]?.object ?? null;
    };
    const onDown = (e: PointerEvent) => {
      dragging = true;
      moved = 0;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture?.(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (dragging) {
        const dx = e.clientX - lastX, dy = e.clientY - lastY;
        moved += Math.abs(dx) + Math.abs(dy);
        spinV = dx * 0.0045;
        rig.rotation.y += dx * 0.008;
        tiltTarget = Math.max(-0.45, Math.min(0.45, tiltTarget + dy * 0.004));
        lastX = e.clientX;
        lastY = e.clientY;
        return;
      }
      const hit = pick(e.clientX, e.clientY);
      const id = (hit?.userData.stage as string | undefined) ?? null;
      canvas.style.cursor = hit ? "pointer" : "grab";
      const r = el.getBoundingClientRect();
      setHover(id ? { id, x: e.clientX - r.left, y: e.clientY - r.top } : null);
    };
    const onUp = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      if (moved > 8) return;
      const hit = pick(e.clientX, e.clientY);
      const cur = live.current.o;
      if (hit === core) {
        spawnWave(scene, PALETTE[cur.beacon].b, "camera");
        if (!cur.busy) {
          if (cur.phase === "result") cur.newSign();
          else cur.readNow();
        }
      } else if (hit === board) {
        spawnWave(scene, OK, "camera");
        cur.again();
      } else if (hit?.userData.stage) {
        setPicked((p) => (p === hit.userData.stage ? null : (hit.userData.stage as string)));
      } else {
        setPicked(null);
        spawnWave(scene, "#7c9cff", "camera");
      }
    };
    const onLeave = () => setHover(null);
    const onMotion = (e: DeviceMotionEvent) => {
      const g = e.accelerationIncludingGravity;
      if (!g || g.x == null || g.y == null) return;
      gravX = Math.max(-1, Math.min(1, g.x / 6));
      gravY = Math.max(-1, Math.min(1, (g.y + 6) / 6));
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", () => (dragging = false));
    canvas.addEventListener("pointerleave", onLeave);
    window.addEventListener("devicemotion", onMotion);

    // ---- animation
    const colA = new THREE.Color(), colB = new THREE.Color(), tmp = new THREE.Color();
    const clock = new THREE.Clock();
    let time = 0, raf = 0, lastPacket = 0, level = 0;
    const prevStatus = new Map<string, string>();

    const frame = () => {
      const dt = reduced ? 0 : Math.min(0.05, clock.getDelta());
      time += dt;
      const { o: cur, lang: curLang } = live.current;
      const p = PALETTE[cur.beacon];
      const stages = cur.pipeline?.stages ?? [];

      // ring follows the pipeline that is running (read or ask)
      const key = stages.map((s) => s.id).join(",") || "quality,read,second_reader,verify,guidance,compose,tts";
      if (key !== nodeKey) {
        nodeKey = key;
        buildRing(stages.length ? stages : key.split(",").map((id) => ({ id, status: "pending", notes: [] } as Stage)));
        prevStatus.clear();
      }
      nodes.forEach((n, i) => {
        const st = stages[i]?.status ?? "pending";
        const prev = prevStatus.get(n.id);
        if (prev && prev !== st) {
          if (st === "done") spawnWave(n.group, STATUS_COLOR.done);
          if (st === "error") spawnWave(n.group, STATUS_COLOR.error);
        }
        prevStatus.set(n.id, st);
        n.status = st;
        n.color.lerp(tmp.set(STATUS_COLOR[st] ?? STATUS_COLOR.pending), 0.12);
        n.mat.color.copy(n.color);
        (n.glow.material as THREE.SpriteMaterial).color.copy(n.color);
        const running = st === "running" || st === "progress";
        const s = running ? 1.25 + Math.sin(time * 8) * 0.18 : st === "done" ? 1.05 : 0.85;
        n.orb.scale.setScalar(n.orb.scale.x + (s - n.orb.scale.x) * 0.15);
        n.glow.scale.setScalar(running ? 1.6 + Math.sin(time * 8) * 0.3 : st === "done" ? 1.2 : 0.8);
        const hovered = n.id === focus.current;
        n.label.material.opacity = hovered || running ? 1 : 0.72;
      });
      arcs.forEach((a, i) => {
        const from = nodes[i]?.status, to = nodes[i + 1]?.status;
        const flowing = from === "done" && (to === "running" || to === "progress");
        a.mat.color.lerp(tmp.set(from === "done" && to === "done" ? "#2f9e64" : flowing ? "#c4b5fd" : "#3b4f8f"), 0.1);
        a.mat.opacity = flowing ? 0.95 : 0.55;
        if (flowing && time - lastPacket > 0.12 && !reduced) {
          lastPacket = time;
          const sp = new THREE.Sprite(packetMat);
          sp.scale.setScalar(0.32);
          ring.add(sp);
          packets.push({ sp, arc: i, t: 0 });
        }
      });
      for (let i = packets.length - 1; i >= 0; i--) {
        const pk = packets[i];
        pk.t += dt * 1.5;
        if (pk.t >= 1 || !arcs[pk.arc]) {
          ring.remove(pk.sp);
          packets.splice(i, 1);
          continue;
        }
        pk.sp.position.copy(arcs[pk.arc].curve.getPoint(pk.t));
      }
      for (let i = waves.length - 1; i >= 0; i--) {
        const w = waves[i];
        w.t += dt * 1.4;
        w.mesh.scale.setScalar(1 + w.t * 9);
        w.mat.opacity = Math.max(0, 0.9 * (1 - w.t));
        if (w.mesh.parent === scene) w.mesh.quaternion.copy(camera.quaternion);
        if (w.t >= 1) {
          w.mesh.parent?.remove(w.mesh);
          w.mat.dispose();
          waves.splice(i, 1);
        }
      }

      // core + palette
      coreU.uTime.value = time * (0.6 + p.speed);
      level += ((cur.speaking ? cur.level : 0) - level) * 0.2;
      coreU.uAmp.value += (p.amp + level * 0.22 - coreU.uAmp.value) * 0.1;
      colA.set(p.a);
      colB.set(p.b);
      coreU.uA.value.lerp(colA, 0.06);
      coreU.uB.value.lerp(colB, 0.06);
      coreGlowMat.color.lerp(colB, 0.06);
      pMat.color.lerp(colB, 0.04);
      barMat.color.lerp(colB, 0.06);
      core.rotation.y += dt * p.spin * 0.8;
      coreGlow.scale.setScalar(4.2 + Math.sin(time * 2) * 0.15 + level * 1.4);
      bars.forEach((b, i) => {
        const wave = cur.speaking ? level * (0.35 + 0.65 * Math.abs(Math.sin(time * 9 + i * 0.7))) : 0.04 + 0.03 * Math.sin(time * 2 + i * 0.3);
        b.scale.y += (0.05 + wave * 0.9 - b.scale.y) * 0.3;
        b.position.setLength(1.55 + b.scale.y / 2);
      });
      barMat.opacity = cur.speaking ? 0.9 : 0.35;

      // spin with momentum + phone tilt
      if (!dragging) {
        spinV += ((cur.busy ? 0.012 : 0.0025) - spinV) * 0.02;
        rig.rotation.y += reduced ? 0 : spinV;
      }
      tiltX += (tiltTarget + gravY * 0.25 - tiltX) * 0.08;
      rig.rotation.x = tiltX;
      rig.rotation.z = -gravX * 0.15;
      dust.rotation.y += dt * 0.05;

      // holographic sign
      const res = cur.result;
      if (res !== boardFor) {
        boardFor = res;
        paintBoard(boardCanvas, res, res?.lang ?? curLang);
        boardTex.needsUpdate = true;
        if (res) {
          boardShow = 0;
          board.visible = true;
          const ok = res.speech.key.some((l) => l.status === "confirmed");
          boardGlowMat.color.set(ok ? OK : CHECK);
          spawnWave(scene, ok ? OK : CHECK, "camera");
        }
      }
      const want = res && cur.phase !== "reading" ? 1 : 0;
      boardShow += (want - boardShow) * (reduced ? 1 : 0.08);
      board.visible = boardShow > 0.01;
      board.scale.y = Math.max(0.001, boardShow);
      board.position.y = 1.45 + Math.sin(time * 1.3) * 0.06;
      // the hologram takes the stage: the core and ring sink and shrink behind it
      rig.position.y += (-1.15 * boardShow - rig.position.y) * 0.1;
      rig.scale.setScalar(1 - 0.22 * boardShow);
      voice.position.y = rig.position.y;
      voice.scale.setScalar(1 - 0.22 * boardShow);
      coreGlow.position.y = rig.position.y;
      board.rotation.y = Math.sin(time * 0.6) * 0.06 + gravX * 0.1;
      boardMat.opacity = Math.min(1, boardShow * 1.2) * (0.9 + Math.sin(time * 30) * 0.03);
      boardGlowMat.opacity = boardShow * 0.35;

      renderer.render(scene, camera);
    };

    let lastT = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (reduced && now - lastT < 500) return; // reduced motion: a still picture, refreshed twice a second
      if (isTouch && now - lastT < 30) return;  // phones: ~30 fps
      lastT = now;
      frame();
    };
    raf = requestAnimationFrame(loop);
    const onVis = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) {
        clock.getDelta();
        raf = requestAnimationFrame(loop);
      }
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("devicemotion", onMotion);
      ro.disconnect();
      buildRing([]);
      waves.forEach((w) => w.mat.dispose());
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      canvas.remove();
    };
  }, [reduced]); // eslint-disable-line react-hooks/exhaustive-deps

  const stages = o.pipeline?.stages ?? [];
  const show = picked ?? hover?.id ?? null;
  const st = show ? stages.find((s) => s.id === show) : undefined;
  const label = show ? LABELS[show] : undefined;

  return (
    <section className="panel glass holo" aria-hidden="true">
      <div ref={host} className="holo-canvas" />
      <div className="holo-hud">
        <span className="holo-chip">{o.pipeline?.kind === "ask" ? "speech to speech" : "sign reading"} · live</span>
        {o.pipeline?.totalMs !== undefined && <span className="holo-chip">{Math.round(o.pipeline.totalMs)} ms</span>}
      </div>
      <p className="holo-hint">{isTouch ? "Tap the core to read · drag to spin · tap a stage" : "Click the core to read · drag to spin · click a stage"}</p>
      {show && label && (
        <div className={`holo-tip ${picked ? "is-pinned" : ""}`}
          style={!picked && hover ? { left: hover.x + 14, top: hover.y + 14 } : undefined}>
          <strong>{label.title}</strong>
          <span className="holo-tip-sub">{label.sub}</span>
          <span className={`holo-tip-status s-${st?.status ?? "pending"}`}>
            {st?.status ?? "waiting"}{st?.ms !== undefined ? ` · ${st.ms} ms` : ""}
          </span>
          {st && detailText(st) && <span className="holo-tip-detail">{detailText(st)}</span>}
        </div>
      )}
    </section>
  );
}
