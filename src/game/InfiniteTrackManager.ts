import * as THREE from 'three';
import { buildTrack, BuiltTrack, TrackStartPose } from './TrackBuilder';
import {
  BoostZone,
  CheckpointGate,
  CoinItem,
  ColliderQuad,
  GroundTheme,
  JumpPadZone,
  LevelDefinition,
  MovingObstacle,
  RoadDesign,
  SceneryStyle,
  SpeedRingItem,
  TrackPiece,
  TrackQueryTarget,
} from './types';

export interface BiomeProfile {
  id: string;
  roadStyle: RoadDesign;
  roadLabel: string;
  groundTheme: GroundTheme;
  groundLabel: string;
  scenery: SceneryStyle;
  accentColor: string;
  secondaryColor: string;
}

export const ROAD_DESIGN_LABELS: Record<RoadDesign, string> = {
  highway: 'Neon Highway',
  'split-bridge': 'Twin Split-Bridge',
  'wave-deck': 'Harmonic Wave Deck',
  'canyon-trench': 'Armored Trench',
  'hyper-tube': 'Photon Conduit',
  'narrow-beam': 'Precision Skybeam',
};

const BIOME_PROFILES: BiomeProfile[] = [
  {
    id: 'neon-highway',
    roadStyle: 'highway',
    roadLabel: ROAD_DESIGN_LABELS.highway,
    groundTheme: 'cyber-grid',
    groundLabel: 'Cyber Grid',
    scenery: 'chevrons',
    accentColor: '#00f3ff',
    secondaryColor: '#ff007f',
  },
  {
    id: 'twin-split',
    roadStyle: 'split-bridge',
    roadLabel: ROAD_DESIGN_LABELS['split-bridge'],
    groundTheme: 'holo-glass',
    groundLabel: 'Holo Glass',
    scenery: 'pylons',
    accentColor: '#39ff14',
    secondaryColor: '#00f3ff',
  },
  {
    id: 'pulse-wave',
    roadStyle: 'wave-deck',
    roadLabel: ROAD_DESIGN_LABELS['wave-deck'],
    groundTheme: 'hex-plasma',
    groundLabel: 'Hex Plasma',
    scenery: 'chevrons',
    accentColor: '#9d00ff',
    secondaryColor: '#00f3ff',
  },
  {
    id: 'armored-trench',
    roadStyle: 'canyon-trench',
    roadLabel: ROAD_DESIGN_LABELS['canyon-trench'],
    groundTheme: 'solar-sand',
    groundLabel: 'Solar Canyon',
    scenery: 'pylons',
    accentColor: '#ffaa00',
    secondaryColor: '#ff2a55',
  },
  {
    id: 'photon-conduit',
    roadStyle: 'hyper-tube',
    roadLabel: ROAD_DESIGN_LABELS['hyper-tube'],
    groundTheme: 'circuit-trace',
    groundLabel: 'Circuit Trace',
    scenery: 'arches',
    accentColor: '#ff007f',
    secondaryColor: '#ffaa00',
  },
  {
    id: 'cryo-beam',
    roadStyle: 'narrow-beam',
    roadLabel: ROAD_DESIGN_LABELS['narrow-beam'],
    groundTheme: 'cryo-ice',
    groundLabel: 'Cryo Ice',
    scenery: 'pylons',
    accentColor: '#38bdf8',
    secondaryColor: '#00f3ff',
  },
  {
    id: 'volt-split',
    roadStyle: 'split-bridge',
    roadLabel: ROAD_DESIGN_LABELS['split-bridge'],
    groundTheme: 'circuit-trace',
    groundLabel: 'Circuit Trace',
    scenery: 'arches',
    accentColor: '#ff007f',
    secondaryColor: '#00f3ff',
  },
  {
    id: 'apex-wave',
    roadStyle: 'wave-deck',
    roadLabel: ROAD_DESIGN_LABELS['wave-deck'],
    groundTheme: 'cyber-grid',
    groundLabel: 'Cyber Grid',
    scenery: 'arches',
    accentColor: '#00f3ff',
    secondaryColor: '#39ff14',
  },
];

