/**
 * The world behind Oriel: a night street in Hyderabad with real-looking signs in Telugu, Hindi and English
 * floating past, and a holographic scanner that locks onto one sign at a time, sweeps it, and turns green
 * once it is "confirmed" (the same verify-then-speak story the app tells).
 *
 * Purely decorative and aria-hidden. Not mounted in high-contrast mode; a single still frame when the user
 * prefers reduced motion; a dimmer 30 fps version ("ambient") while the camera is running so reading stays
 * fast on phones. Pauses when the tab is hidden.
 */
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { PALETTE } from "./Beacon3D";
import type { BeaconState } from "../types";

const TE = '"Noto Sans Telugu", "Telugu Sangam MN", "Nirmala UI", sans-serif';
const HI = '"Noto Sans Devanagari", "Devanagari Sangam MN", "Nirmala UI", sans-serif';
const EN = 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif';
const CONFIRM = "#4ade80";

type Draw = (g: CanvasRenderingContext2D, W: number, H: number) => void;
interface SignSpec { w: number; h: number; glow: string; round?: boolean; draw: Draw }

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function board(g: CanvasRenderingContext2D, W: number, H: number, fill: string | CanvasGradient, edge = "#fff") {
  rr(g, 6, 6, W - 12, H - 12, 34);
  g.fillStyle = fill;
  g.fill();
  rr(g, 22, 22, W - 44, H - 44, 22);
  g.lineWidth = 8;
  g.strokeStyle = edge;
  g.stroke();
}

function text(g: CanvasRenderingContext2D, s: string, x: number, y: number, font: string, color: string, align: CanvasTextAlign = "center") {
  g.font = font;
  g.fillStyle = color;
  g.textAlign = align;
  g.textBaseline = "middle";
  g.fillText(s, x, y);
}

function arrow(g: CanvasRenderingContext2D, cx: number, cy: number, size: number, angle: number) {
  g.save();
  g.translate(cx, cy);
  g.rotate(angle);
  g.fillStyle = "#fff";
  g.beginPath();
  g.moveTo(0, -size);
  g.lineTo(size * 0.75, -size * 0.1);
  g.lineTo(size * 0.28, -size * 0.1);
  g.lineTo(size * 0.28, size);
  g.lineTo(-size * 0.28, size);
  g.lineTo(-size * 0.28, -size * 0.1);
  g.lineTo(-size * 0.75, -size * 0.1);
  g.closePath();
  g.fill();
  g.restore();
}

