import * as THREE from 'three';
import {
  BoostZone,
  CheckpointGate,
  CoinItem,
  ColliderQuad,
  GroundTheme,
  JumpPadZone,
  LevelDefinition,
  MovingObstacle,
  SceneryStyle,
  SpeedRingItem,
  TrackQueryTarget,
} from './types';

const _coinBob = new THREE.Vector3();
const _coinDummy = new THREE.Object3D();

export interface TrackStartPose {
  position: THREE.Vector3;
  forward: THREE.Vector3;
  up: THREE.Vector3;
  right: THREE.Vector3;
}

export interface BuildTrackOptions {
  startPose?: TrackStartPose;
  includeFinishGate?: boolean;
  startCheckpointIndex?: number;
}

interface FrameSample {
  pos: THREE.Vector3;
  forward: THREE.Vector3;
  up: THREE.Vector3;
  right: THREE.Vector3;
  width: number;
  isLoop: boolean;
  splitGap?: number;
  wallHeight?: number;
}

export interface BuiltTrack extends TrackQueryTarget {
  group: THREE.Group;
  colliderHash: SpatialQuadHash;
  boostZones: BoostZone[];
  jumpPads: JumpPadZone[];
  checkpoints: CheckpointGate[];
  coins: CoinItem[];
  rings: SpeedRingItem[];
  markCoinCollected: (index: number) => void;
  resetCoins: () => void;
  markRingCollected: (index: number) => void;
  resetRings: () => void;
  obstacles: MovingObstacle[];
  spawnPoint: {
    position: THREE.Vector3;
    forward: THREE.Vector3;
    up: THREE.Vector3;
  };
  endPose: TrackStartPose;
  gripMultiplier: number;
  update: (elapsed: number) => void;
  dispose: () => void;
}

export class SpatialQuadHash {
  private readonly cellSize = 18;
  private readonly buckets = new Map<string, ColliderQuad[]>();
  private readonly seenSet = new Set<ColliderQuad>();

  public insert(quad: ColliderQuad): void {
    const minX = Math.min(quad.a.x, quad.b.x, quad.c.x, quad.d.x) - 1;
    const maxX = Math.max(quad.a.x, quad.b.x, quad.c.x, quad.d.x) + 1;
    const minZ = Math.min(quad.a.z, quad.b.z, quad.c.z, quad.d.z) - 1;
    const maxZ = Math.max(quad.a.z, quad.b.z, quad.c.z, quad.d.z) + 1;

    const cx0 = Math.floor(minX / this.cellSize);
    const cx1 = Math.floor(maxX / this.cellSize);
    const cz0 = Math.floor(minZ / this.cellSize);
    const cz1 = Math.floor(maxZ / this.cellSize);

    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const key = `${cx},${cz}`;
        let list = this.buckets.get(key);
        if (!list) {
          list = [];
          this.buckets.set(key, list);
        }
        list.push(quad);
      }
    }
  }

  public query(x: number, z: number, out: ColliderQuad[]): void {
    out.length = 0;
    const cx = Math.floor(x / this.cellSize);
    const cz = Math.floor(z / this.cellSize);
    const seen = this.seenSet;
    seen.clear();

    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const list = this.buckets.get(`${cx + dx},${cz + dz}`);
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const q = list[i];
          if (!seen.has(q)) {
            seen.add(q);
            out.push(q);
          }
        }
      }
    }
  }
}

function getGroundSpecs(theme: GroundTheme): {
  baseColor: string;
  roughness: number;
  metalness: number;
  gripMultiplier: number;
} {
  switch (theme) {
    case 'hex-plasma':
      return { baseColor: '#0e071a', roughness: 0.34, metalness: 0.55, gripMultiplier: 1.0 };
    case 'circuit-trace':
      return { baseColor: '#070c14', roughness: 0.38, metalness: 0.62, gripMultiplier: 1.02 };
    case 'holo-glass':
      return { baseColor: '#04121a', roughness: 0.16, metalness: 0.78, gripMultiplier: 0.94 };
    case 'solar-sand':
      return { baseColor: '#191007', roughness: 0.72, metalness: 0.22, gripMultiplier: 0.96 };
    case 'cryo-ice':
      return { baseColor: '#071a2b', roughness: 0.14, metalness: 0.65, gripMultiplier: 0.76 };
    case 'cyber-grid':
    default:
      return { baseColor: '#090b14', roughness: 0.42, metalness: 0.45, gripMultiplier: 1.05 };
  }
}

function createRoadTexture(
  theme: GroundTheme,
  accentHex: string,
  secondaryHex: string,
  maxAnisotropy: number,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const specs = getGroundSpecs(theme);

  ctx.fillStyle = specs.baseColor;
  ctx.fillRect(0, 0, 512, 512);

  if (theme === 'hex-plasma') {
    ctx.strokeStyle = 'rgba(157, 0, 255, 0.22)';
    ctx.lineWidth = 2;
    const r = 32;
    const dx = r * 1.5;
    const dy = r * Math.sqrt(3);
    for (let row = -1; row < 12; row++) {
      for (let col = -1; col < 12; col++) {
        const cx = col * dx;
        const cy = row * dy + (col % 2 === 0 ? 0 : dy * 0.5);
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const ang = (Math.PI / 3) * k;
          const vx = cx + r * Math.cos(ang);
          const vy = cy + r * Math.sin(ang);
          if (k === 0) ctx.moveTo(vx, vy);
          else ctx.lineTo(vx, vy);
        }
        ctx.closePath();
        ctx.stroke();
      }
    }
  } else if (theme === 'circuit-trace') {
    ctx.strokeStyle = 'rgba(255, 0, 127, 0.16)';
    ctx.lineWidth = 3;
    for (let x = 48; x < 512; x += 64) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 190);
      ctx.lineTo(x + 24, 240);
      ctx.lineTo(x + 24, 512);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 170, 0, 0.28)';
      ctx.beginPath();
      ctx.arc(x, 190, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (theme === 'holo-glass') {
    ctx.strokeStyle = 'rgba(57, 255, 20, 0.18)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 512; i += 64) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 512);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(512, i);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(0, 243, 255, 0.12)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(512, 512);
    ctx.moveTo(512, 0);
    ctx.lineTo(0, 512);
    ctx.stroke();
  } else if (theme === 'solar-sand') {
    // Ribbed canyon sandstone stripes & warm chevron markings
    for (let y = 0; y < 512; y += 32) {
      ctx.fillStyle = y % 64 === 0 ? 'rgba(255, 170, 0, 0.08)' : 'rgba(255, 90, 0, 0.04)';
      ctx.fillRect(0, y, 512, 16);
    }
    ctx.strokeStyle = 'rgba(255, 170, 0, 0.18)';
    ctx.lineWidth = 3;
    ctx.strokeRect(24, 0, 464, 512);
  } else if (theme === 'cryo-ice') {
    // Glacial crystalline facets & frost veins
    ctx.strokeStyle = 'rgba(186, 230, 253, 0.22)';
    ctx.lineWidth = 2;
    for (let y = 0; y < 512; y += 96) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(160, y + 36);
      ctx.lineTo(340, y - 18);
      ctx.lineTo(512, y + 24);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(56, 189, 248, 0.09)';
    ctx.fillRect(32, 0, 448, 512);
  } else {
    // Default cyber-grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 512; i += 64) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 512);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(512, i);
      ctx.stroke();
    }
  }

  // Dual neon edge lanes
  ctx.fillStyle = accentHex;
  ctx.globalAlpha = 0.34;
  ctx.fillRect(10, 0, 14, 512);
  ctx.fillStyle = secondaryHex;
  ctx.fillRect(488, 0, 14, 512);

  // Center dashed guide line
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = '#e2e8f0';
  for (let y = 24; y < 512; y += 128) {
    ctx.fillRect(252, y, 8, 64);
  }
  ctx.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function createBoostTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#03131c';
  ctx.fillRect(0, 0, 256, 256);

  // Glowing cyan/green chevrons pointing toward -V (forward)
  for (let row = 0; row < 3; row++) {
    const y = 42 + row * 78;
    ctx.strokeStyle = row === 1 ? '#39ff14' : '#00f3ff';
    ctx.lineWidth = 18;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(38, y + 44);
    ctx.lineTo(128, y);
    ctx.lineTo(218, y + 44);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function createFinishTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const size = 32;
  for (let y = 0; y < 128; y += size) {
    for (let x = 0; x < 256; x += size) {
      const even = ((x / size) + (y / size)) % 2 === 0;
      ctx.fillStyle = even ? '#39ff14' : '#071219';
      ctx.fillRect(x, y, size, size);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function distToSegmentSq(
  p: THREE.Vector3,
  a: THREE.Vector3,
  b: THREE.Vector3,
  closestOut: THREE.Vector3,
): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const lenSq = abx * abx + aby * aby + abz * abz;
  if (lenSq < 1e-6) {
    closestOut.copy(a);
    return p.distanceToSquared(a);
  }
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / lenSq),
  );
  closestOut.set(a.x + abx * t, a.y + aby * t, a.z + abz * t);
  return p.distanceToSquared(closestOut);
}

