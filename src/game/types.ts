import * as THREE from 'three';

export type ScreenMode = 'title' | 'levels' | 'garage' | 'playing' | 'paused' | 'victory';

export type ChassisId =
  | 'interceptor'
  | 'apex'
  | 'vortex'
  | 'titan'
  | 'phantom'
  | 'spectre'
  | 'valkyrie'
  | 'nemesis'
  | 'nova'
  | 'zenith';

export type GliderId = 'none' | 'aero-wings' | 'plasma-kite' | 'jet-pack';

export type GroundTheme =
  | 'cyber-grid'
  | 'hex-plasma'
  | 'circuit-trace'
  | 'holo-glass'
  | 'solar-sand'
  | 'cryo-ice';

export interface ChassisSpec {
  id: ChassisId;
  name: string;
  tagline: string;
  topSpeed: number;
  acceleration: number;
  handling: number;
  nitroPower: number;
  stats: {
    speed: number;
    grip: number;
    boost: number;
  };
}

export interface GliderSpec {
  id: GliderId;
  name: string;
  tagline: string;
  airGravity: number; // standard is 36; lower = longer hang time
  airThrust: number; // forward glide push
  airControl: number; // mid-air turn responsiveness multiplier
}

export interface NeonPreset {
  name: string;
  hex: string;
}

export interface GarageConfig {
  chassisId: ChassisId;
  gliderId: GliderId;
  primaryColor: string;
  secondaryColor: string;
}

export interface LevelBestRecord {
  bestTimeMs: number;
  medal: 'gold' | 'silver' | 'bronze';
}

// Compact tuple: [timeSec, px, py, pz, qx, qy, qz, qw]
export type GhostFrame = [number, number, number, number, number, number, number, number];

export interface GhostRun {
  chassisId: ChassisId;
  gliderId: GliderId;
  frames: GhostFrame[];
}

export type MissionMetric =
  | 'levels_finished'
  | 'single_run_coins'
  | 'total_coins_today'
  | 'zero_respawn_finish'
  | 'gold_medal_finish'
  | 'mega_level_finish'
  | 'single_run_airborne_sec';

export interface DailyMissionDefinition {
  id: string;
  title: string;
  description: string;
  metric: MissionMetric;
  target: number;
  rewardCoins: number;
}

export interface DailyMissionsSave {
  dateKey: string;
  missionIds: string[];
  progress: Record<string, number>;
  claimed: Record<string, boolean>;
}

export interface SavedProgress {
  bestTimes: Record<string, LevelBestRecord>;
  ghostRuns: Record<string, GhostRun>;
  garage: GarageConfig;
  muted: boolean;
  ghostEnabled: boolean;
  steeringSensitivity: number; // 0.4 to 1.8 (1.0 default)
  totalCoins: number;
  dailyMissions: DailyMissionsSave;
}

export type TrackPiece =
  | {
      type: 'straight';
      length: number;
      width?: number;
      elevation?: number;
      boostPads?: number[];
      checkpoint?: boolean;
      lasers?: { t: number; mode: 'sweep' | 'pulse'; speed?: number; phase?: number }[];
      hammers?: { t: number; speed?: number; phase?: number }[];
      barriers?: { t: number; speed?: number; phase?: number }[];
      spinners?: { t: number; speed?: number; phase?: number }[];
    }
  | {
      type: 'curve';
      radius: number;
      angleDeg: number;
      width?: number;
      bankDeg?: number;
      elevation?: number;
      boostPads?: number[];
      checkpoint?: boolean;
    }
  | {
      type: 'ramp';
      length: number;
      height: number;
      lipAngleDeg: number;
      width?: number;
      boostPad?: boolean;
      gap?: {
        forward: number;
        drop: number;
        yawOffsetDeg?: number;
      };
    }
  | {
      type: 'loop';
      radius: number;
      width?: number;
      corkscrewSide?: number;
      boostEntry?: boolean;
      checkpointAfter?: boolean;
    };

export interface LevelDefinition {
  id: string;
  number: number;
  name: string;
  subtitle: string;
  difficulty: 'Rookie' | 'Pro' | 'Ace' | 'Master' | 'Legend';
  groundTheme: GroundTheme;
  groundLabel: string;
  accentColor: string;
  secondaryColor: string;
  parTimes: {
    gold: number;
    silver: number;
    bronze: number;
  };
  defaultWidth: number;
  pieces: TrackPiece[];
}

export interface ColliderQuad {
  a: THREE.Vector3;
  b: THREE.Vector3;
  c: THREE.Vector3;
  d: THREE.Vector3;
  center: THREE.Vector3;
  normal: THREE.Vector3;
  tangent: THREE.Vector3;
  right: THREE.Vector3;
  isLoop: boolean;
  isBoost: boolean;
}

export interface BoostZone {
  center: THREE.Vector3;
  forward: THREE.Vector3;
  normal: THREE.Vector3;
  radius: number;
}

export interface CoinItem {
  basePosition: THREE.Vector3;
  up: THREE.Vector3;
  mesh: THREE.Mesh;
  collected: boolean;
  phase: number;
}

export interface CheckpointGate {
  index: number;
  position: THREE.Vector3;
  forward: THREE.Vector3;
  up: THREE.Vector3;
  right: THREE.Vector3;
  width: number;
  activated: boolean;
  updateVisuals: (activated: boolean) => void;
}

export interface MovingObstacle {
  type: 'laser' | 'hammer' | 'barrier' | 'spinner';
  update: (elapsed: number) => void;
  checkCollision: (carPos: THREE.Vector3, carRadius: number, outPush: THREE.Vector3) => boolean;
}