function figure(g: CanvasRenderingContext2D, cx: number, cy: number, s: number, color: string, walking: boolean) {
  g.save();
  g.fillStyle = color;
  g.strokeStyle = color;
  g.lineCap = "round";
  g.lineWidth = s * 0.16;
  g.beginPath();
  g.arc(cx, cy - s * 0.78, s * 0.16, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.moveTo(cx, cy - s * 0.55);
  g.lineTo(cx, cy + s * 0.1);
  if (walking) {
    g.moveTo(cx, cy + s * 0.1); g.lineTo(cx - s * 0.32, cy + s * 0.75);
    g.moveTo(cx, cy + s * 0.1); g.lineTo(cx + s * 0.3, cy + s * 0.72);
    g.moveTo(cx, cy - s * 0.4); g.lineTo(cx - s * 0.3, cy - s * 0.05);
    g.moveTo(cx, cy - s * 0.4); g.lineTo(cx + s * 0.3, cy - s * 0.15);
  } else {
    g.moveTo(cx - s * 0.1, cy + s * 0.1); g.lineTo(cx - s * 0.1, cy + s * 0.78);
    g.moveTo(cx + s * 0.1, cy + s * 0.1); g.lineTo(cx + s * 0.1, cy + s * 0.78);
    g.moveTo(cx - s * 0.12, cy - s * 0.45); g.lineTo(cx - s * 0.2, cy + s * 0.05);
    g.moveTo(cx + s * 0.12, cy - s * 0.45); g.lineTo(cx + s * 0.2, cy + s * 0.05);
  }
  g.stroke();
  g.restore();
}

const SIGNS: SignSpec[] = [
  { w: 2.7, h: 1.35, glow: "#22c55e", draw: (g, W, H) => {
    board(g, W, H, "#0b6b3a");
    arrow(g, 140, H / 2, 90, 0);
    text(g, "సికింద్రాబాద్", W / 2 + 70, H * 0.27, `700 92px ${TE}`, "#fff");
    text(g, "सिकंदराबाद", W / 2 + 70, H * 0.52, `600 78px ${HI}`, "#fff");
    text(g, "SECUNDERABAD", W / 2 + 70, H * 0.77, `800 76px ${EN}`, "#fff");
  } },
  { w: 2.0, h: 1.45, glow: "#3b82f6", draw: (g, W, H) => {
    board(g, W, H, "#0b3d91");
    g.fillStyle = "#facc15";
    g.fillRect(30, 30, W - 60, 120);
    text(g, "BUS STOP · బస్ స్టాప్", W / 2, 92, `800 60px ${EN}`, "#0b1020");
    text(g, "218", W / 2, H * 0.55, `800 250px ${EN}`, "#fff");
    text(g, "కోఠి  ·  Koti", W / 2, H * 0.85, `700 74px ${TE}`, "#dbeafe");
  } },
  { w: 2.6, h: 0.95, glow: "#e11d48", draw: (g, W, H) => {
    board(g, W, H, "#f4f6fb", "#1e3a8a");
    g.fillStyle = "#e11d48";
    g.beginPath(); g.arc(130, H / 2, 82, 0, Math.PI * 2); g.fill();
    text(g, "M", 130, H / 2 + 4, `900 110px ${EN}`, "#fff");
    text(g, "Ameerpet", 250, H * 0.36, `800 104px ${EN}`, "#0b1f5c", "left");
    text(g, "అమీర్‌పేట్  ·  अमीरपेट", 252, H * 0.7, `600 64px ${TE}`, "#1e3a8a", "left");
  } },
  { w: 2.8, h: 1.0, glow: "#f59e0b", draw: (g, W, H) => {
    const grad = g.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, "#7a1020"); grad.addColorStop(1, "#c2410c");
    board(g, W, H, grad, "#fde68a");
    text(g, "శ్రీ సాయి మెడికల్స్", W / 2, H * 0.3, `700 100px ${TE}`, "#fde68a");
    text(g, "SRI SAI MEDICALS", W / 2, H * 0.58, `800 80px ${EN}`, "#fff");
    text(g, "Open 9 AM – 9 PM", W / 2, H * 0.8, `600 52px ${EN}`, "#fed7aa");
  } },
  { w: 2.3, h: 1.15, glow: "#22c55e", draw: (g, W, H) => {
    board(g, W, H, "#0b6b3a");
    arrow(g, W - 140, H / 2, 86, -Math.PI / 2);
    text(g, "चारमीनार", W / 2 - 70, H * 0.28, `700 90px ${HI}`, "#fff");
    text(g, "చార్మినార్", W / 2 - 70, H * 0.53, `700 80px ${TE}`, "#fff");
    text(g, "CHARMINAR", W / 2 - 70, H * 0.78, `800 74px ${EN}`, "#fff");
  } },
  { w: 0.75, h: 1.35, glow: "#ef4444", draw: (g, W, H) => {
    rr(g, 6, 6, W - 12, H - 12, 40);
    g.fillStyle = "#05070d"; g.fill();
    g.lineWidth = 10; g.strokeStyle = "#334155"; g.stroke();
    g.fillStyle = "#111827";
    g.beginPath(); g.arc(W / 2, H * 0.28, W * 0.36, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(W / 2, H * 0.72, W * 0.36, 0, Math.PI * 2); g.fill();
    g.shadowColor = "#ef4444"; g.shadowBlur = 40;
    figure(g, W / 2, H * 0.3, W * 0.3, "#ef4444", false);
    g.shadowBlur = 0;
    figure(g, W / 2, H * 0.74, W * 0.3, "#14532d", true);
  } },
  { w: 1.1, h: 1.1, glow: "#ef4444", round: true, draw: (g, W, H) => {
    g.fillStyle = "#fff";
    g.beginPath(); g.arc(W / 2, H / 2, W / 2 - 8, 0, Math.PI * 2); g.fill();
    g.lineWidth = W * 0.11; g.strokeStyle = "#dc2626";
    g.beginPath(); g.arc(W / 2, H / 2, W / 2 - 8 - W * 0.055, 0, Math.PI * 2); g.stroke();
    text(g, "40", W / 2, H / 2 + 8, `800 ${Math.round(W * 0.42)}px ${EN}`, "#0b1020");
  } },
];

function paintSign(spec: SignSpec, canvas: HTMLCanvasElement) {
  const g = canvas.getContext("2d")!;
  g.clearRect(0, 0, canvas.width, canvas.height);
  spec.draw(g, canvas.width, canvas.height);
}

function glowTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,0.9)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.25)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function windowsTexture(seed: number): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#060a1a";
  g.fillRect(0, 0, 64, 128);
  let s = seed;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let y = 6; y < 124; y += 10) {
    for (let x = 5; x < 60; x += 11) {
      const r = rnd();
      if (r > 0.62) {
        g.fillStyle = r > 0.92 ? "rgba(125,211,252,0.85)" : r > 0.8 ? "rgba(253,230,138,0.75)" : "rgba(253,186,116,0.45)";
        g.fillRect(x, y, 6, 5);
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  return t;
}

function beamTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 8;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 128, 0);
  grad.addColorStop(0, "rgba(255,255,255,0)");
  grad.addColorStop(0.85, "rgba(255,255,255,0.35)");
  grad.addColorStop(0.97, "rgba(255,255,255,1)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 8);
  return new THREE.CanvasTexture(c);
}

const FLOOR_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;

const FLOOR_FRAG = /* glsl */ `
  uniform vec3 uColor; uniform float uScroll; uniform vec3 uCam;
  varying vec3 vWorld;
  void main(){
    vec2 p = vec2(vWorld.x, vWorld.z - uScroll);
    vec2 q = p * 0.5;
    vec2 g = abs(fract(q - 0.5) - 0.5) / fwidth(q);
    float line = 1.0 - min(min(g.x, g.y), 1.0);
    float road = 1.0 - smoothstep(2.3, 2.6, abs(vWorld.x));
    float kerb = 1.0 - smoothstep(0.0, 0.06, abs(abs(vWorld.x) - 2.45));
    float lane = (1.0 - smoothstep(0.03, 0.07, abs(vWorld.x))) * step(0.55, fract(p.y * 0.22));
    float d = length(vWorld.xz - uCam.xz);
    float fade = smoothstep(46.0, 3.0, d);
    float a = (line * (0.22 + road * 0.25) + kerb * 0.9 + lane * 0.7) * fade;
    gl_FragColor = vec4(uColor * (0.6 + kerb * 0.6), a);
  }`;

const SKY_FRAG = /* glsl */ `
  uniform vec3 uColor; varying vec2 vUv;
  void main(){
    float h = 1.0 - smoothstep(0.0, 0.55, abs(vUv.y - 0.32));
    float c = 1.0 - smoothstep(0.0, 0.5, abs(vUv.x - 0.5));
    gl_FragColor = vec4(uColor, h * (0.25 + 0.55 * c) * 0.55);
  }`;

const SKY_VERT = /* glsl */ `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const STREET_LEN = 52;
const SPEED_HERO = 1.6;
const SPEED_AMBIENT = 0.7;

export type WorldIntensity = "hero" | "ambient";

export function World3D({ state, intensity, reducedMotion = false }: {
  state: BeaconState; intensity: WorldIntensity; reducedMotion?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  const intensityRef = useRef(intensity);
  stateRef.current = state;
  intensityRef.current = intensity;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    } catch {
      return; // the CSS gradient behind the page is the fallback
    }
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x050816, 12, 48);
    const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 80);
    camera.position.set(0, 1.7, 7);
    const lookAt = new THREE.Vector3(0, 2.1, -10);

    const tint = new THREE.Color(PALETTE.idle.b);
    const disposables: { dispose: () => void }[] = [];
    const keep = <T extends { dispose: () => void }>(x: T): T => (disposables.push(x), x);

    // ---- horizon glow
    const skyU = { uColor: { value: tint.clone() } };
    const sky = new THREE.Mesh(keep(new THREE.PlaneGeometry(140, 40)), keep(new THREE.ShaderMaterial({
      uniforms: skyU, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: false })));
    sky.position.set(0, 6, -46);
    scene.add(sky);

    // ---- glowing street grid
    const floorU = { uColor: { value: tint.clone() }, uScroll: { value: 0 }, uCam: { value: camera.position } };
    const floor = new THREE.Mesh(keep(new THREE.PlaneGeometry(60, 80)), keep(new THREE.ShaderMaterial({
      uniforms: floorU, vertexShader: FLOOR_VERT, fragmentShader: FLOOR_FRAG, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending })));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -0.6, -24);
    scene.add(floor);

    // ---- buildings on both sides, edges lit in the state colour
    const edgeMat = keep(new THREE.LineBasicMaterial({ color: tint.clone(), transparent: true, opacity: 0.32 }));
    const movers: { obj: THREE.Object3D; base: number }[] = [];
    for (let i = 0; i < 26; i++) {
      const side = i % 2 ? 1 : -1;
      const w = 2.2 + Math.random() * 2.4;
      const h = 3 + Math.random() * 11;
      const d = 2.2 + Math.random() * 2.5;
      const geo = keep(new THREE.BoxGeometry(w, h, d));
      const mat = keep(new THREE.MeshBasicMaterial({ map: keep(windowsTexture(i * 7919 + 13)), color: 0x9fb3ff }));
      const b = new THREE.Mesh(geo, mat);
      const edges = new THREE.LineSegments(keep(new THREE.EdgesGeometry(geo)), edgeMat);
      b.add(edges);
      const z = -STREET_LEN + (i / 26) * STREET_LEN + Math.random() * 1.5;
      b.position.set(side * (6.2 + w / 2 + Math.random() * 3), h / 2 - 0.6, z);
      scene.add(b);
      movers.push({ obj: b, base: z });
    }

    // ---- floating signs
    const glowTex = keep(glowTexture());
    const signCanvases: { spec: SignSpec; canvas: HTMLCanvasElement; tex: THREE.CanvasTexture }[] = [];
    const signs: { group: THREE.Group; spec: SignSpec; phase: number; baseY: number }[] = [];
    const plateMat = keep(new THREE.MeshBasicMaterial({ color: 0x0b1222 }));
    const slots = [
      [-3.4, 3.4, -6], [3.6, 2.9, -12], [-3.9, 2.6, -19], [3.2, 3.6, -25],
      [-3.0, 3.1, -32], [4.0, 2.4, -38], [-4.2, 2.2, -44],
    ];
    SIGNS.forEach((spec, k) => {
      const canvas = document.createElement("canvas");
      const px = 512;
      canvas.width = Math.round(px * (spec.w / Math.max(spec.w, spec.h)) * 2);
      canvas.height = Math.round(px * (spec.h / Math.max(spec.w, spec.h)) * 2);
      paintSign(spec, canvas);
      const tex = keep(new THREE.CanvasTexture(canvas));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      signCanvases.push({ spec, canvas, tex });

      const group = new THREE.Group();
      const face = new THREE.Mesh(keep(spec.round ? new THREE.CircleGeometry(spec.w / 2, 48) : new THREE.PlaneGeometry(spec.w, spec.h)),
        keep(new THREE.MeshBasicMaterial({ map: tex, transparent: true })));
      face.position.z = 0.045;
      group.add(face);
      const plate = new THREE.Mesh(keep(spec.round ? new THREE.CylinderGeometry(spec.w / 2, spec.w / 2, 0.07, 48)
        : new THREE.BoxGeometry(spec.w * 0.985, spec.h * 0.985, 0.07)), plateMat);
      if (spec.round) plate.rotation.x = Math.PI / 2;
      group.add(plate);
      const halo = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: glowTex, color: spec.glow, transparent: true,
        opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false })));
      halo.scale.set(spec.w * 2.1, spec.h * 2.6, 1);
      halo.position.z = -0.2;
      group.add(halo);
      const pole = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.035, 0.035, 6, 8)), plateMat);
      pole.position.y = -spec.h / 2 - 3;
      group.add(pole);

      const [x, y, z] = slots[k % slots.length];
      group.position.set(x, y, z);
      group.rotation.y = x < 0 ? 0.38 : -0.38;
      scene.add(group);
      signs.push({ group, spec, phase: Math.random() * 6, baseY: y });
      movers.push({ obj: group, base: z });
    });
    // Repaint once the Telugu and Devanagari web fonts arrive (the first paint may use a fallback font).
    document.fonts?.ready.then(() => signCanvases.forEach(({ spec, canvas, tex }) => {
      paintSign(spec, canvas);
      tex.needsUpdate = true;
    })).catch(() => undefined);

    // ---- the scanner: corner brackets + a sweeping beam that lock onto one sign at a time
    const bracketMat = keep(new THREE.MeshBasicMaterial({ color: tint.clone(), transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    const bracket = new THREE.Group();
    const bar = keep(new THREE.BoxGeometry(1, 1, 1));
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const hBar = new THREE.Mesh(bar, bracketMat);
      const vBar = new THREE.Mesh(bar, bracketMat);
      hBar.userData = { sx, sy, kind: "h" };
      vBar.userData = { sx, sy, kind: "v" };
      bracket.add(hBar, vBar);
    }
    scene.add(bracket);
    const beamMat = keep(new THREE.MeshBasicMaterial({ map: keep(beamTexture()), color: tint.clone(), transparent: true,
      opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    const beam = new THREE.Mesh(keep(new THREE.PlaneGeometry(1, 1)), beamMat);
    scene.add(beam);

    // ---- drifting dust / bokeh
    const count = 520;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos.set([(Math.random() - 0.5) * 30, Math.random() * 11 - 0.5, -STREET_LEN + Math.random() * (STREET_LEN + 8)], i * 3);
    }
    const pGeo = keep(new THREE.BufferGeometry());
    pGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const pMat = keep(new THREE.PointsMaterial({ size: 0.07, color: tint.clone(), transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending, depthWrite: false }));
    const dust = new THREE.Points(pGeo, pMat);
    scene.add(dust);

    // ---- size, pointer parallax
    let dpr = 1;
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, intensityRef.current === "hero" ? 1.75 : 1);
      renderer.setPixelRatio(dpr);
      renderer.setSize(window.innerWidth, window.innerHeight, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
      camera.fov = camera.aspect < 0.8 ? 72 : 58; // phones in portrait see more street
      camera.updateProjectionMatrix();
    };
    resize();
    window.addEventListener("resize", resize);
    const pointer = { x: 0, y: 0 };
    const onPointer = (e: PointerEvent) => {
      pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", onPointer, { passive: true });

    // ---- animation
    const green = new THREE.Color(CONFIRM);
    const target = new THREE.Color();
    const scanCol = new THREE.Color();
    const clock = new THREE.Clock();
    let scroll = 0;
    let time = 0;
    let scanT = 0;
    let scanIdx = -1;
    let lastIdx = -1;
    let raf = 0;
    let lastRender = 0;
    let lastDpr = dpr;

    const pickTarget = () => {
      let best = -1;
      let bestScore = Infinity;
      signs.forEach((s, i) => {
        const z = s.group.position.z;
        if (i === lastIdx || z < -17 || z > -4.5) return;
        const score = Math.abs(z + 9) + Math.random() * 3;
        if (score < bestScore) { bestScore = score; best = i; }
      });
      return best;
    };

    const update = (dt: number) => {
      const hero = intensityRef.current === "hero";
      const speed = hero ? SPEED_HERO : SPEED_AMBIENT;
      time += dt;
      scroll += dt * speed;
      floorU.uScroll.value = scroll;

      target.set(PALETTE[stateRef.current].b);
      tint.lerp(target, 0.05);
      floorU.uColor.value.copy(tint);
      skyU.uColor.value.copy(tint);
      edgeMat.color.copy(tint);
      pMat.color.copy(tint);

      for (const m of movers) {
        let z = m.obj.position.z + dt * speed;
        if (z > 8) z -= STREET_LEN + 8;
        m.obj.position.z = z;
      }
      signs.forEach((s) => {
        s.group.position.y = s.baseY + Math.sin(time * 0.7 + s.phase) * 0.12;
        s.group.rotation.z = Math.sin(time * 0.5 + s.phase) * 0.02;
      });
      const p = dust.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < count; i++) {
        let z = p.getZ(i) + dt * speed * 1.2;
        if (z > 8) z -= STREET_LEN + 8;
        p.setZ(i, z);
        p.setY(i, p.getY(i) + Math.sin(time + i) * 0.002);
      }
      p.needsUpdate = true;

      // scanner cycle: 0-0.5 lock on, 0.5-1.8 sweep, 1.8-3.0 confirmed (green), 3.0-3.4 release
      scanT += dt;
      if (scanIdx < 0 || scanT > 3.4) {
        lastIdx = scanIdx;
        scanIdx = pickTarget();
        scanT = 0;
      }
      if (scanIdx >= 0) {
        const s = signs[scanIdx];
        const lock = Math.min(1, scanT / 0.5);
        const ease = 1 - Math.pow(1 - lock, 3);
        const grow = 1.6 - 0.48 * ease;
        const w = s.spec.w * grow / 2;
        const h = s.spec.h * grow / 2;
        const arm = Math.min(s.spec.w, s.spec.h) * 0.22;
        const th = 0.035;
        bracket.position.copy(s.group.position);
        bracket.rotation.copy(s.group.rotation);
        bracket.children.forEach((c) => {
          const { sx, sy, kind } = c.userData as { sx: number; sy: number; kind: string };
          if (kind === "h") {
            c.scale.set(arm, th, th);
            c.position.set(sx * (w - arm / 2), sy * h, 0.12);
          } else {
            c.scale.set(th, arm, th);
            c.position.set(sx * w, sy * (h - arm / 2), 0.12);
          }
        });
        const confirmed = scanT > 1.8;
        scanCol.copy(confirmed ? green : tint);
        bracketMat.color.lerp(scanCol, confirmed ? 0.2 : 1);
        bracketMat.opacity = scanT < 3.0 ? ease : Math.max(0, 1 - (scanT - 3.0) / 0.4);
        const sweep = Math.min(1, Math.max(0, (scanT - 0.5) / 1.3));
        beam.visible = scanT > 0.5 && scanT < 1.8;
        if (beam.visible) {
          beam.position.copy(s.group.position);
          beam.rotation.copy(s.group.rotation);
          beam.translateX((sweep - 0.5) * s.spec.w * 1.1); // bright leading edge travels left to right
          beam.translateZ(0.1);
          beam.scale.set(s.spec.w * 0.4, s.spec.h * 1.15, 1);
          beamMat.color.copy(tint);
          beamMat.opacity = Math.sin(sweep * Math.PI) * 0.9;
        }
      } else {
        bracketMat.opacity = 0;
        beam.visible = false;
      }

      // gentle drift plus pointer parallax
      const tx = pointer.x * 0.9 + Math.sin(time * 0.15) * 0.35;
      const ty = 1.7 - pointer.y * 0.35 + Math.sin(time * 0.21) * 0.08;
      camera.position.x += (tx - camera.position.x) * 0.03;
      camera.position.y += (ty - camera.position.y) * 0.03;
      camera.lookAt(lookAt);
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const ambient = intensityRef.current === "ambient";
      if (ambient && now - lastRender < 32) return; // ~30 fps while the camera is busy
      lastRender = now;
      const wantDpr = Math.min(window.devicePixelRatio || 1, ambient ? 1 : 1.75);
      if (wantDpr !== lastDpr) { lastDpr = wantDpr; resize(); }
      update(Math.min(0.05, clock.getDelta()));
      renderer.render(scene, camera);
    };

    const still = () => {
      update(0.016);
      scanIdx = signs.findIndex((s) => s.group.position.z > -12 && s.group.position.z < -4);
      scanT = 2.2; // show a confirmed lock in the still frame
      update(0);
      renderer.render(scene, camera);
    };

    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden && !reducedMotion) {
        clock.getDelta();
        raf = requestAnimationFrame(loop);
      }
    };

    if (reducedMotion) {
      still();
      window.addEventListener("resize", still);
      document.fonts?.ready.then(still).catch(() => undefined);
    } else {
      raf = requestAnimationFrame(loop);
      document.addEventListener("visibilitychange", onVisibility);
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("resize", still);
      window.removeEventListener("pointermove", onPointer);
      document.removeEventListener("visibilitychange", onVisibility);
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [reducedMotion]);

  return <div ref={host} className={`world world-${intensity}`} aria-hidden="true" />;
}
