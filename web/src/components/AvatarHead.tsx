"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/**
 * Avatar presence surface v2 (plan §6 Phase 3): lightweight three.js head with
 * amplitude-driven lip-sync, blinking, and idle motion. Deliberately behind a
 * swappable boundary — v3 replaces this renderer with a photoreal head without
 * touching the voice loop.
 */
export default function AvatarHead({
  levelsRef,
}: {
  levelsRef: React.RefObject<{ agent: number; user: number }>;
}) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0c1016);
    const camera = new THREE.PerspectiveCamera(26, 1, 0.05, 20);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    // Mission-Log lighting: warm key, cyan rim, soft fill
    const key = new THREE.DirectionalLight(0xffd9a8, 2.4);
    key.position.set(0.6, 1.9, 1.2);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x59d2de, 1.1);
    rim.position.set(-1.2, 1.7, -0.8);
    scene.add(rim);
    scene.add(new THREE.AmbientLight(0x8a93a6, 0.55));

    type MorphMesh = THREE.Mesh & {
      morphTargetDictionary: Record<string, number>;
      morphTargetInfluences: number[];
    };
    const morphMeshes: MorphMesh[] = [];
    let headBone: THREE.Object3D | null = null;
    let neckBone: THREE.Object3D | null = null;
    let disposed = false;

    const setMorph = (name: string, value: number) => {
      for (const m of morphMeshes) {
        const idx = m.morphTargetDictionary[name];
        if (idx !== undefined) m.morphTargetInfluences[idx] = value;
      }
    };

    new GLTFLoader().load("/avatar.glb", (gltf) => {
      if (disposed) return;
      scene.add(gltf.scene);
      gltf.scene.traverse((o) => {
        const mesh = o as MorphMesh;
        if (mesh.isMesh && mesh.morphTargetDictionary) morphMeshes.push(mesh);
      });
      headBone = gltf.scene.getObjectByName("Head") ?? null;
      neckBone = gltf.scene.getObjectByName("Neck") ?? null;
      const anchor = headBone ?? gltf.scene;
      const p = new THREE.Vector3();
      anchor.getWorldPosition(p);
      camera.position.set(p.x, p.y + 0.04, p.z + 0.62);
      camera.lookAt(p.x, p.y + 0.02, p.z);
    });

    const resize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    let mouth = 0;
    let blink = 0;
    let nextBlink = performance.now() + 1800;
    let raf = 0;

    const animate = (t: number) => {
      raf = requestAnimationFrame(animate);
      const agent = levelsRef.current?.agent ?? 0;
      const user = levelsRef.current?.user ?? 0;

      // lip-sync: fast attack, slower release, split across visemes
      const target = Math.min(1, agent * 3.2);
      mouth += (target - mouth) * (target > mouth ? 0.55 : 0.22);
      const flutter = 0.5 + 0.5 * Math.sin(t / 61) * Math.sin(t / 47);
      setMorph("jawOpen", mouth * 0.38);
      setMorph("viseme_aa", mouth * 0.55 * flutter);
      setMorph("viseme_O", mouth * 0.3 * (1 - flutter));
      setMorph("viseme_I", mouth * 0.22 * Math.abs(Math.sin(t / 83)));
      setMorph("mouthSmileLeft", 0.12 + user * 0.15);
      setMorph("mouthSmileRight", 0.12 + user * 0.15);

      // blinking
      if (t > nextBlink) {
        blink = 1;
        nextBlink = t + 1600 + Math.random() * 4200;
      }
      blink = Math.max(0, blink - 0.12);
      const b = blink > 0.5 ? (1 - blink) * 2 : blink * 2;
      setMorph("eyeBlinkLeft", b);
      setMorph("eyeBlinkRight", b);

      // idle sway + attentive lean when the user speaks
      if (headBone) {
        headBone.rotation.y = Math.sin(t / 3100) * 0.055 + Math.sin(t / 1300) * 0.012;
        headBone.rotation.x =
          Math.sin(t / 2600) * 0.03 - user * 0.05 + agent * 0.02;
        headBone.rotation.z = Math.sin(t / 4400) * 0.02;
      }
      if (neckBone) neckBone.rotation.y = Math.sin(t / 3700) * 0.03;

      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(animate);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [levelsRef]);

  return <div ref={mountRef} className="h-full w-full" />;
}