export interface InputState {
  throttle: boolean;
  brake: boolean;
  left: boolean;
  right: boolean;
  boost: boolean;
  pitchUp: boolean;
  pitchDown: boolean;
  rollLeft: boolean;
  rollRight: boolean;
}

export interface HudTelemetry {
  speedKmh: number;
  nitro: number;
  elapsedSec: number;
  checkpointIndex: number;
  totalCheckpoints: number;
  coins: number;
  totalTrackCoins: number;
  airborne: boolean;
  gliding: boolean;
  drifting: boolean;
  boosting: boolean;
  ghostActive: boolean;
  respawns: number;
  lastCheckpointFlash: number;
  hazardHitFlash: number;
}

export const CHASSIS_SPECS: Record<ChassisId, ChassisSpec> = {
  interceptor: {
    id: 'interceptor',
    name: 'Cyber Interceptor',
    tagline: 'Balanced wedge pursuit frame with twin stabilizer fins',
    topSpeed: 56,
    acceleration: 28,
    handling: 1.65,
    nitroPower: 25,
    stats: { speed: 82, grip: 86, boost: 80 },
  },
  apex: {
    id: 'apex',
    name: 'Apex Drift',
    tagline: 'Lightweight widebody drifter tuned for tight skyways',
    topSpeed: 53,
    acceleration: 31,
    handling: 1.88,
    nitroPower: 24,
    stats: { speed: 78, grip: 96, boost: 76 },
  },
  vortex: {
    id: 'vortex',
    name: 'Vortex Hypercar',
    tagline: 'Low-drag split-wing prototype built for maximum velocity',
    topSpeed: 62,
    acceleration: 29,
    handling: 1.55,
    nitroPower: 30,
    stats: { speed: 96, grip: 78, boost: 95 },
  },
  titan: {
    id: 'titan',
    name: 'Titan Buggy',
    tagline: 'Heavy roll-cage stunt runner with oversized tires and high torque',
    topSpeed: 54,
    acceleration: 33,
    handling: 1.78,
    nitroPower: 25,
    stats: { speed: 79, grip: 92, boost: 82 },
  },
  phantom: {
    id: 'phantom',
    name: 'Phantom Blade',
    tagline: 'Stealth delta-wing racer engineered for surgical precision',
    topSpeed: 59,
    acceleration: 30,
    handling: 1.92,
    nitroPower: 28,
    stats: { speed: 89, grip: 94, boost: 86 },
  },
  spectre: {
    id: 'spectre',
    name: 'Spectre GT',
    tagline: 'Fastback endurance grand tourer with quad-jet overdrive',
    topSpeed: 60,
    acceleration: 29,
    handling: 1.62,
    nitroPower: 32,
    stats: { speed: 91, grip: 84, boost: 98 },
  },
  valkyrie: {
    id: 'valkyrie',
    name: 'Valkyrie F1',
    tagline: 'Open-cockpit cyber formula racer built for razor-sharp apexes',
    topSpeed: 61,
    acceleration: 32,
    handling: 2.02,
    nitroPower: 27,
    stats: { speed: 93, grip: 99, boost: 84 },
  },
  nemesis: {
    id: 'nemesis',
    name: 'Nemesis Muscle',
    tagline: 'Supercharged cyber-muscle coupe with massive low-end launch torque',
    topSpeed: 57,
    acceleration: 35,
    handling: 1.52,
    nitroPower: 29,
    stats: { speed: 85, grip: 80, boost: 91 },
  },
  nova: {
    id: 'nova',
    name: 'Nova Hover-GT',
    tagline: 'Twin-turbine aero prototype with balanced drift stability',
    topSpeed: 58,
    acceleration: 31,
    handling: 1.82,
    nitroPower: 29,
    stats: { speed: 88, grip: 90, boost: 90 },
  },
  zenith: {
    id: 'zenith',
    name: 'Zenith LMP',
    tagline: 'Endurance Le Mans shark-fin hypercar with peak straightaway velocity',
    topSpeed: 64,
    acceleration: 30,
    handling: 1.68,
    nitroPower: 33,
    stats: { speed: 99, grip: 85, boost: 97 },
  },
};

export const GLIDER_SPECS: Record<GliderId, GliderSpec> = {
  none: {
    id: 'none',
    name: 'No Glider',
    tagline: 'Standard ballistic jump arc with minimal air drag',
    airGravity: 36,
    airThrust: 0,
    airControl: 0.9,
  },
  'aero-wings': {
    id: 'aero-wings',
    name: 'Aero Cyber-Wings',
    tagline: 'Retractable neon wings delivering balanced lift across gaps',
    airGravity: 15,
    airThrust: 6,
    airControl: 1.35,
  },
  'plasma-kite': {
    id: 'plasma-kite',
    name: 'Plasma Delta Kite',
    tagline: 'Wide overhead delta sail for maximum hang-time and slow descent',
    airGravity: 10.5,
    airThrust: 4.5,
    airControl: 1.5,
  },
  'jet-pack': {
    id: 'jet-pack',
    name: 'Twin Jet Wing',
    tagline: 'Compact thrust wing boosting forward speed while airborne',
    airGravity: 19,
    airThrust: 13,
    airControl: 1.25,
  },
};

export const NEON_PRESETS: NeonPreset[] = [
  { name: 'Cyber Cyan', hex: '#00f3ff' },
  { name: 'Hyper Magenta', hex: '#ff007f' },
  { name: 'Electric Purple', hex: '#9d00ff' },
  { name: 'Acid Green', hex: '#39ff14' },
  { name: 'Solar Amber', hex: '#ffaa00' },
  { name: 'Laser Crimson', hex: '#ff2a55' },
];
