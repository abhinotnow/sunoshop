/**
 * The Oriel beacon: a living 3D light that shows what Oriel is doing (listening, thinking, speaking,
 * confirmed, uncertain). Purely visual and aria-hidden; every state is also given in text and speech.
 * GPU shader displacement keeps it smooth on iPhones; it pauses when the tab is hidden and becomes a
 * still image when the user prefers reduced motion.
 */
import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { BeaconState } from "../types";

export const PALETTE: Record<BeaconState, { a: string; b: string; speed: number; amp: number; spin: number }> = {
  idle:      { a: "#0ea5b7", b: "#7cf5e4", speed: 0.35, amp: 0.10, spin: 0.15 },
  listening: { a: "#2563eb", b: "#7dd3fc", speed: 0.9,  amp: 0.16, spin: 0.25 },
  thinking:  { a: "#6d28d9", b: "#c4b5fd", speed: 1.6,  amp: 0.22, spin: 1.1 },
  speaking:  { a: "#0d9488", b: "#a7f3d0", speed: 1.1,  amp: 0.20, spin: 0.35 },
  success:   { a: "#15803d", b: "#bbf7d0", speed: 0.6,  amp: 0.14, spin: 0.3 },
  uncertain: { a: "#b45309", b: "#fde68a", speed: 0.7,  amp: 0.16, spin: 0.3 },
  error:     { a: "#b91c1c", b: "#fecaca", speed: 0.5,  amp: 0.12, spin: 0.2 },
};

export const VERT = /* glsl */ `
  uniform float uTime; uniform float uAmp;
  varying vec3 vNormal; varying vec3 vView; varying float vNoise;
  float hash(vec3 p){ p = fract(p * 0.3183099 + .1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise(vec3 x){
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  void main(){
    float n = noise(normal * 2.2 + vec3(uTime * 0.6)) * 0.65 + noise(normal * 4.5 - vec3(uTime)) * 0.35;
    vNoise = n;
    vec3 pos = position + normal * (n - 0.5) * uAmp * 2.0;
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;

export const FRAG = /* glsl */ `
  uniform vec3 uA; uniform vec3 uB; uniform float uTime;
  varying vec3 vNormal; varying vec3 vView; varying float vNoise;
  void main(){
    float fres = pow(1.0 - max(dot(vNormal, vView), 0.0), 2.2);
    vec3 col = mix(uA, uB, clamp(vNoise * 1.2 + fres * 0.6, 0.0, 1.0));
    col += uB * fres * 0.9;
    float bands = 0.06 * sin(vNoise * 30.0 + uTime * 2.0);
    gl_FragColor = vec4(col + bands, 0.92);
  }`;

function haloTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, "rgba(255,255,255,0.85)");
  grad.addColorStop(0.25, "rgba(255,255,255,0.35)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

export function Beacon3D({ state, level = 0, reducedMotion = false, className = "" }: {
  state: BeaconState; level?: number; reducedMotion?: boolean; className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  const levelRef = useRef(level);
  stateRef.current = state;
  levelRef.current = level;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    if (reducedMotion) {
      el.classList.add("beacon-static"); // a still CSS orb whose colour follows data-state
      return () => el.classList.remove("beacon-static");
    }
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    } catch {
      el.classList.add("beacon-fallback");
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
    camera.position.set(0, 0, 6.2);

    const uniforms = {
      uTime: { value: 0 }, uAmp: { value: 0.12 },
      uA: { value: new THREE.Color(PALETTE.idle.a) }, uB: { value: new THREE.Color(PALETTE.idle.b) },
    };
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.15, 24),
      new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true }));
    scene.add(core);

    const glowMat = new THREE.SpriteMaterial({ map: haloTexture(), color: new THREE.Color(PALETTE.idle.b),
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55 });
    const halo = new THREE.Sprite(glowMat);
    halo.scale.set(5.2, 5.2, 1);
    scene.add(halo);

    const ringMats: THREE.MeshBasicMaterial[] = [];
    const rings = [1.75, 2.05, 2.4].map((r, i) => {
      const m = new THREE.MeshBasicMaterial({ color: PALETTE.idle.b, transparent: true, opacity: 0.35 - i * 0.08,
        blending: THREE.AdditiveBlending, depthWrite: false });
      ringMats.push(m);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.012 + i * 0.004, 8, 160), m);
      ring.rotation.set(Math.PI / 2.4 + i * 0.5, i * 0.7, 0);
      scene.add(ring);
      return ring;
    });

    const count = 700;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 1.7 + Math.random() * 1.2;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      pos.set([r * Math.sin(ph) * Math.cos(th), r * Math.sin(ph) * Math.sin(th), r * Math.cos(ph)], i * 3);
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const pMat = new THREE.PointsMaterial({ size: 0.028, color: PALETTE.idle.b, transparent: true, opacity: 0.75,
      blending: THREE.AdditiveBlending, depthWrite: false });
    const particles = new THREE.Points(pGeo, pMat);
    scene.add(particles);

    const resize = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    const colA = new THREE.Color();
    const colB = new THREE.Color();
    const clock = new THREE.Clock();
    let t = 0;
    let raf = 0;
    let speed = PALETTE.idle.speed;
    let amp = PALETTE.idle.amp;
    let spin = PALETTE.idle.spin;

    const frame = () => {
      const p = PALETTE[stateRef.current];
      const dt = Math.min(0.05, clock.getDelta());
      speed += (p.speed - speed) * 0.05;
      spin += (p.spin - spin) * 0.05;
      const target = p.amp + (stateRef.current === "speaking" ? levelRef.current * 0.25 : 0);
      amp += (target - amp) * 0.12;
      t += dt * speed;
      uniforms.uTime.value = t;
      uniforms.uAmp.value = amp;
      colA.set(p.a);
      colB.set(p.b);
      uniforms.uA.value.lerp(colA, 0.06);
      uniforms.uB.value.lerp(colB, 0.06);
      glowMat.color.lerp(colB, 0.06);
      pMat.color.lerp(colB, 0.06);
      ringMats.forEach((m) => m.color.lerp(colB, 0.06));
      core.rotation.y += dt * spin * 0.6;
      core.rotation.x += dt * spin * 0.25;
      rings.forEach((r, i) => { r.rotation.z += dt * spin * (0.4 + i * 0.25) * (i % 2 ? -1 : 1); });
      particles.rotation.y += dt * spin * 0.3;
      particles.rotation.x += dt * spin * 0.08;
      const pulse = 1 + Math.sin(t * 2.2) * 0.03 + amp * 0.2;
      halo.scale.set(5.2 * pulse, 5.2 * pulse, 1);
      renderer.render(scene, camera);
    };

    const loop = () => {
      raf = requestAnimationFrame(loop);
      frame();
    };
    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) loop();
    };
    loop();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
      ro.disconnect();
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose();
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [reducedMotion]);

  return <div ref={host} className={`beacon ${className}`} data-state={state} aria-hidden="true" />;
}