export function buildTrack(
  level: LevelDefinition,
  maxAnisotropy = 4,
  options: BuildTrackOptions = {},
): BuiltTrack {
  const group = new THREE.Group();
  const colliderHash = new SpatialQuadHash();
  const boostZones: BoostZone[] = [];
  const jumpPads: JumpPadZone[] = [];
  const checkpoints: CheckpointGate[] = [];
  const coins: CoinItem[] = [];
  const rings: SpeedRingItem[] = [];
  const ringMeshes: THREE.Mesh[] = [];
  const obstacles: MovingObstacle[] = [];

  const disposables: { dispose: () => void }[] = [];

  const groundSpecs = getGroundSpecs(level.groundTheme);
  const roadTex = createRoadTexture(
    level.groundTheme,
    level.accentColor,
    level.secondaryColor,
    maxAnisotropy,
  );
  const boostTex = createBoostTexture(maxAnisotropy);
  const finishTex = createFinishTexture(maxAnisotropy);
  disposables.push(roadTex, boostTex, finishTex);

  const deckMaterial = new THREE.MeshStandardMaterial({
    map: roadTex,
    roughness: groundSpecs.roughness,
    metalness: groundSpecs.metalness,
  });
  const sideHullMaterial = new THREE.MeshStandardMaterial({
    color: 0x0d101d,
    roughness: 0.55,
    metalness: 0.72,
  });
  const railPrimaryMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(level.accentColor),
    emissive: new THREE.Color(level.accentColor),
    emissiveIntensity: 2.2,
    roughness: 0.25,
    metalness: 0.5,
  });
  const railSecondaryMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(level.secondaryColor),
    emissive: new THREE.Color(level.secondaryColor),
    emissiveIntensity: 2.0,
    roughness: 0.25,
    metalness: 0.5,
  });
  const boostMat = new THREE.MeshStandardMaterial({
    map: boostTex,
    emissiveMap: boostTex,
    emissive: new THREE.Color(0x00f3ff),
    emissiveIntensity: 2.4,
    roughness: 0.2,
    metalness: 0.3,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const jumpPadMat = new THREE.MeshStandardMaterial({
    color: 0x39ff14,
    emissive: 0x39ff14,
    emissiveIntensity: 2.8,
    roughness: 0.2,
    metalness: 0.4,
  });
  const ringMat = new THREE.MeshStandardMaterial({
    color: 0x00f3ff,
    emissive: 0x00f3ff,
    emissiveIntensity: 3.1,
    roughness: 0.15,
    metalness: 0.6,
  });
  const coinGeo = new THREE.CylinderGeometry(0.95, 0.95, 0.24, 14);
  coinGeo.rotateX(Math.PI / 2);
  const coinMat = new THREE.MeshStandardMaterial({
    color: 0xffd166,
    emissive: 0xffaa00,
    emissiveIntensity: 2.3,
    metalness: 0.85,
    roughness: 0.2,
  });

  // Shared materials for checkpoints, obstacles & scenery (cuts shader/material bloat)
  const cpFrameMat = new THREE.MeshStandardMaterial({
    color: 0x111827,
    metalness: 0.85,
    roughness: 0.25,
  });
  const obsHullMat = new THREE.MeshStandardMaterial({
    color: 0x161b2e,
    metalness: 0.85,
    roughness: 0.24,
  });
  const obsLaserMat = new THREE.MeshStandardMaterial({
    color: 0xff1e56,
    emissive: 0xff0055,
    emissiveIntensity: 3.4,
    roughness: 0.15,
  });
  const obsHammerGlowMat = new THREE.MeshStandardMaterial({
    color: 0xffaa00,
    emissive: 0xff6600,
    emissiveIntensity: 2.8,
    roughness: 0.2,
  });
  const obsBarrierGlowMat = new THREE.MeshStandardMaterial({
    color: 0xff2a55,
    emissive: 0xff0055,
    emissiveIntensity: 2.8,
    roughness: 0.2,
  });
  const obsSpinnerGlowMat = new THREE.MeshStandardMaterial({
    color: 0x00f3ff,
    emissive: 0x00f3ff,
    emissiveIntensity: 3.1,
    roughness: 0.15,
  });
  const obsSpikeGlowMat = new THREE.MeshStandardMaterial({
    color: 0xff4500,
    emissive: 0xff2a00,
    emissiveIntensity: 3.2,
    roughness: 0.18,
  });
  const obsSawGlowMat = new THREE.MeshStandardMaterial({
    color: 0xff00aa,
    emissive: 0xff00aa,
    emissiveIntensity: 3.3,
    roughness: 0.15,
  });

  const ringGeo = new THREE.TorusGeometry(4.1, 0.26, 8, 22);
  const jumpPadGeo = new THREE.CylinderGeometry(2.5, 2.85, 0.26, 8);

  disposables.push(
    deckMaterial,
    sideHullMaterial,
    railPrimaryMat,
    railSecondaryMat,
    boostMat,
    jumpPadMat,
    ringMat,
    ringGeo,
    jumpPadGeo,
    coinGeo,
    coinMat,
    cpFrameMat,
    obsHullMat,
    obsLaserMat,
    obsHammerGlowMat,
    obsBarrierGlowMat,
    obsSpinnerGlowMat,
    obsSpikeGlowMat,
    obsSawGlowMat,
  );

  // Cursor state: starts at origin facing -Z or chained from options.startPose
  const curPos = options.startPose ? options.startPose.position.clone() : new THREE.Vector3(0, 0, 0);
  const curForward = options.startPose
    ? options.startPose.forward.clone().normalize()
    : new THREE.Vector3(0, 0, -1);
  const curUp = options.startPose
    ? options.startPose.up.clone().normalize()
    : new THREE.Vector3(0, 1, 0);
  const curRight = options.startPose
    ? options.startPose.right.clone().normalize()
    : new THREE.Vector3(1, 0, 0);

  const spawnPoint = {
    position: curPos.clone().addScaledVector(curForward, 10).addScaledVector(curUp, 0.85),
    forward: curForward.clone(),
    up: curUp.clone(),
  };

  // Track sections (contiguous strips separated by jump gaps)
  const sections: FrameSample[][] = [];
  let activeSection: FrameSample[] = [];
  const boostPadTransforms: THREE.Matrix4[] = [];
  const sceneryArchTransforms: THREE.Matrix4[] = [];
  const sceneryPylonTransforms: THREE.Matrix4[] = [];
  const sceneryChevronTransforms: THREE.Matrix4[] = [];

  const pushSample = (
    p: THREE.Vector3,
    f: THREE.Vector3,
    u: THREE.Vector3,
    r: THREE.Vector3,
    w: number,
    isLoop: boolean,
    splitGap = 0,
    wallHeight = 0,
  ) => {
    activeSection.push({
      pos: p.clone(),
      forward: f.clone().normalize(),
      up: u.clone().normalize(),
      right: r.clone().normalize(),
      width: w,
      isLoop,
      splitGap,
      wallHeight,
    });
  };

  const sampleAtT = (samples: FrameSample[], t: number): FrameSample => {
    const idx = Math.min(samples.length - 1, Math.max(0, Math.floor(t * (samples.length - 1))));
    return samples[idx];
  };

  const addBoostPadAt = (sample: FrameSample, lateralRatio = 0) => {
    const padWidth = Math.min(sample.width * 0.42, 5.8);
    const padLen = 10;
    const padPos = sample.pos
      .clone()
      .addScaledVector(sample.up, 0.05)
      .addScaledVector(sample.right, sample.width * lateralRatio);
    const basis = new THREE.Matrix4().makeBasis(
      sample.right,
      sample.up,
      sample.forward.clone().negate(),
    );
    basis.scale(new THREE.Vector3(padWidth, 1, padLen));
    basis.setPosition(padPos);
    boostPadTransforms.push(basis);

    boostZones.push({
      center: padPos.clone().addScaledVector(sample.up, 0.45),
      forward: sample.forward.clone(),
      normal: sample.up.clone(),
      radius: Math.max(4.5, padWidth * 0.72),
    });
  };

  const addJumpPadAt = (
    sample: FrameSample,
    cfg: { laneRatio?: number; impulse?: number },
  ) => {
    const padPos = sample.pos
      .clone()
      .addScaledVector(sample.up, 0.14)
      .addScaledVector(sample.right, sample.width * (cfg.laneRatio ?? 0));
    const basis = new THREE.Matrix4().makeBasis(
      sample.right,
      sample.up,
      sample.forward.clone().negate(),
    );
    const mesh = new THREE.Mesh(jumpPadGeo, jumpPadMat);
    mesh.quaternion.setFromRotationMatrix(basis);
    mesh.position.copy(padPos);
    group.add(mesh);

    jumpPads.push({
      center: padPos.clone().addScaledVector(sample.up, 0.4),
      forward: sample.forward.clone(),
      up: sample.up.clone(),
      radius: 3.4,
      impulse: cfg.impulse ?? 24,
    });
  };

  const addSpeedRingAt = (
    sample: FrameSample,
    cfg: { height?: number; laneRatio?: number },
  ) => {
    const h = cfg.height ?? 4.6;
    const ringPos = sample.pos
      .clone()
      .addScaledVector(sample.up, h)
      .addScaledVector(sample.right, sample.width * (cfg.laneRatio ?? 0));
    const basis = new THREE.Matrix4().makeBasis(
      sample.right,
      sample.up,
      sample.forward.clone().negate(),
    );
    const mesh = new THREE.Mesh(ringGeo, ringMat);
    mesh.quaternion.setFromRotationMatrix(basis);
    mesh.position.copy(ringPos);
    group.add(mesh);
    ringMeshes.push(mesh);

    rings.push({
      index: rings.length,
      center: ringPos,
      forward: sample.forward.clone(),
      radius: 4.9,
      collected: false,
    });
  };

  let coinPhaseCounter = 0;
  const addCoinAt = (pos: THREE.Vector3, up: THREE.Vector3) => {
    const index = coins.length;
    coins.push({
      index,
      basePosition: pos.clone(),
      up: up.clone().normalize(),
      collected: false,
      phase: coinPhaseCounter++ * 0.65,
    });
  };

  const addCoinRowAt = (
    samples: FrameSample[],
    tStart: number,
    tEnd: number,
    count: number,
    arcHeight = 0,
    lateralRatio = 0,
  ) => {
    if (samples.length < 2 || count <= 0) return;
    for (let i = 0; i < count; i++) {
      const frac = count === 1 ? 0.5 : i / (count - 1);
      const t = tStart + (tEnd - tStart) * frac;
      const sample = sampleAtT(samples, t);
      const lift = 1.35 + arcHeight * Math.sin(Math.PI * frac);
      const pos = sample.pos
        .clone()
        .addScaledVector(sample.up, lift)
        .addScaledVector(sample.right, sample.width * lateralRatio);
      addCoinAt(pos, sample.up);
    }
  };

  const addJumpArcCoins = (
    startPos: THREE.Vector3,
    forward: THREE.Vector3,
    up: THREE.Vector3,
    gapForward: number,
    dropY: number,
    count: number,
  ) => {
    const peakLift = Math.max(4.5, Math.abs(dropY) * 0.45 + 3.5);
    for (let i = 0; i < count; i++) {
      const frac = (i + 1) / (count + 1);
      const yOffset = dropY * frac + peakLift * Math.sin(Math.PI * frac) + 1.8;
      const pos = startPos
        .clone()
        .addScaledVector(forward, gapForward * frac)
        .addScaledVector(up, yOffset);
      addCoinAt(pos, up);
    }
  };

  const addCheckpointGateAt = (sample: FrameSample, index: number) => {
    const gateGroup = new THREE.Group();
    const basis = new THREE.Matrix4().makeBasis(
      sample.right,
      sample.up,
      sample.forward.clone().negate(),
    );
    gateGroup.quaternion.setFromRotationMatrix(basis);
    gateGroup.position.copy(sample.pos);

    const halfW = sample.width * 0.5 + 0.6;
    const pillarGeo = new THREE.BoxGeometry(0.85, 8.5, 1.1);
    const headerGeo = new THREE.BoxGeometry(halfW * 2 + 1.2, 0.85, 1.2);
    const holoGeo = new THREE.PlaneGeometry(halfW * 2 - 0.8, 0.45);
    disposables.push(pillarGeo, headerGeo, holoGeo);

    const glowMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(level.secondaryColor),
      emissive: new THREE.Color(level.secondaryColor),
      emissiveIntensity: 2.5,
      roughness: 0.2,
    });
    disposables.push(glowMat);

    const leftPillar = new THREE.Mesh(pillarGeo, cpFrameMat);
    leftPillar.position.set(-halfW, 4.25, 0);
    const rightPillar = new THREE.Mesh(pillarGeo, cpFrameMat);
    rightPillar.position.set(halfW, 4.25, 0);
    const header = new THREE.Mesh(headerGeo, cpFrameMat);
    header.position.set(0, 8.5, 0);

    const stripLeft = new THREE.Mesh(new THREE.BoxGeometry(0.32, 8.2, 1.25), glowMat);
    stripLeft.position.set(-halfW, 4.1, 0);
    const stripRight = new THREE.Mesh(new THREE.BoxGeometry(0.32, 8.2, 1.25), glowMat);
    stripRight.position.set(halfW, 4.1, 0);
    const stripTop = new THREE.Mesh(holoGeo, glowMat);
    stripTop.position.set(0, 8.1, 0);
    disposables.push(stripLeft.geometry, stripRight.geometry);

    gateGroup.add(leftPillar, rightPillar, header, stripLeft, stripRight, stripTop);
    group.add(gateGroup);

    checkpoints.push({
      index,
      position: sample.pos.clone(),
      forward: sample.forward.clone(),
      up: sample.up.clone(),
      right: sample.right.clone(),
      width: sample.width,
      activated: false,
      updateVisuals: (activated: boolean) => {
        const targetHex = activated ? 0x39ff14 : new THREE.Color(level.secondaryColor).getHex();
        glowMat.color.setHex(targetHex);
        glowMat.emissive.setHex(targetHex);
        glowMat.emissiveIntensity = activated ? 3.2 : 2.5;
      },
    });
  };

  const addLaserObstacleAt = (
    sample: FrameSample,
    cfg: { mode: 'sweep' | 'pulse'; speed?: number; phase?: number },
  ) => {
    const halfW = sample.width * 0.5;
    const speed = cfg.speed ?? 2.2;
    const phase = cfg.phase ?? 0;

    const emitterGeo = new THREE.CylinderGeometry(0.45, 0.55, 4.2, 8);
    disposables.push(emitterGeo);

    const basis = new THREE.Matrix4().makeBasis(
      sample.right,
      sample.up,
      sample.forward.clone().negate(),
    );

    const container = new THREE.Group();
    container.quaternion.setFromRotationMatrix(basis);
    container.position.copy(sample.pos);

    const leftPost = new THREE.Mesh(emitterGeo, obsHullMat);
    leftPost.position.set(-halfW - 0.3, 2.1, 0);
    const rightPost = new THREE.Mesh(emitterGeo, obsHullMat);
    rightPost.position.set(halfW + 0.3, 2.1, 0);
    container.add(leftPost, rightPost);

    if (cfg.mode === 'pulse') {
      // Horizontal laser bar moving vertically up and down
      const beamGeo = new THREE.CylinderGeometry(0.18, 0.18, sample.width + 0.4, 8);
      beamGeo.rotateZ(Math.PI / 2);
      disposables.push(beamGeo);

      const beam = new THREE.Mesh(beamGeo, obsLaserMat);
      beam.position.set(0, 1.4, 0);
      container.add(beam);

      const pA = new THREE.Vector3();
      const pB = new THREE.Vector3();
      const closest = new THREE.Vector3();

      obstacles.push({
        type: 'laser',
        update: (elapsed: number) => {
          const y = 1.85 + Math.sin(elapsed * speed + phase) * 1.45;
          beam.position.y = y;
          pA.set(-halfW, y, 0).applyMatrix4(container.matrixWorld);
          pB.set(halfW, y, 0).applyMatrix4(container.matrixWorld);
        },
        checkCollision: (carPos, carRadius, outPush) => {
          const dSq = distToSegmentSq(carPos, pA, pB, closest);
          const hitR = carRadius + 0.25;
          if (dSq < hitR * hitR) {
            outPush.copy(sample.forward).multiplyScalar(-1);
            return true;
          }
          return false;
        },
      });
    } else {
      // Sweeping vertical laser pylon sliding left <-> right
      const beamGeo = new THREE.CylinderGeometry(0.24, 0.24, 4.2, 8);
      disposables.push(beamGeo);
      const beam = new THREE.Mesh(beamGeo, obsLaserMat);
      beam.position.set(0, 2.1, 0);
      container.add(beam);

      const pA = new THREE.Vector3();
      const pB = new THREE.Vector3();
      const closest = new THREE.Vector3();

      obstacles.push({
        type: 'laser',
        update: (elapsed: number) => {
          const x = Math.sin(elapsed * speed + phase) * (halfW - 1.2);
          beam.position.x = x;
          pA.set(x, 0.2, 0).applyMatrix4(container.matrixWorld);
          pB.set(x, 4.0, 0).applyMatrix4(container.matrixWorld);
        },
        checkCollision: (carPos, carRadius, outPush) => {
          const dSq = distToSegmentSq(carPos, pA, pB, closest);
          const hitR = carRadius + 0.35;
          if (dSq < hitR * hitR) {
            outPush.copy(carPos).sub(closest).normalize();
            return true;
          }
          return false;
        },
      });
    }

    group.add(container);
    container.updateMatrixWorld(true);
  };

  const addHammerObstacleAt = (
    sample: FrameSample,
    cfg: { speed?: number; phase?: number },
  ) => {
    const halfW = sample.width * 0.5;
    const speed = cfg.speed ?? 2.4;
    const phase = cfg.phase ?? 0;

    const basis = new THREE.Matrix4().makeBasis(
      sample.right,
      sample.up,
      sample.forward.clone().negate(),
    );

    const container = new THREE.Group();
    container.quaternion.setFromRotationMatrix(basis);
    container.position.copy(sample.pos);

    const postGeo = new THREE.BoxGeometry(0.7, 10.5, 0.7);
    const topBarGeo = new THREE.BoxGeometry(sample.width + 2.2, 0.7, 0.9);
    const armGeo = new THREE.CylinderGeometry(0.18, 0.18, 7.6, 8);
    const headGeo = new THREE.CylinderGeometry(1.35, 1.35, 2.8, 8);
    headGeo.rotateX(Math.PI / 2);
    const ringGeo = new THREE.TorusGeometry(1.4, 0.14, 8, 16);
    disposables.push(postGeo, topBarGeo, armGeo, headGeo, ringGeo);

    const leftPost = new THREE.Mesh(postGeo, obsHullMat);
    leftPost.position.set(-halfW - 0.7, 5.25, 0);
    const rightPost = new THREE.Mesh(postGeo, obsHullMat);
    rightPost.position.set(halfW + 0.7, 5.25, 0);
    const topBar = new THREE.Mesh(topBarGeo, obsHullMat);
    topBar.position.set(0, 10.4, 0);
    container.add(leftPost, rightPost, topBar);

    const pivot = new THREE.Group();
    pivot.position.set(0, 10.2, 0);

    const arm = new THREE.Mesh(armGeo, obsHullMat);
    arm.position.set(0, -3.8, 0);
    const head = new THREE.Mesh(headGeo, obsHullMat);
    head.position.set(0, -7.8, 0);
    const ring = new THREE.Mesh(ringGeo, obsHammerGlowMat);
    ring.position.set(0, -7.8, 0);

    pivot.add(arm, head, ring);
    container.add(pivot);
    group.add(container);
    container.updateMatrixWorld(true);

    const worldHeadPos = new THREE.Vector3();

    obstacles.push({
      type: 'hammer',
      update: (elapsed: number) => {
        const angle = Math.sin(elapsed * speed + phase) * 0.92;
        pivot.rotation.z = angle;
        pivot.updateMatrixWorld(true);
        head.getWorldPosition(worldHeadPos);
      },
      checkCollision: (carPos, carRadius, outPush) => {
        const hitR = carRadius + 1.45;
        if (carPos.distanceToSquared(worldHeadPos) < hitR * hitR) {
          outPush.copy(carPos).sub(worldHeadPos).normalize();
          return true;
        }
        return false;
      },
    });
  };

  const addBarrierObstacleAt = (
    sample: FrameSample,
    cfg: { speed?: number; phase?: number },
  ) => {
    const halfW = sample.width * 0.5;
    const speed = cfg.speed ?? 1.9;
    const phase = cfg.phase ?? 0;

    const basis = new THREE.Matrix4().makeBasis(
      sample.right,
      sample.up,
      sample.forward.clone().negate(),
    );

    const container = new THREE.Group();
    container.quaternion.setFromRotationMatrix(basis);
    container.position.copy(sample.pos);

    const blockW = Math.max(4.5, sample.width * 0.26);
    const blockGeo = new THREE.BoxGeometry(blockW, 2.6, 1.4);
    const trimGeo = new THREE.BoxGeometry(blockW + 0.14, 0.24, 1.48);
    disposables.push(blockGeo, trimGeo);

    const leftGate = new THREE.Group();
    leftGate.position.set(-halfW + blockW * 0.5, 1.3, 0);
    leftGate.add(new THREE.Mesh(blockGeo, obsHullMat));
    const leftTrim = new THREE.Mesh(trimGeo, obsBarrierGlowMat);
    leftTrim.position.y = 1.25;
    leftGate.add(leftTrim);

    const rightGate = new THREE.Group();
    rightGate.position.set(halfW - blockW * 0.5, 1.3, 0);
    rightGate.add(new THREE.Mesh(blockGeo, obsHullMat));
    const rightTrim = new THREE.Mesh(trimGeo, obsBarrierGlowMat);
    rightTrim.position.y = 1.25;
    rightGate.add(rightTrim);

    container.add(leftGate, rightGate);
    group.add(container);
    container.updateMatrixWorld(true);

    const pL0 = new THREE.Vector3();
    const pL1 = new THREE.Vector3();
    const pR0 = new THREE.Vector3();
    const pR1 = new THREE.Vector3();
    const closest = new THREE.Vector3();

    obstacles.push({
      type: 'barrier',
      update: (elapsed: number) => {
        // Rhythmically opens center or pinches toward center leaving outer lanes clear
        const t = 0.5 + 0.5 * Math.sin(elapsed * speed + phase);
        const offset = THREE.MathUtils.lerp(halfW - blockW * 0.52, blockW * 0.56 + 1.4, t);
        leftGate.position.x = -offset;
        rightGate.position.x = offset;

        pL0.set(-offset - blockW * 0.48, 1.1, 0).applyMatrix4(container.matrixWorld);
        pL1.set(-offset + blockW * 0.48, 1.1, 0).applyMatrix4(container.matrixWorld);
        pR0.set(offset - blockW * 0.48, 1.1, 0).applyMatrix4(container.matrixWorld);
        pR1.set(offset + blockW * 0.48, 1.1, 0).applyMatrix4(container.matrixWorld);
      },
      checkCollision: (carPos, carRadius, outPush) => {
        const hitR = carRadius + 0.72;
        if (distToSegmentSq(carPos, pL0, pL1, closest) < hitR * hitR) {
          outPush.copy(carPos).sub(closest).normalize();
          return true;
        }
        if (distToSegmentSq(carPos, pR0, pR1, closest) < hitR * hitR) {
          outPush.copy(carPos).sub(closest).normalize();
          return true;
        }
        return false;
      },
    });
  };

  const addSpinnerObstacleAt = (
    sample: FrameSample,
    cfg: { speed?: number; phase?: number },
  ) => {
    const armHalf = Math.min(8.5, sample.width * 0.36);
    const speed = cfg.speed ?? 1.85;
    const phase = cfg.phase ?? 0;

    const basis = new THREE.Matrix4().makeBasis(
      sample.right,
      sample.up,
      sample.forward.clone().negate(),
    );

    const container = new THREE.Group();
    container.quaternion.setFromRotationMatrix(basis);
    container.position.copy(sample.pos);

    const hubGeo = new THREE.CylinderGeometry(1.1, 1.35, 2.4, 10);
    const bladeGeo = new THREE.CylinderGeometry(0.24, 0.24, armHalf * 2, 8);
    bladeGeo.rotateZ(Math.PI / 2);
    disposables.push(hubGeo, bladeGeo);

    const hub = new THREE.Mesh(hubGeo, obsHullMat);
    hub.position.y = 1.2;
    const rotor = new THREE.Group();
    rotor.position.y = 1.35;
    const blade = new THREE.Mesh(bladeGeo, obsSpinnerGlowMat);
    rotor.add(blade);

    container.add(hub, rotor);
    group.add(container);
    container.updateMatrixWorld(true);

    const pA = new THREE.Vector3();
    const pB = new THREE.Vector3();
    const closest = new THREE.Vector3();

    obstacles.push({
      type: 'spinner',
      update: (elapsed: number) => {
        const ang = elapsed * speed + phase;
        rotor.rotation.y = ang;
        rotor.updateMatrixWorld(true);
        pA.set(-armHalf, 0, 0).applyMatrix4(rotor.matrixWorld);
        pB.set(armHalf, 0, 0).applyMatrix4(rotor.matrixWorld);
      },
      checkCollision: (carPos, carRadius, outPush) => {
        const dSq = distToSegmentSq(carPos, pA, pB, closest);
        const hitR = carRadius + 0.45;
        if (dSq < hitR * hitR) {
          outPush.copy(carPos).sub(closest).normalize();
          return true;
        }
        return false;
      },
    });
  };

  const addSpikesObstacleAt = (
    sample: FrameSample,
    cfg: { speed?: number; phase?: number },
  ) => {
    const stripW = sample.width * 0.84;
    const speed = cfg.speed ?? 2.3;
    const phase = cfg.phase ?? 0;

    const basis = new THREE.Matrix4().makeBasis(
      sample.right,
      sample.up,
      sample.forward.clone().negate(),
    );
    const container = new THREE.Group();
    container.quaternion.setFromRotationMatrix(basis);
    container.position.copy(sample.pos);

    const plateGeo = new THREE.BoxGeometry(stripW, 0.22, 2.4);
    const spikeGeo = new THREE.ConeGeometry(0.48, 1.55, 4);
    disposables.push(plateGeo, spikeGeo);

    const plate = new THREE.Mesh(plateGeo, obsHullMat);
    plate.position.y = 0.08;
    container.add(plate);

    const spikeGroup = new THREE.Group();
    const spikeCount = 5;
    for (let i = 0; i < spikeCount; i++) {
      const frac = i / (spikeCount - 1) - 0.5;
      const spike = new THREE.Mesh(spikeGeo, obsSpikeGlowMat);
      spike.position.set(frac * (stripW - 2.2), 0.78, 0);
      spikeGroup.add(spike);
    }
    container.add(spikeGroup);
    group.add(container);
    container.updateMatrixWorld(true);

    const pA = new THREE.Vector3();
    const pB = new THREE.Vector3();
    const closest = new THREE.Vector3();
    let currentExtend = 0;

    obstacles.push({
      type: 'spikes',
      update: (elapsed: number) => {
        // Rhythmic extend/retract cycle
        const wave = Math.sin(elapsed * speed + phase);
        currentExtend = Math.max(0, wave);
        spikeGroup.position.y = -0.75 + currentExtend * 0.95;
        pA.set(-stripW * 0.48, 0.7, 0).applyMatrix4(container.matrixWorld);
        pB.set(stripW * 0.48, 0.7, 0).applyMatrix4(container.matrixWorld);
      },
      checkCollision: (carPos, carRadius, outPush) => {
        if (currentExtend < 0.35) return false;
        const dSq = distToSegmentSq(carPos, pA, pB, closest);
        const hitR = carRadius + 0.95;
        if (dSq < hitR * hitR) {
          outPush.copy(sample.up).multiplyScalar(1.2).addScaledVector(sample.forward, -0.6).normalize();
          return true;
        }
        return false;
      },
    });
  };

  const addCrusherObstacleAt = (
    sample: FrameSample,
    cfg: { speed?: number; phase?: number; laneRatio?: number },
  ) => {
    const halfW = sample.width * 0.5;
    const blockW = Math.min(8.5, sample.width * 0.38);
    const laneX = sample.width * (cfg.laneRatio ?? 0);
    const speed = cfg.speed ?? 2.1;
    const phase = cfg.phase ?? 0;

    const basis = new THREE.Matrix4().makeBasis(
      sample.right,
      sample.up,
      sample.forward.clone().negate(),
    );
    const container = new THREE.Group();
    container.quaternion.setFromRotationMatrix(basis);
    container.position.copy(sample.pos);

    const postGeo = new THREE.BoxGeometry(0.65, 8.2, 0.85);
    const topGeo = new THREE.BoxGeometry(sample.width + 1.8, 0.65, 1.1);
    const blockGeo = new THREE.BoxGeometry(blockW, 2.2, 2.4);
    const trimGeo = new THREE.BoxGeometry(blockW + 0.14, 0.3, 2.48);
    disposables.push(postGeo, topGeo, blockGeo, trimGeo);

    const leftPost = new THREE.Mesh(postGeo, obsHullMat);
    leftPost.position.set(-halfW - 0.5, 4.1, 0);
    const rightPost = new THREE.Mesh(postGeo, obsHullMat);
    rightPost.position.set(halfW + 0.5, 4.1, 0);
    const topBar = new THREE.Mesh(topGeo, obsHullMat);
    topBar.position.set(0, 8.1, 0);
    container.add(leftPost, rightPost, topBar);

    const hammer = new THREE.Group();
    hammer.position.set(laneX, 5.0, 0);
    hammer.add(new THREE.Mesh(blockGeo, obsHullMat));
    const glow = new THREE.Mesh(trimGeo, obsBarrierGlowMat);
    glow.position.y = -0.95;
    hammer.add(glow);
    container.add(hammer);

    group.add(container);
    container.updateMatrixWorld(true);

    const pA = new THREE.Vector3();
    const pB = new THREE.Vector3();
    const closest = new THREE.Vector3();
    let curY = 5.0;

    obstacles.push({
      type: 'crusher',
      update: (elapsed: number) => {
        const t = 0.5 + 0.5 * Math.cos(elapsed * speed + phase);
        curY = THREE.MathUtils.lerp(1.15, 5.4, Math.pow(t, 1.6));
        hammer.position.y = curY;
        pA.set(laneX - blockW * 0.45, curY - 0.4, 0).applyMatrix4(container.matrixWorld);
        pB.set(laneX + blockW * 0.45, curY - 0.4, 0).applyMatrix4(container.matrixWorld);
      },
      checkCollision: (carPos, carRadius, outPush) => {
        if (curY > 2.45) return false;
        const dSq = distToSegmentSq(carPos, pA, pB, closest);
        const hitR = carRadius + 1.05;
        if (dSq < hitR * hitR) {
          outPush.copy(carPos).sub(closest).normalize();
          return true;
        }
        return false;
      },
    });
  };

  const addSawObstacleAt = (
    sample: FrameSample,
    cfg: { speed?: number; phase?: number },
  ) => {
    const halfW = sample.width * 0.5;
    const speed = cfg.speed ?? 2.2;
    const phase = cfg.phase ?? 0;

    const basis = new THREE.Matrix4().makeBasis(
      sample.right,
      sample.up,
      sample.forward.clone().negate(),
    );
    const container = new THREE.Group();
    container.quaternion.setFromRotationMatrix(basis);
    container.position.copy(sample.pos);

    const railGeo = new THREE.BoxGeometry(sample.width - 0.8, 0.12, 0.35);
    const discGeo = new THREE.CylinderGeometry(1.75, 1.75, 0.24, 16);
    discGeo.rotateZ(Math.PI / 2);
    const rimGeo = new THREE.TorusGeometry(1.75, 0.14, 8, 20);
    rimGeo.rotateY(Math.PI / 2);
    disposables.push(railGeo, discGeo, rimGeo);

    const slot = new THREE.Mesh(railGeo, obsHullMat);
    slot.position.y = 0.06;
    container.add(slot);

    const sawGroup = new THREE.Group();
    sawGroup.position.y = 0.85;
    sawGroup.add(new THREE.Mesh(discGeo, obsHullMat), new THREE.Mesh(rimGeo, obsSawGlowMat));
    container.add(sawGroup);

    group.add(container);
    container.updateMatrixWorld(true);

    const worldPos = new THREE.Vector3();

    obstacles.push({
      type: 'saw',
      update: (elapsed: number) => {
        const x = Math.sin(elapsed * speed + phase) * (halfW - 1.8);
        sawGroup.position.x = x;
        sawGroup.rotation.x = elapsed * 10;
        sawGroup.getWorldPosition(worldPos);
      },
      checkCollision: (carPos, carRadius, outPush) => {
        const hitR = carRadius + 1.45;
        if (carPos.distanceToSquared(worldPos) < hitR * hitR) {
          outPush.copy(carPos).sub(worldPos).normalize();
          return true;
        }
        return false;
      },
    });
  };

  const addSceneryForPiece = (
    samples: FrameSample[],
    scenery: SceneryStyle,
  ) => {
    if (scenery === 'none' || samples.length < 4) return;
    const stepStride = scenery === 'chevrons' ? 8 : scenery === 'pylons' ? 10 : 12;
    for (let i = 3; i < samples.length - 3; i += stepStride) {
      const s = samples[i];
      const basis = new THREE.Matrix4().makeBasis(
        s.right,
        s.up,
        s.forward.clone().negate(),
      );
      if (scenery === 'arches') {
        const m = basis.clone();
        m.scale(new THREE.Vector3(s.width + 2.4, 1, 1));
        m.setPosition(s.pos.clone());
        sceneryArchTransforms.push(m);
      } else if (scenery === 'pylons') {
        for (const side of [-1, 1]) {
          const m = basis.clone();
          m.setPosition(
            s.pos
              .clone()
              .addScaledVector(s.right, side * (s.width * 0.5 + 3.2))
              .addScaledVector(s.up, 3.8),
          );
          sceneryPylonTransforms.push(m);
        }
      } else if (scenery === 'chevrons') {
        for (const side of [-1, 1]) {
          const m = basis.clone();
          m.setPosition(
            s.pos
              .clone()
              .addScaledVector(s.right, side * (s.width * 0.5 + 1.8))
              .addScaledVector(s.up, 2.2),
          );
          sceneryChevronTransforms.push(m);
        }
      }
    }
  };

  let checkpointCounter = options.startCheckpointIndex ?? 0;

  // Step through level pieces to construct spline frames and attach features
  for (const piece of level.pieces) {
    const w = piece.width ?? level.defaultWidth;

    if (piece.type === 'straight') {
      const steps = Math.max(4, Math.ceil(piece.length / 4));
      const pieceSamples: FrameSample[] = [];
      const elev = piece.elevation ?? 0;
      const roadStyle = piece.roadStyle ?? 'highway';
      const isWave = roadStyle === 'wave-deck';
      const isSplit = roadStyle === 'split-bridge';
      const wallH = roadStyle === 'canyon-trench' ? 1.65 : 0;
      const effW = roadStyle === 'narrow-beam' && !piece.width ? Math.min(16, w) : w;

      const startPos = curPos.clone();
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const baseY = elev * (3 * t * t - 2 * t * t * t);
        const waveEnv = Math.sin(Math.PI * t);
        const waveFreq = Math.PI * 4;
        const waveY = isWave ? Math.sin(t * waveFreq) * 3.4 * waveEnv : 0;

        const p = startPos
          .clone()
          .addScaledVector(curForward, piece.length * t)
          .addScaledVector(curUp, baseY + waveY);

        // Derivative pitch tangent for smooth elevation + wave transitions
        const dBaseDt = elev * (6 * t - 6 * t * t);
        const dWaveDt = isWave
          ? 3.4 *
            (waveFreq * Math.cos(t * waveFreq) * waveEnv +
              Math.sin(t * waveFreq) * Math.PI * Math.cos(Math.PI * t))
          : 0;
        const tangent = curForward
          .clone()
          .multiplyScalar(piece.length)
          .addScaledVector(curUp, dBaseDt + dWaveDt)
          .normalize();
        const up = curRight.clone().cross(tangent).normalize();
        const right = tangent.clone().cross(up).normalize();

        const splitGap = isSplit && t >= 0.12 && t <= 0.88 ? Math.min(7.2, effW * 0.28) : 0;

        if (i > 0 || activeSection.length === 0) {
          pushSample(p, tangent, up, right, effW, false, splitGap, wallH);
        }
        pieceSamples.push({
          pos: p.clone(),
          forward: tangent,
          up,
          right,
          width: effW,
          isLoop: false,
          splitGap,
          wallHeight: wallH,
        });
      }

      curPos.copy(pieceSamples[pieceSamples.length - 1].pos);
      curForward.copy(pieceSamples[pieceSamples.length - 1].forward);
      curUp.copy(pieceSamples[pieceSamples.length - 1].up);
      curRight.copy(pieceSamples[pieceSamples.length - 1].right);

      const resolvedScenery: SceneryStyle =
        piece.scenery ??
        (roadStyle === 'hyper-tube'
          ? 'arches'
          : roadStyle === 'narrow-beam'
            ? 'pylons'
            : 'none');
      addSceneryForPiece(pieceSamples, resolvedScenery);

      if (piece.boostPads) {
        for (const t of piece.boostPads) {
          const s = sampleAtT(pieceSamples, t);
          if (s.splitGap && s.splitGap > 0) {
            addBoostPadAt(s, -0.28);
            addBoostPadAt(s, 0.28);
          } else {
            addBoostPadAt(s, 0);
          }
        }
      }
      if (piece.jumpPads) {
        for (const jp of piece.jumpPads) {
          addJumpPadAt(sampleAtT(pieceSamples, jp.t), jp);
        }
      }
      if (piece.rings) {
        for (const rg of piece.rings) {
          addSpeedRingAt(sampleAtT(pieceSamples, rg.t), rg);
        }
      }
      if (piece.checkpoint) {
        addCheckpointGateAt(sampleAtT(pieceSamples, 0.22), checkpointCounter++);
      }
      if (piece.lasers) {
        for (const l of piece.lasers) {
          addLaserObstacleAt(sampleAtT(pieceSamples, l.t), l);
        }
      }
      if (piece.hammers) {
        for (const h of piece.hammers) {
          addHammerObstacleAt(sampleAtT(pieceSamples, h.t), h);
        }
      }
      if (piece.barriers) {
        for (const b of piece.barriers) {
          addBarrierObstacleAt(sampleAtT(pieceSamples, b.t), b);
        }
      }
      if (piece.spinners) {
        for (const sp of piece.spinners) {
          addSpinnerObstacleAt(sampleAtT(pieceSamples, sp.t), sp);
        }
      }
      if (piece.spikes) {
        for (const sk of piece.spikes) {
          addSpikesObstacleAt(sampleAtT(pieceSamples, sk.t), sk);
        }
      }
      if (piece.crushers) {
        for (const cr of piece.crushers) {
          addCrusherObstacleAt(sampleAtT(pieceSamples, cr.t), cr);
        }
      }
      if (piece.saws) {
        for (const sw of piece.saws) {
          addSawObstacleAt(sampleAtT(pieceSamples, sw.t), sw);
        }
      }
      if (piece.length >= 60) {
        const hasHazard = Boolean(
          (piece.lasers && piece.lasers.length) ||
            (piece.hammers && piece.hammers.length) ||
            (piece.barriers && piece.barriers.length) ||
            (piece.spinners && piece.spinners.length) ||
            (piece.spikes && piece.spikes.length) ||
            (piece.crushers && piece.crushers.length) ||
            (piece.saws && piece.saws.length),
        );
        const straightCoins = Math.min(8, Math.max(4, Math.floor(piece.length / 52)));
        const laneOffset = isSplit ? 0.28 : 0;
        if (!hasHazard) {
          addCoinRowAt(pieceSamples, 0.22, 0.8, straightCoins, 0, laneOffset);
          if (isSplit) {
            addCoinRowAt(pieceSamples, 0.22, 0.8, Math.ceil(straightCoins * 0.5), 0, -laneOffset);
          }
        } else {
          const halfCoins = Math.max(2, Math.floor(straightCoins * 0.5));
          addCoinRowAt(pieceSamples, 0.1, 0.24, halfCoins, 0, laneOffset);
          addCoinRowAt(pieceSamples, 0.78, 0.92, halfCoins, 0, -laneOffset);
        }
      }
    } else if (piece.type === 'curve') {
      const angleRad = THREE.MathUtils.degToRad(piece.angleDeg);
      const bankMax = THREE.MathUtils.degToRad(piece.bankDeg ?? 0);
      const arcLen = Math.abs(angleRad) * piece.radius;
      const steps = Math.max(12, Math.ceil(arcLen / 4));
      const sign = Math.sign(angleRad) || 1;
      const elev = piece.elevation ?? 0;

      // Flatten forward to XZ for clean horizon-aligned turning
      const baseForward = curForward.clone();
      baseForward.y = 0;
      baseForward.normalize();
      const baseUp = new THREE.Vector3(0, 1, 0);
      const baseRight = baseForward.clone().cross(baseUp).normalize();
      const turnCenter = curPos.clone().addScaledVector(baseRight, sign * piece.radius);

      const pieceSamples: FrameSample[] = [];
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const theta = angleRad * t;
        const rotQ = new THREE.Quaternion().setFromAxisAngle(baseUp, -theta);

        const radialOut = baseRight.clone().multiplyScalar(-sign * piece.radius).applyQuaternion(rotQ);
        const p = turnCenter.clone().add(radialOut);
        p.y += elev * (3 * t * t - 2 * t * t * t);

        const tangent = baseForward.clone().applyQuaternion(rotQ).normalize();
        const rightFlat = tangent.clone().cross(baseUp).normalize();

        // Smooth bell-curve bank into and out of the curve
        const bankAngle = bankMax * Math.sin(Math.PI * t);
        const bankQ = new THREE.Quaternion().setFromAxisAngle(tangent, bankAngle);
        const up = baseUp.clone().applyQuaternion(bankQ).normalize();
        const right = rightFlat.clone().applyQuaternion(bankQ).normalize();

        if (i > 0 || activeSection.length === 0) {
          pushSample(p, tangent, up, right, w, false);
        }
        pieceSamples.push({
          pos: p.clone(),
          forward: tangent,
          up,
          right,
          width: w,
          isLoop: false,
        });
      }

      const last = pieceSamples[pieceSamples.length - 1];
      curPos.copy(last.pos);
      curForward.copy(last.forward);
      curUp.copy(baseUp);
      curRight.copy(last.forward).cross(baseUp).normalize();

      if (piece.boostPads) {
        for (const t of piece.boostPads) {
          addBoostPadAt(sampleAtT(pieceSamples, t));
        }
      }
      if (piece.checkpoint) {
        addCheckpointGateAt(sampleAtT(pieceSamples, 0.2), checkpointCounter++);
      }
      if (Math.abs(piece.angleDeg) >= 45) {
        addCoinRowAt(pieceSamples, 0.28, 0.75, 4, 0, 0);
      }
    } else if (piece.type === 'ramp') {
      const steps = Math.max(10, Math.ceil(piece.length / 3));
      const lipRad = THREE.MathUtils.degToRad(piece.lipAngleDeg);
      const startPos = curPos.clone();
      const baseF = new THREE.Vector3(curForward.x, 0, curForward.z).normalize();
      const baseU = new THREE.Vector3(0, 1, 0);
      const baseR = baseF.clone().cross(baseU).normalize();

      const pieceSamples: FrameSample[] = [];
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const pitch = lipRad * (3 * t * t - 2 * t * t * t);
        const p = startPos
          .clone()
          .addScaledVector(baseF, piece.length * t)
          .addScaledVector(baseU, piece.height * (t * t));

        const tangent = baseF
          .clone()
          .multiplyScalar(Math.cos(pitch))
          .addScaledVector(baseU, Math.sin(pitch))
          .normalize();
        const up = baseR.clone().cross(tangent).normalize();

        if (i > 0 || activeSection.length === 0) {
          pushSample(p, tangent, up, baseR, w, false);
        }
        pieceSamples.push({
          pos: p.clone(),
          forward: tangent,
          up,
          right: baseR.clone(),
          width: w,
          isLoop: false,
        });
      }

      if (piece.boostPad) {
        addBoostPadAt(sampleAtT(pieceSamples, 0.45));
      }

      const last = pieceSamples[pieceSamples.length - 1];
      if (piece.gap) {
        // End current contiguous section and leap cursor across jump gap
        sections.push(activeSection);
        activeSection = [];

        const yawRad = THREE.MathUtils.degToRad(piece.gap.yawOffsetDeg ?? 0);
        const flatF = baseF.clone().applyAxisAngle(baseU, -yawRad).normalize();
        addJumpArcCoins(last.pos, flatF, baseU, piece.gap.forward, piece.gap.drop, 5);
        curPos
          .copy(last.pos)
          .addScaledVector(flatF, piece.gap.forward)
          .addScaledVector(baseU, piece.gap.drop);
        curForward.copy(flatF);
        curUp.copy(baseU);
        curRight.copy(curForward).cross(curUp).normalize();
      } else {
        addCoinRowAt(pieceSamples, 0.55, 0.85, 2, 0, 0);
        curPos.copy(last.pos);
        curForward.copy(baseF);
        curUp.copy(baseU);
        curRight.copy(baseR);
      }
    } else if (piece.type === 'loop') {
      const R = piece.radius;
      const sideShift = piece.corkscrewSide ?? w * 1.3;
      const steps = 56;

      const startPos = curPos.clone();
      const f0 = new THREE.Vector3(curForward.x, 0, curForward.z).normalize();
      const u0 = new THREE.Vector3(0, 1, 0);
      const r0 = f0.clone().cross(u0).normalize();

      const pieceSamples: FrameSample[] = [];

      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const theta = t * Math.PI * 2;
        const smoothS = 3 * t * t - 2 * t * t * t;

        const fwdDist = R * Math.sin(theta);
        const upDist = R * (1 - Math.cos(theta));
        const latDist = sideShift * smoothS;

        const p = startPos
          .clone()
          .addScaledVector(f0, fwdDist)
          .addScaledVector(u0, upDist)
          .addScaledVector(r0, latDist);

        // Derivative wrt theta for exact tangent
        const dFwd = 2 * Math.PI * R * Math.cos(theta);
        const dUp = 2 * Math.PI * R * Math.sin(theta);
        const dLat = sideShift * (6 * t - 6 * t * t);

        const tangent = f0
          .clone()
          .multiplyScalar(dFwd)
          .addScaledVector(u0, dUp)
          .addScaledVector(r0, dLat)
          .normalize();

        const radialInward = u0
          .clone()
          .multiplyScalar(Math.cos(theta))
          .addScaledVector(f0, -Math.sin(theta))
          .normalize();
        const right = tangent.clone().cross(radialInward).normalize();
        const up = right.clone().cross(tangent).normalize();

        if (i > 0 || activeSection.length === 0) {
          pushSample(p, tangent, up, right, w, true);
        }
        pieceSamples.push({
          pos: p.clone(),
          forward: tangent,
          up,
          right,
          width: w,
          isLoop: true,
        });
      }

      if (piece.boostEntry) {
        addBoostPadAt(sampleAtT(pieceSamples, 0.03));
      }

      const last = pieceSamples[pieceSamples.length - 1];
      curPos.copy(last.pos);
      curForward.copy(f0);
      curUp.copy(u0);
      curRight.copy(r0);

      if (piece.checkpointAfter) {
        addCheckpointGateAt(last, checkpointCounter++);
      }
      addCoinRowAt(pieceSamples, 0.38, 0.62, 3, 0, 0);
    }
  }

  if (activeSection.length > 0) {
    sections.push(activeSection);
  }

  const endPose: TrackStartPose = {
    position: curPos.clone(),
    forward: curForward.clone().normalize(),
    up: curUp.clone().normalize(),
    right: curRight.clone().normalize(),
  };

  // Build Finish Gate near end of final section (omitted on streaming Infinite chunks)
  const includeFinish = options.includeFinishGate !== false;
  let finishGate: { position: THREE.Vector3; forward: THREE.Vector3; width: number } | null = null;
  if (includeFinish) {
    const finalSec = sections[sections.length - 1];
    const finishSample = finalSec[Math.max(0, finalSec.length - 4)];
    const finishBasis = new THREE.Matrix4().makeBasis(
      finishSample.right,
      finishSample.up,
      finishSample.forward.clone().negate(),
    );
    const finishGroup = new THREE.Group();
    finishGroup.quaternion.setFromRotationMatrix(finishBasis);
    finishGroup.position.copy(finishSample.pos);

    const fHalfW = finishSample.width * 0.5 + 0.8;
    const fPillarGeo = new THREE.BoxGeometry(1.1, 10, 1.4);
    const fBannerGeo = new THREE.BoxGeometry(fHalfW * 2 + 1.4, 2.2, 0.8);
    const fMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      metalness: 0.85,
      roughness: 0.2,
    });
    const fBannerMat = new THREE.MeshStandardMaterial({
      map: finishTex,
      emissiveMap: finishTex,
      emissive: 0x39ff14,
      emissiveIntensity: 2.2,
      roughness: 0.3,
    });
    disposables.push(fPillarGeo, fBannerGeo, fMat, fBannerMat);

    const fLeft = new THREE.Mesh(fPillarGeo, fMat);
    fLeft.position.set(-fHalfW, 5, 0);
    const fRight = new THREE.Mesh(fPillarGeo, fMat);
    fRight.position.set(fHalfW, 5, 0);
    const fBanner = new THREE.Mesh(fBannerGeo, fBannerMat);
    fBanner.position.set(0, 9.2, 0);
    finishGroup.add(fLeft, fRight, fBanner);
    group.add(finishGroup);

    finishGate = {
      position: finishSample.pos.clone(),
      forward: finishSample.forward.clone(),
      width: finishSample.width,
    };
  }

  // Build unified BufferGeometries for deck, side hull, neon rails, and instanced support ribs
  const deckPos: number[] = [];
  const deckNorm: number[] = [];
  const deckUv: number[] = [];
  const deckIdx: number[] = [];

  const hullPos: number[] = [];
  const hullNorm: number[] = [];
  const hullIdx: number[] = [];

  const railLeftPts: THREE.Vector3[][] = [];
  const railRightPts: THREE.Vector3[][] = [];
  const ribTransforms: THREE.Matrix4[] = [];

  let vOffsetDeck = 0;
  let vOffsetHull = 0;
  const deckThickness = 1.15;

  const pushTri = (arr: number[], a: number, b: number, c: number) => {
    arr.push(a, b, c);
  };

  const pushDeckStrip = (
    lb: THREE.Vector3,
    rb: THREE.Vector3,
    rf: THREE.Vector3,
    lf: THREE.Vector3,
    up0: THREE.Vector3,
    up1: THREE.Vector3,
    right0: THREE.Vector3,
    right1: THREE.Vector3,
    fwd0: THREE.Vector3,
    fwd1: THREE.Vector3,
    uStart: number,
    uEnd: number,
    vStart: number,
    vEnd: number,
    isLoop: boolean,
    wallH0: number,
    wallH1: number,
  ) => {
    const base = vOffsetDeck;
    deckPos.push(lb.x, lb.y, lb.z, rb.x, rb.y, rb.z, rf.x, rf.y, rf.z, lf.x, lf.y, lf.z);
    deckNorm.push(
      up0.x, up0.y, up0.z,
      up0.x, up0.y, up0.z,
      up1.x, up1.y, up1.z,
      up1.x, up1.y, up1.z,
    );
    deckUv.push(uStart, vStart, uEnd, vStart, uEnd, vEnd, uStart, vEnd);
    pushTri(deckIdx, base, base + 1, base + 2);
    pushTri(deckIdx, base, base + 2, base + 3);
    vOffsetDeck += 4;

    const lbTop = wallH0 > 0 ? lb.clone().addScaledVector(up0, wallH0) : lb;
    const rbTop = wallH0 > 0 ? rb.clone().addScaledVector(up0, wallH0) : rb;
    const lfTop = wallH1 > 0 ? lf.clone().addScaledVector(up1, wallH1) : lf;
    const rfTop = wallH1 > 0 ? rf.clone().addScaledVector(up1, wallH1) : rf;

    const lbBot = lb.clone().addScaledVector(up0, -deckThickness);
    const rbBot = rb.clone().addScaledVector(up0, -deckThickness);
    const rfBot = rf.clone().addScaledVector(up1, -deckThickness);
    const lfBot = lf.clone().addScaledVector(up1, -deckThickness);

    const hBase = vOffsetHull;
    // Left wall (extended upward if canyon trench wallH > 0)
    hullPos.push(
      lbTop.x, lbTop.y, lbTop.z,
      lfTop.x, lfTop.y, lfTop.z,
      lfBot.x, lfBot.y, lfBot.z,
      lbBot.x, lbBot.y, lbBot.z,
    );
    hullNorm.push(
      -right0.x, -right0.y, -right0.z,
      -right1.x, -right1.y, -right1.z,
      -right1.x, -right1.y, -right1.z,
      -right0.x, -right0.y, -right0.z,
    );
    pushTri(hullIdx, hBase, hBase + 2, hBase + 1);
    pushTri(hullIdx, hBase, hBase + 3, hBase + 2);

    // Right wall
    hullPos.push(
      rbTop.x, rbTop.y, rbTop.z,
      rbBot.x, rbBot.y, rbBot.z,
      rfBot.x, rfBot.y, rfBot.z,
      rfTop.x, rfTop.y, rfTop.z,
    );
    hullNorm.push(
      right0.x, right0.y, right0.z,
      right0.x, right0.y, right0.z,
      right1.x, right1.y, right1.z,
      right1.x, right1.y, right1.z,
    );
    pushTri(hullIdx, hBase + 4, hBase + 5, hBase + 6);
    pushTri(hullIdx, hBase + 4, hBase + 6, hBase + 7);

    // Underside
    hullPos.push(
      lbBot.x, lbBot.y, lbBot.z,
      lfBot.x, lfBot.y, lfBot.z,
      rfBot.x, rfBot.y, rfBot.z,
      rbBot.x, rbBot.y, rbBot.z,
    );
    hullNorm.push(
      -up0.x, -up0.y, -up0.z,
      -up1.x, -up1.y, -up1.z,
      -up1.x, -up1.y, -up1.z,
      -up0.x, -up0.y, -up0.z,
    );
    pushTri(hullIdx, hBase + 8, hBase + 9, hBase + 10);
    pushTri(hullIdx, hBase + 8, hBase + 10, hBase + 11);
    vOffsetHull += 12;

    if (wallH0 > 0 || wallH1 > 0) {
      // Inner faces of trench walls so inside of canyon looks solid
      const iwBase = vOffsetHull;
      hullPos.push(
        lbTop.x, lbTop.y, lbTop.z,
        lb.x, lb.y, lb.z,
        lf.x, lf.y, lf.z,
        lfTop.x, lfTop.y, lfTop.z,
      );
      hullNorm.push(
        right0.x, right0.y, right0.z,
        right0.x, right0.y, right0.z,
        right1.x, right1.y, right1.z,
        right1.x, right1.y, right1.z,
      );
      pushTri(hullIdx, iwBase, iwBase + 1, iwBase + 2);
      pushTri(hullIdx, iwBase, iwBase + 2, iwBase + 3);

      hullPos.push(
        rbTop.x, rbTop.y, rbTop.z,
        rfTop.x, rfTop.y, rfTop.z,
        rf.x, rf.y, rf.z,
        rb.x, rb.y, rb.z,
      );
      hullNorm.push(
        -right0.x, -right0.y, -right0.z,
        -right1.x, -right1.y, -right1.z,
        -right1.x, -right1.y, -right1.z,
        -right0.x, -right0.y, -right0.z,
      );
      pushTri(hullIdx, iwBase + 4, iwBase + 5, iwBase + 6);
      pushTri(hullIdx, iwBase + 4, iwBase + 6, iwBase + 7);
      vOffsetHull += 8;
    }

    const a = lb.clone();
    const b = rb.clone();
    const c = rf.clone();
    const d = lf.clone();
    const center = new THREE.Vector3().add(a).add(b).add(c).add(d).multiplyScalar(0.25);
    const normal = new THREE.Vector3().addVectors(up0, up1).normalize();
    const tangent = new THREE.Vector3().addVectors(fwd0, fwd1).normalize();
    const right = new THREE.Vector3().addVectors(right0, right1).normalize();

    colliderHash.insert({
      a,
      b,
      c,
      d,
      center,
      normal,
      tangent,
      right,
      isLoop,
      isBoost: false,
    });
  };

  const vLB = new THREE.Vector3();
  const vRB = new THREE.Vector3();
  const vLF = new THREE.Vector3();
  const vRF = new THREE.Vector3();
  const vInLB = new THREE.Vector3();
  const vInRB = new THREE.Vector3();
  const vInLF = new THREE.Vector3();
  const vInRF = new THREE.Vector3();

  for (const sec of sections) {
    if (sec.length < 2) continue;
    const leftRail: THREE.Vector3[] = [];
    const rightRail: THREE.Vector3[] = [];
    let activeInnerLeft: THREE.Vector3[] = [];
    let activeInnerRight: THREE.Vector3[] = [];
    let runningDist = 0;

    for (let i = 0; i < sec.length - 1; i++) {
      const s0 = sec[i];
      const s1 = sec[i + 1];
      const segLen = s0.pos.distanceTo(s1.pos);
      const v0 = runningDist / 12;
      runningDist += segLen;
      const v1 = runningDist / 12;

      const hw0 = s0.width * 0.5;
      const hw1 = s1.width * 0.5;
      const wh0 = s0.wallHeight ?? 0;
      const wh1 = s1.wallHeight ?? 0;

      vLB.copy(s0.pos).addScaledVector(s0.right, -hw0);
      vRB.copy(s0.pos).addScaledVector(s0.right, hw0);
      vLF.copy(s1.pos).addScaledVector(s1.right, -hw1);
      vRF.copy(s1.pos).addScaledVector(s1.right, hw1);

      if (i === 0) {
        leftRail.push(vLB.clone().addScaledVector(s0.up, 0.35 + wh0));
        rightRail.push(vRB.clone().addScaledVector(s0.up, 0.35 + wh0));
      }
      leftRail.push(vLF.clone().addScaledVector(s1.up, 0.35 + wh1));
      rightRail.push(vRF.clone().addScaledVector(s1.up, 0.35 + wh1));

      const sg0 = s0.splitGap ?? 0;
      const sg1 = s1.splitGap ?? 0;
      const isLoopSeg = s0.isLoop || s1.isLoop;

      if (sg0 > 0 && sg1 > 0) {
        const hg0 = sg0 * 0.5;
        const hg1 = sg1 * 0.5;
        vInLB.copy(s0.pos).addScaledVector(s0.right, -hg0);
        vInRB.copy(s0.pos).addScaledVector(s0.right, hg0);
        vInLF.copy(s1.pos).addScaledVector(s1.right, -hg1);
        vInRF.copy(s1.pos).addScaledVector(s1.right, hg1);

        if (activeInnerLeft.length === 0) {
          activeInnerLeft.push(vInLB.clone().addScaledVector(s0.up, 0.32));
          activeInnerRight.push(vInRB.clone().addScaledVector(s0.up, 0.32));
        }
        activeInnerLeft.push(vInLF.clone().addScaledVector(s1.up, 0.32));
        activeInnerRight.push(vInRF.clone().addScaledVector(s1.up, 0.32));

        // Left lane deck
        pushDeckStrip(
          vLB, vInLB, vInLF, vLF,
          s0.up, s1.up, s0.right, s1.right, s0.forward, s1.forward,
          0, 0.38, v0, v1, isLoopSeg, wh0, wh1,
        );
        // Right lane deck
        pushDeckStrip(
          vInRB, vRB, vRF, vInRF,
          s0.up, s1.up, s0.right, s1.right, s0.forward, s1.forward,
          0.62, 1, v0, v1, isLoopSeg, wh0, wh1,
        );
      } else {
        if (activeInnerLeft.length >= 2) {
          railRightPts.push(activeInnerLeft);
          railLeftPts.push(activeInnerRight);
          activeInnerLeft = [];
          activeInnerRight = [];
        }
        pushDeckStrip(
          vLB, vRB, vRF, vLF,
          s0.up, s1.up, s0.right, s1.right, s0.forward, s1.forward,
          0, 1, v0, v1, isLoopSeg, wh0, wh1,
        );
      }

      // Collect structural under-deck ribs every 4th slice
      if (i % 4 === 0) {
        const m = new THREE.Matrix4().makeBasis(
          s0.right,
          s0.up,
          s0.forward.clone().negate(),
        );
        m.scale(new THREE.Vector3(s0.width + 1.2, 1, 1));
        m.setPosition(s0.pos.clone().addScaledVector(s0.up, -deckThickness - 0.35));
        ribTransforms.push(m);
      }
    }

    if (activeInnerLeft.length >= 2) {
      railRightPts.push(activeInnerLeft);
      railLeftPts.push(activeInnerRight);
    }
    railLeftPts.push(leftRail);
    railRightPts.push(rightRail);
  }

  const deckGeo = new THREE.BufferGeometry();
  deckGeo.setAttribute('position', new THREE.Float32BufferAttribute(deckPos, 3));
  deckGeo.setAttribute('normal', new THREE.Float32BufferAttribute(deckNorm, 3));
  deckGeo.setAttribute('uv', new THREE.Float32BufferAttribute(deckUv, 2));
  deckGeo.setIndex(deckIdx);
  disposables.push(deckGeo);
  const deckMesh = new THREE.Mesh(deckGeo, deckMaterial);
  deckMesh.receiveShadow = true;
  group.add(deckMesh);

  const hullGeo = new THREE.BufferGeometry();
  hullGeo.setAttribute('position', new THREE.Float32BufferAttribute(hullPos, 3));
  hullGeo.setAttribute('normal', new THREE.Float32BufferAttribute(hullNorm, 3));
  hullGeo.setIndex(hullIdx);
  disposables.push(hullGeo);
  const hullMesh = new THREE.Mesh(hullGeo, sideHullMaterial);
  group.add(hullMesh);

  // Neon side rails via TubeGeometry along each section
  for (let s = 0; s < railLeftPts.length; s++) {
    const lPts = railLeftPts[s];
    if (lPts.length >= 2) {
      const lCurve = new THREE.CatmullRomCurve3(lPts);
      const lGeo = new THREE.TubeGeometry(
        lCurve,
        Math.min(480, Math.max(24, Math.floor(lPts.length * 0.75))),
        0.22,
        5,
        false,
      );
      disposables.push(lGeo);
      group.add(new THREE.Mesh(lGeo, railPrimaryMat));
    }
  }
  for (let s = 0; s < railRightPts.length; s++) {
    const rPts = railRightPts[s];
    if (rPts.length >= 2) {
      const rCurve = new THREE.CatmullRomCurve3(rPts);
      const rGeo = new THREE.TubeGeometry(
        rCurve,
        Math.min(480, Math.max(24, Math.floor(rPts.length * 0.75))),
        0.22,
        5,
        false,
      );
      disposables.push(rGeo);
      group.add(new THREE.Mesh(rGeo, railSecondaryMat));
    }
  }

  // Instanced support ribs underneath track
  if (ribTransforms.length > 0) {
    const ribGeo = new THREE.BoxGeometry(1, 0.7, 0.9);
    const ribMesh = new THREE.InstancedMesh(ribGeo, sideHullMaterial, ribTransforms.length);
    for (let i = 0; i < ribTransforms.length; i++) {
      ribMesh.setMatrixAt(i, ribTransforms[i]);
    }
    ribMesh.instanceMatrix.needsUpdate = true;
    ribMesh.computeBoundingSphere();
    disposables.push(ribGeo);
    group.add(ribMesh);
  }

  // Instanced Roadside & Overhead Scenery Objects (arches, pylons, chevrons)
  if (sceneryArchTransforms.length > 0) {
    const topArchGeo = new THREE.BoxGeometry(1, 0.55, 0.85);
    topArchGeo.translate(0, 8.2, 0);
    const legGeo = new THREE.BoxGeometry(0.032, 8.2, 0.85);
    legGeo.translate(-0.5, 4.1, 0);
    const legGeoR = new THREE.BoxGeometry(0.032, 8.2, 0.85);
    legGeoR.translate(0.5, 4.1, 0);
    const archTopInst = new THREE.InstancedMesh(topArchGeo, railPrimaryMat, sceneryArchTransforms.length);
    const archLegLInst = new THREE.InstancedMesh(legGeo, sideHullMaterial, sceneryArchTransforms.length);
    const archLegRInst = new THREE.InstancedMesh(legGeoR, sideHullMaterial, sceneryArchTransforms.length);
    for (let i = 0; i < sceneryArchTransforms.length; i++) {
      archTopInst.setMatrixAt(i, sceneryArchTransforms[i]);
      archLegLInst.setMatrixAt(i, sceneryArchTransforms[i]);
      archLegRInst.setMatrixAt(i, sceneryArchTransforms[i]);
    }
    archTopInst.instanceMatrix.needsUpdate = true;
    archLegLInst.instanceMatrix.needsUpdate = true;
    archLegRInst.instanceMatrix.needsUpdate = true;
    archTopInst.computeBoundingSphere();
    archLegLInst.computeBoundingSphere();
    archLegRInst.computeBoundingSphere();
    disposables.push(topArchGeo, legGeo, legGeoR);
    group.add(archTopInst, archLegLInst, archLegRInst);
  }

  if (sceneryPylonTransforms.length > 0) {
    const pylonGeo = new THREE.OctahedronGeometry(1.15, 0);
    pylonGeo.scale(0.85, 3.2, 0.85);
    const pylonInst = new THREE.InstancedMesh(pylonGeo, railSecondaryMat, sceneryPylonTransforms.length);
    for (let i = 0; i < sceneryPylonTransforms.length; i++) {
      pylonInst.setMatrixAt(i, sceneryPylonTransforms[i]);
    }
    pylonInst.instanceMatrix.needsUpdate = true;
    pylonInst.computeBoundingSphere();
    disposables.push(pylonGeo);
    group.add(pylonInst);
  }

  if (sceneryChevronTransforms.length > 0) {
    const chevGeo = new THREE.BoxGeometry(0.32, 3.6, 0.9);
    chevGeo.rotateZ(0.28);
    const chevInst = new THREE.InstancedMesh(chevGeo, railPrimaryMat, sceneryChevronTransforms.length);
    for (let i = 0; i < sceneryChevronTransforms.length; i++) {
      chevInst.setMatrixAt(i, sceneryChevronTransforms[i]);
    }
    chevInst.instanceMatrix.needsUpdate = true;
    chevInst.computeBoundingSphere();
    disposables.push(chevGeo);
    group.add(chevInst);
  }

  // Instanced Boost Pads (1 draw call instead of N)
  if (boostPadTransforms.length > 0) {
    const padGeo = new THREE.PlaneGeometry(1, 1);
    padGeo.rotateX(-Math.PI / 2);
    const boostInstanced = new THREE.InstancedMesh(padGeo, boostMat, boostPadTransforms.length);
    for (let i = 0; i < boostPadTransforms.length; i++) {
      boostInstanced.setMatrixAt(i, boostPadTransforms[i]);
    }
    boostInstanced.instanceMatrix.needsUpdate = true;
    boostInstanced.computeBoundingSphere();
    disposables.push(padGeo);
    group.add(boostInstanced);
  }

  // Instanced Collectible Coins (1 draw call instead of 60-120)
  let coinInstanced: THREE.InstancedMesh | null = null;
  if (coins.length > 0) {
    coinInstanced = new THREE.InstancedMesh(coinGeo, coinMat, coins.length);
    coinInstanced.frustumCulled = false;
    for (let i = 0; i < coins.length; i++) {
      _coinDummy.position.copy(coins[i].basePosition);
      _coinDummy.rotation.set(0, coins[i].phase, 0);
      _coinDummy.scale.set(1, 1, 1);
      _coinDummy.updateMatrix();
      coinInstanced.setMatrixAt(i, _coinDummy.matrix);
    }
    coinInstanced.instanceMatrix.needsUpdate = true;
    group.add(coinInstanced);
  }

  const markCoinCollected = (index: number) => {
    const c = coins[index];
    if (!c || c.collected) return;
    c.collected = true;
    if (coinInstanced) {
      _coinDummy.position.copy(c.basePosition);
      _coinDummy.scale.set(0, 0, 0);
      _coinDummy.updateMatrix();
      coinInstanced.setMatrixAt(index, _coinDummy.matrix);
      coinInstanced.instanceMatrix.needsUpdate = true;
    }
  };

  const resetCoins = () => {
    for (let i = 0; i < coins.length; i++) {
      const c = coins[i];
      c.collected = false;
      if (coinInstanced) {
        _coinDummy.position.copy(c.basePosition);
        _coinDummy.rotation.set(0, c.phase, 0);
        _coinDummy.scale.set(1, 1, 1);
        _coinDummy.updateMatrix();
        coinInstanced.setMatrixAt(i, _coinDummy.matrix);
      }
    }
    if (coinInstanced) {
      coinInstanced.instanceMatrix.needsUpdate = true;
    }
  };

  const markRingCollected = (index: number) => {
    const r = rings[index];
    if (!r || r.collected) return;
    r.collected = true;
    if (ringMeshes[index]) {
      ringMeshes[index].visible = false;
    }
  };

  const resetRings = () => {
    for (let i = 0; i < rings.length; i++) {
      rings[i].collected = false;
      if (ringMeshes[i]) {
        ringMeshes[i].visible = true;
      }
    }
  };

  return {
    group,
    colliderHash,
    boostZones,
    jumpPads,
    checkpoints,
    coins,
    rings,
    markCoinCollected,
    resetCoins,
    markRingCollected,
    resetRings,
    finishGate,
    obstacles,
    spawnPoint,
    endPose,
    gripMultiplier: groundSpecs.gripMultiplier,
    queryQuads: (x, z, out) => colliderHash.query(x, z, out),
    getGripAt: () => groundSpecs.gripMultiplier,
    forEachBoostZone: (fn) => {
      for (let i = 0; i < boostZones.length; i++) fn(boostZones[i]);
    },
    forEachJumpPad: (fn) => {
      for (let i = 0; i < jumpPads.length; i++) fn(jumpPads[i]);
    },
    forEachObstacle: (fn) => {
      for (let i = 0; i < obstacles.length; i++) fn(obstacles[i]);
    },
    forEachCheckpoint: (fn) => {
      for (let i = 0; i < checkpoints.length; i++) fn(checkpoints[i]);
    },
    forEachCoin: (fn) => {
      for (let i = 0; i < coins.length; i++) {
        fn(coins[i], () => markCoinCollected(i));
      }
    },
    forEachRing: (fn) => {
      for (let i = 0; i < rings.length; i++) {
        fn(rings[i], () => markRingCollected(i));
      }
    },
    update: (elapsed: number) => {
      boostTex.offset.y = -(elapsed * 2.2) % 1;
      for (let i = 0; i < obstacles.length; i++) {
        obstacles[i].update(elapsed);
      }
      for (let i = 0; i < ringMeshes.length; i++) {
        if (!rings[i].collected) {
          ringMeshes[i].rotation.z = elapsed * 1.6 + i * 0.7;
        }
      }
      if (coinInstanced && coins.length > 0) {
        let anyActive = false;
        for (let i = 0; i < coins.length; i++) {
          const c = coins[i];
          if (c.collected) continue;
          anyActive = true;
          _coinBob.copy(c.up).multiplyScalar(Math.sin(elapsed * 3.4 + c.phase) * 0.25);
          _coinDummy.position.copy(c.basePosition).add(_coinBob);
          _coinDummy.rotation.set(0, elapsed * 2.8 + c.phase, 0);
          _coinDummy.scale.set(1, 1, 1);
          _coinDummy.updateMatrix();
          coinInstanced.setMatrixAt(i, _coinDummy.matrix);
        }
        if (anyActive) {
          coinInstanced.instanceMatrix.needsUpdate = true;
        }
      }
    },
    dispose: () => {
      for (const d of disposables) {
        d.dispose();
      }
    },
  };
}