interface StreamedChunk {
  index: number;
  sector: number;
  biome: BiomeProfile;
  track: BuiltTrack;
  startPos: THREE.Vector3;
  endPos: THREE.Vector3;
  startDistM: number;
  lengthM: number;
}

const _seg = new THREE.Vector3();
const _rel = new THREE.Vector3();
const _closest = new THREE.Vector3();
const _probeQuads: ColliderQuad[] = [];

function seededRand(seed: number): () => number {
  let s = (seed * 1664525 + 1013904223) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function estimatePieceLength(piece: TrackPiece): number {
  if (piece.type === 'straight') return piece.length;
  if (piece.type === 'curve') return Math.abs((piece.angleDeg * Math.PI) / 180) * piece.radius;
  if (piece.type === 'ramp') return piece.length + (piece.gap ? piece.gap.forward : 0);
  return Math.PI * 2 * piece.radius;
}

export class InfiniteTrackManager implements TrackQueryTarget {
  public readonly group = new THREE.Group();
  public readonly finishGate = null;

  private chunks: StreamedChunk[] = [];
  private activeChunkIdx = 0;
  private maxDistanceM = 0;

  private nextChunkIndex = 0;
  private nextCheckpointIndex = 0;
  private cumulativeDistM = 0;
  private cumulativeYawDeg = 0;
  private cumulativeElevationY = 0;
  private cursorPose: TrackStartPose = {
    position: new THREE.Vector3(0, 0, 0),
    forward: new THREE.Vector3(0, 0, -1),
    up: new THREE.Vector3(0, 1, 0),
    right: new THREE.Vector3(1, 0, 0),
  };

  private readonly seedBase: number;
  private readonly maxAniso: number;

  constructor(maxAniso: number, seedBase = Math.floor(Math.random() * 100000)) {
    this.maxAniso = maxAniso;
    this.seedBase = seedBase;
    // Pre-build sectors 1..3 immediately at spawn
    this.spawnNextChunk();
    this.spawnNextChunk();
    this.spawnNextChunk();
  }

  public getActiveBiome(): BiomeProfile {
    const active = this.chunks.find((c) => c.index === this.activeChunkIdx) ?? this.chunks[0];
    return active.biome;
  }

  public getActiveSector(): number {
    return this.activeChunkIdx + 1;
  }

  public getDistanceM(): number {
    return Math.round(this.maxDistanceM);
  }

  public getSpawnPoint(): { position: THREE.Vector3; forward: THREE.Vector3; up: THREE.Vector3 } {
    return this.chunks[0].track.spawnPoint;
  }

  private pickBiomeForChunk(chunkIndex: number, rand: () => number): BiomeProfile {
    if (chunkIndex < 6) {
      // Tour every unique road design & ground theme across sectors 1-6
      return BIOME_PROFILES[chunkIndex];
    }
    const prevBiome = this.chunks[this.chunks.length - 1]?.biome;
    let candidate = BIOME_PROFILES[Math.floor(rand() * BIOME_PROFILES.length)];
    if (prevBiome && candidate.id === prevBiome.id) {
      candidate =
        BIOME_PROFILES[(BIOME_PROFILES.indexOf(candidate) + 1 + Math.floor(rand() * 3)) % BIOME_PROFILES.length];
    }
    return candidate;
  }

  private addTrapsToStraight(
    piece: Extract<TrackPiece, { type: 'straight' }>,
    roadStyle: RoadDesign,
    difficultyScale: number,
    rand: () => number,
    slotT: number,
  ): void {
    const speedBoost = 1 + Math.min(0.85, difficultyScale * 0.12);
    const phase = rand() * Math.PI * 2;
    const isSplit = roadStyle === 'split-bridge';

    // Choose trap pool compatible with road design
    const pool: ('spikes' | 'crusher' | 'saw' | 'laser' | 'hammer' | 'barrier' | 'spinner')[] = isSplit
      ? ['crusher', 'laser', 'barrier', 'hammer']
      : roadStyle === 'narrow-beam'
        ? ['spikes', 'saw', 'laser', 'crusher']
        : ['spikes', 'crusher', 'saw', 'laser', 'hammer', 'barrier', 'spinner'];

    const trapType = pool[Math.floor(rand() * pool.length)];

    switch (trapType) {
      case 'spikes':
        piece.spikes = piece.spikes ?? [];
        piece.spikes.push({ t: slotT, speed: 2.1 * speedBoost, phase });
        break;
      case 'crusher':
        piece.crushers = piece.crushers ?? [];
        piece.crushers.push({
          t: slotT,
          speed: 2.0 * speedBoost,
          phase,
          laneRatio: isSplit ? (rand() < 0.5 ? -0.28 : 0.28) : (rand() - 0.5) * 0.44,
        });
        break;
      case 'saw':
        piece.saws = piece.saws ?? [];
        piece.saws.push({ t: slotT, speed: 2.1 * speedBoost, phase });
        break;
      case 'laser':
        piece.lasers = piece.lasers ?? [];
        piece.lasers.push({
          t: slotT,
          mode: rand() < 0.5 ? 'sweep' : 'pulse',
          speed: 2.1 * speedBoost,
          phase,
        });
        break;
      case 'hammer':
        piece.hammers = piece.hammers ?? [];
        piece.hammers.push({ t: slotT, speed: 2.15 * speedBoost, phase });
        break;
      case 'barrier':
        piece.barriers = piece.barriers ?? [];
        piece.barriers.push({ t: slotT, speed: 1.85 * speedBoost, phase });
        break;
      case 'spinner':
        piece.spinners = piece.spinners ?? [];
        piece.spinners.push({ t: slotT, speed: 1.8 * speedBoost, phase });
        break;
    }
  }

  private generateChunkDefinition(chunkIndex: number, biome: BiomeProfile): LevelDefinition {
    const rand = seededRand(this.seedBase + chunkIndex * 977);
    const sector = chunkIndex + 1;
    const diffScale = Math.min(8, chunkIndex * 0.75);
    const baseW = biome.roadStyle === 'narrow-beam' ? 16 : biome.roadStyle === 'split-bridge' ? 25 : 22;

    const pieces: TrackPiece[] = [];

    // 1. Sector Entry Straight (checkpoint at t=0.22 + featured biome road & traps)
    const entryLen = chunkIndex === 0 ? 220 : 210 + Math.round(rand() * 40);
    const entryPiece: Extract<TrackPiece, { type: 'straight' }> = {
      type: 'straight',
      length: entryLen,
      width: baseW,
      roadStyle: biome.roadStyle,
      scenery: biome.scenery,
      checkpoint: true,
      boostPads: chunkIndex === 0 ? [0.18, 0.72] : [0.14],
    };

    if (chunkIndex === 0) {
      // Showcase Jump Pad, Speed Ring, Sliding Saw, and Spike Strip right in Sector 1
      entryPiece.saws = [{ t: 0.42, speed: 1.8, phase: 0.3 }];
      entryPiece.jumpPads = [{ t: 0.62, laneRatio: 0, impulse: 24 }];
      entryPiece.rings = [{ t: 0.69, height: 5.2, laneRatio: 0 }];
      entryPiece.spikes = [{ t: 0.86, speed: 2.0, phase: 1.1 }];
    } else {
      const trapSlots = sector >= 4 ? [0.42, 0.74] : [0.55];
      for (const slot of trapSlots) {
        this.addTrapsToStraight(entryPiece, biome.roadStyle, diffScale, rand, slot);
      }
      if (rand() < 0.78) {
        const jpT = 0.28 + rand() * 0.08;
        const lane = biome.roadStyle === 'split-bridge' ? (rand() < 0.5 ? -0.28 : 0.28) : (rand() - 0.5) * 0.35;
        entryPiece.jumpPads = [{ t: jpT, laneRatio: lane, impulse: 23 + rand() * 4 }];
        entryPiece.rings = [{ t: Math.min(0.9, jpT + 0.08), height: 5.0, laneRatio: lane }];
      } else if (rand() < 0.65) {
        const lane = biome.roadStyle === 'split-bridge' ? (rand() < 0.5 ? -0.28 : 0.28) : 0;
        entryPiece.rings = [{ t: 0.86, height: 3.4, laneRatio: lane }];
      }
    }
    pieces.push(entryPiece);

    // 2. Dynamic Middle Feature: Curve (bounded heading [-70, +70]), Ramp+Gap, or Corkscrew Loop
    const featureRoll = rand();
    if (chunkIndex >= 1 && featureRoll < 0.28) {
      // Corkscrew Loop (keeps yaw identical, huge thrill)
      pieces.push({
        type: 'loop',
        radius: 26 + Math.round(rand() * 4),
        width: 21,
        corkscrewSide: (rand() < 0.5 ? 1 : -1) * 26,
        boostEntry: true,
        checkpointAfter: false,
      });
    } else if (featureRoll < 0.64) {
      // Banked sweeping curve keeping total heading safely within [-70, +70] deg of -Z
      let angleDeg = (rand() < 0.5 ? 1 : -1) * (35 + Math.round(rand() * 25));
      if (this.cumulativeYawDeg + angleDeg > 68) {
        angleDeg = -Math.abs(angleDeg);
      } else if (this.cumulativeYawDeg + angleDeg < -68) {
        angleDeg = Math.abs(angleDeg);
      }
      this.cumulativeYawDeg += angleDeg;

      let elev = 0;
      if (this.cumulativeElevationY < 6 && rand() < 0.5) elev = 6;
      else if (this.cumulativeElevationY > 4 && rand() < 0.5) elev = -6;
      this.cumulativeElevationY += elev;

      pieces.push({
        type: 'curve',
        radius: 90 + Math.round(rand() * 25),
        angleDeg,
        width: Math.max(20, baseW),
        bankDeg: angleDeg > 0 ? 11 : -11,
        elevation: elev,
        boostPads: [0.35, 0.78],
      });
    } else {
      // High-speed Jump Ramp + Gap
      let drop = -3;
      if (this.cumulativeElevationY > 8) drop = -7;
      else if (this.cumulativeElevationY < -4) drop = 4;
      const rampHeight = 6;
      this.cumulativeElevationY += rampHeight + drop;

      pieces.push({
        type: 'ramp',
        length: 44,
        height: rampHeight,
        lipAngleDeg: 18,
        width: 22,
        boostPad: true,
        gap: {
          forward: 36 + Math.round(rand() * 14),
          drop,
        },
      });
    }

    // 3. Second themed stunt straight with fresh traps + Speed Ring
    const midStyle =
      rand() < 0.45 && chunkIndex > 0
        ? BIOME_PROFILES[Math.floor(rand() * BIOME_PROFILES.length)].roadStyle
        : biome.roadStyle;
    const midW = midStyle === 'narrow-beam' ? 16 : midStyle === 'split-bridge' ? 25 : 22;
    const midLen = 200 + Math.round(rand() * 50);

    let midElev = 0;
    if (this.cumulativeElevationY > 12) midElev = -6;
    else if (this.cumulativeElevationY < -6) midElev = 6;
    this.cumulativeElevationY += midElev;

    const midPiece: Extract<TrackPiece, { type: 'straight' }> = {
      type: 'straight',
      length: midLen,
      width: midW,
      elevation: midElev,
      roadStyle: midStyle,
      scenery: midStyle === 'hyper-tube' ? 'arches' : biome.scenery,
      boostPads: midStyle === 'split-bridge' ? [0.22] : [0.25, 0.78],
    };
    this.addTrapsToStraight(midPiece, midStyle, diffScale + 0.5, rand, 0.48);
    if (sector >= 2) {
      this.addTrapsToStraight(midPiece, midStyle, diffScale + 0.5, rand, 0.76);
    }
    const ringLane = midStyle === 'split-bridge' ? (rand() < 0.5 ? -0.28 : 0.28) : (rand() - 0.5) * 0.4;
    midPiece.rings = [{ t: 0.62, height: 3.3, laneRatio: ringLane }];
    pieces.push(midPiece);

    // 4. Flat Level Connector Straight (guarantees horizontal endPose for next chunk seam)
    const exitPiece: Extract<TrackPiece, { type: 'straight' }> = {
      type: 'straight',
      length: 120,
      width: 22,
      elevation: 0,
      roadStyle: 'highway',
      scenery: 'chevrons',
      boostPads: [0.5],
    };
    if (sector >= 3 && rand() < 0.65) {
      this.addTrapsToStraight(exitPiece, 'highway', diffScale, rand, 0.68);
    }
    pieces.push(exitPiece);

    return {
      id: `infinite-sector-${sector}`,
      number: sector,
      name: `Sector ${sector} · ${biome.roadLabel}`,
      subtitle: 'Endless procedural skyway',
      difficulty: sector <= 2 ? 'Pro' : sector <= 5 ? 'Ace' : 'Legend',
      groundTheme: biome.groundTheme,
      groundLabel: biome.groundLabel,
      accentColor: biome.accentColor,
      secondaryColor: biome.secondaryColor,
      parTimes: { gold: 999, silver: 999, bronze: 999 },
      defaultWidth: 22,
      pieces,
    };
  }

  private spawnNextChunk(): void {
    const idx = this.nextChunkIndex++;
    const rand = seededRand(this.seedBase + idx * 541 + 17);
    const biome = this.pickBiomeForChunk(idx, rand);
    const def = this.generateChunkDefinition(idx, biome);

    const startPos = this.cursorPose.position.clone();
    const track = buildTrack(def, this.maxAniso, {
      startPose: this.cursorPose,
      includeFinishGate: false,
      startCheckpointIndex: this.nextCheckpointIndex,
    });

    this.nextCheckpointIndex += track.checkpoints.length;
    this.cursorPose = track.endPose;

    let lengthM = 0;
    for (const p of def.pieces) {
      lengthM += estimatePieceLength(p);
    }

    const chunk: StreamedChunk = {
      index: idx,
      sector: idx + 1,
      biome,
      track,
      startPos,
      endPos: track.endPose.position.clone(),
      startDistM: this.cumulativeDistM,
      lengthM,
    };

    this.cumulativeDistM += lengthM;
    this.chunks.push(chunk);
    this.group.add(track.group);
  }

  public ensureChunksAround(carPos: THREE.Vector3): {
    sectorChanged: boolean;
    activeBiome: BiomeProfile;
    activeSector: number;
    distanceM: number;
  } {
    const prevSector = this.activeChunkIdx + 1;

    // Determine active chunk by checking which chunk contains quads near the car (or closest chord)
    let detectedIdx = this.activeChunkIdx;
    let bestChordDistSq = Infinity;

    for (let i = 0; i < this.chunks.length; i++) {
      const c = this.chunks[i];
      if (c.index < this.activeChunkIdx) continue;

      c.track.queryQuads(carPos.x, carPos.z, _probeQuads);
      if (_probeQuads.length > 0) {
        // Check closest quad center
        let minQDist = Infinity;
        for (let q = 0; q < _probeQuads.length; q++) {
          const dSq = _probeQuads[q].center.distanceToSquared(carPos);
          if (dSq < minQDist) minQDist = dSq;
        }
        if (minQDist < bestChordDistSq) {
          bestChordDistSq = minQDist;
          detectedIdx = c.index;
        }
      }
    }

    // Fallback when airborne across gap: use closest forward chord among current and next chunk
    if (bestChordDistSq === Infinity) {
      for (let i = 0; i < this.chunks.length; i++) {
        const c = this.chunks[i];
        if (c.index < this.activeChunkIdx) continue;
        _seg.subVectors(c.endPos, c.startPos);
        const lenSq = Math.max(1, _seg.lengthSq());
        _rel.subVectors(carPos, c.startPos);
        const t = Math.max(0, Math.min(1, _rel.dot(_seg) / lenSq));
        _closest.copy(c.startPos).addScaledVector(_seg, t);
        const dSq = _closest.distanceToSquared(carPos);
        if (dSq < bestChordDistSq) {
          bestChordDistSq = dSq;
          detectedIdx = c.index;
        }
      }
    }

    if (detectedIdx > this.activeChunkIdx) {
      this.activeChunkIdx = detectedIdx;
    }

    // Stream 2 chunks ahead of current chunk
    while (this.nextChunkIndex <= this.activeChunkIdx + 2) {
      this.spawnNextChunk();
    }

    // Dispose chunks strictly older than activeChunkIdx - 1 to keep memory tiny
    while (this.chunks.length > 0 && this.chunks[0].index < this.activeChunkIdx - 1) {
      const old = this.chunks.shift()!;
      this.group.remove(old.track.group);
      old.track.dispose();
    }

    // Compute smooth monotonic distance in meters along active chunk
    const activeChunk = this.chunks.find((c) => c.index === this.activeChunkIdx) ?? this.chunks[0];
    _seg.subVectors(activeChunk.endPos, activeChunk.startPos);
    const segLenSq = Math.max(1, _seg.lengthSq());
    _rel.subVectors(carPos, activeChunk.startPos);
    const t = Math.max(0, Math.min(1, _rel.dot(_seg) / segLenSq));
    const currentDist = activeChunk.startDistM + t * activeChunk.lengthM;
    if (currentDist > this.maxDistanceM) {
      this.maxDistanceM = currentDist;
    }

    const activeSector = this.activeChunkIdx + 1;
    return {
      sectorChanged: activeSector !== prevSector,
      activeBiome: activeChunk.biome,
      activeSector,
      distanceM: Math.round(this.maxDistanceM),
    };
  }

  public queryQuads(x: number, z: number, out: ColliderQuad[]): void {
    out.length = 0;
    for (let i = 0; i < this.chunks.length; i++) {
      this.chunks[i].track.queryQuads(x, z, _probeQuads);
      for (let q = 0; q < _probeQuads.length; q++) {
        out.push(_probeQuads[q]);
      }
    }
  }

  public getGripAt(x: number, z: number): number {
    for (let i = 0; i < this.chunks.length; i++) {
      const c = this.chunks[i];
      c.track.queryQuads(x, z, _probeQuads);
      if (_probeQuads.length > 0) {
        return c.track.gripMultiplier;
      }
    }
    return this.getActiveBiome().groundTheme === 'cryo-ice' ? 0.76 : 1.02;
  }

  public forEachBoostZone(fn: (bz: BoostZone) => void): void {
    for (let i = 0; i < this.chunks.length; i++) {
      this.chunks[i].track.forEachBoostZone(fn);
    }
  }

  public forEachJumpPad(fn: (jp: JumpPadZone) => void): void {
    for (let i = 0; i < this.chunks.length; i++) {
      this.chunks[i].track.forEachJumpPad(fn);
    }
  }

  public forEachObstacle(fn: (obs: MovingObstacle) => void): void {
    for (let i = 0; i < this.chunks.length; i++) {
      this.chunks[i].track.forEachObstacle(fn);
    }
  }

  public forEachCheckpoint(fn: (cp: CheckpointGate) => void): void {
    for (let i = 0; i < this.chunks.length; i++) {
      this.chunks[i].track.forEachCheckpoint(fn);
    }
  }

  public forEachCoin(fn: (coin: CoinItem, markCollected: () => void) => void): void {
    for (let i = 0; i < this.chunks.length; i++) {
      this.chunks[i].track.forEachCoin(fn);
    }
  }

  public forEachRing(fn: (ring: SpeedRingItem, markCollected: () => void) => void): void {
    for (let i = 0; i < this.chunks.length; i++) {
      this.chunks[i].track.forEachRing(fn);
    }
  }

  public update(elapsed: number): void {
    for (let i = 0; i < this.chunks.length; i++) {
      this.chunks[i].track.update(elapsed);
    }
  }

  public dispose(): void {
    for (let i = 0; i < this.chunks.length; i++) {
      this.group.remove(this.chunks[i].track.group);
      this.chunks[i].track.dispose();
    }
    this.chunks = [];
  }
}
