"use client";

import { useMemo, useRef, type RefObject } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";

type Node = {
  position: [number, number, number];
  scale: number;
  hue: number; // 0-1, used to shift between violet / cyan / amber
  phase: number;
};

type Edge = [number, number];

// Seeded RNG so the graph is stable across renders.
function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildGraph(seed = 7, count = 42) {
  const rand = mulberry32(seed);
  const nodes: Node[] = [];
  for (let i = 0; i < count; i++) {
    // Distribute roughly on a sphere, slightly jittered radii.
    const t = i / count;
    const theta = Math.acos(1 - 2 * t);
    const phi = Math.PI * (1 + Math.sqrt(5)) * i;
    const r = 2.4 + (rand() - 0.5) * 0.8;
    const x = r * Math.sin(theta) * Math.cos(phi);
    const y = r * Math.sin(theta) * Math.sin(phi);
    const z = r * Math.cos(theta);
    nodes.push({
      position: [x, y, z],
      scale: 0.05 + rand() * 0.09,
      hue: rand(),
      phase: rand() * Math.PI * 2,
    });
  }

  const edges: Edge[] = [];
  for (let i = 0; i < count; i++) {
    const distances = nodes
      .map((n, j) => {
        if (j === i) return { j, d: Infinity };
        const dx = n.position[0] - nodes[i].position[0];
        const dy = n.position[1] - nodes[i].position[1];
        const dz = n.position[2] - nodes[i].position[2];
        return { j, d: Math.sqrt(dx * dx + dy * dy + dz * dz) };
      })
      .sort((a, b) => a.d - b.d);
    // Connect to 2-3 nearest neighbors.
    const k = 2 + Math.floor(rand() * 2);
    for (let n = 0; n < k; n++) {
      const j = distances[n].j;
      if (j > i) edges.push([i, j]);
    }
  }

  return { nodes, edges };
}

function hueToColor(hue: number) {
  // Blend violet → cyan → amber across the 0-1 range.
  // Multiply by a brightness factor > 1 so meshBasicMaterial (toneMapped=false)
  // exceeds the bloom luminance threshold and halates — without flattening the
  // palette into white. Because values get clipped by bloom, the palette
  // remains visible but the brightest instances now glow.
  const BRIGHTNESS = 1.85;
  const violet = new THREE.Color("#8b5cf6");
  const cyan = new THREE.Color("#38bdf8");
  const amber = new THREE.Color("#f59e0b");
  const base = hue < 0.5 ? violet.lerp(cyan, hue * 2) : cyan.lerp(amber, (hue - 0.5) * 2);
  base.multiplyScalar(BRIGHTNESS);
  return base;
}

function Nodes({ nodes }: { nodes: Node[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const colorRef = useRef<Float32Array>(new Float32Array(nodes.length * 3));
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const pulse = 1 + Math.sin(t * 0.6 + n.phase) * 0.1;
      dummy.position.set(...n.position);
      dummy.scale.setScalar(n.scale * pulse);
      dummy.updateMatrix();
      ref.current.setMatrixAt(i, dummy.matrix);

      const color = hueToColor(n.hue);
      colorRef.current[i * 3] = color.r;
      colorRef.current[i * 3 + 1] = color.g;
      colorRef.current[i * 3 + 2] = color.b;
    }
    ref.current.instanceMatrix.needsUpdate = true;
    if (ref.current.instanceColor) {
      ref.current.instanceColor.needsUpdate = true;
    }
  });

  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, nodes.length]}
      frustumCulled={false}
    >
      <sphereGeometry args={[1, 24, 24]} />
      <meshBasicMaterial
        transparent
        opacity={0.92}
        toneMapped={false}
      />
      <instancedBufferAttribute
        attach="instanceColor"
        args={[colorRef.current, 3]}
      />
    </instancedMesh>
  );
}

function Edges({ nodes, edges }: { nodes: Node[]; edges: Edge[] }) {
  const geometry = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    const positions = new Float32Array(edges.length * 6);
    const alphas = new Float32Array(edges.length * 2);
    for (let i = 0; i < edges.length; i++) {
      const [a, b] = edges[i];
      const pa = nodes[a].position;
      const pb = nodes[b].position;
      positions[i * 6] = pa[0];
      positions[i * 6 + 1] = pa[1];
      positions[i * 6 + 2] = pa[2];
      positions[i * 6 + 3] = pb[0];
      positions[i * 6 + 4] = pb[1];
      positions[i * 6 + 5] = pb[2];
      alphas[i * 2] = 0.4;
      alphas[i * 2 + 1] = 0.4;
    }
    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geom.setAttribute("alpha", new THREE.BufferAttribute(alphas, 1));
    return geom;
  }, [nodes, edges]);

  const materialRef = useRef<THREE.ShaderMaterial>(null);

  useFrame(({ clock }) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = clock.getElapsedTime();
    }
  });

  return (
    <lineSegments geometry={geometry}>
      <shaderMaterial
        ref={materialRef}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        uniforms={{ uTime: { value: 0 } }}
        vertexShader={`
          attribute float alpha;
          varying float vAlpha;
          varying float vY;
          void main() {
            vAlpha = alpha;
            vY = position.y;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `}
        fragmentShader={`
          varying float vAlpha;
          varying float vY;
          uniform float uTime;
          void main() {
            float pulse = 0.5 + 0.5 * sin(uTime * 0.8 + vY * 1.2);
            vec3 base = mix(vec3(0.55, 0.36, 0.97), vec3(0.22, 0.74, 0.97), pulse);
            gl_FragColor = vec4(base, vAlpha * (0.3 + 0.7 * pulse));
          }
        `}
      />
    </lineSegments>
  );
}

function Rig({
  nodes,
  edges,
  mouse,
}: {
  nodes: Node[];
  edges: Edge[];
  mouse: RefObject<{ x: number; y: number }>;
}) {
  const group = useRef<THREE.Group>(null);

  useFrame(({ clock }, delta) => {
    if (!group.current) return;
    const t = clock.getElapsedTime();
    group.current.rotation.y = t * 0.08;
    group.current.rotation.x = Math.sin(t * 0.05) * 0.15;

    // Gentle mouse parallax.
    const tx = mouse.current.x * 0.12;
    const ty = -mouse.current.y * 0.12;
    group.current.position.x += (tx - group.current.position.x) * Math.min(1, delta * 3);
    group.current.position.y += (ty - group.current.position.y) * Math.min(1, delta * 3);
  });

  return (
    <group ref={group}>
      <Nodes nodes={nodes} />
      <Edges nodes={nodes} edges={edges} />
    </group>
  );
}

export function SceneGraph() {
  const { nodes, edges } = useMemo(() => buildGraph(7, 42), []);
  const mouse = useRef({ x: 0, y: 0 });

  return (
    <div
      onPointerMove={(e) => {
        const w = window.innerWidth;
        const h = window.innerHeight;
        mouse.current.x = (e.clientX / w) * 2 - 1;
        mouse.current.y = (e.clientY / h) * 2 - 1;
      }}
      style={{ position: "absolute", inset: 0 }}
    >
      <Canvas
        camera={{ position: [0, 0, 7], fov: 45 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
      >
        <ambientLight intensity={0.4} />
        <pointLight position={[5, 5, 5]} intensity={0.6} />
        <Rig nodes={nodes} edges={edges} mouse={mouse} />
        <EffectComposer>
          <Bloom
            luminanceThreshold={0.6}
            luminanceSmoothing={0.6}
            intensity={0.9}
            mipmapBlur
          />
        </EffectComposer>
      </Canvas>
    </div>
  );
}
