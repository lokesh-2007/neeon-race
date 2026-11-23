import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { AudioSynth } from './AudioSynth';
import { InfiniteTrackManager } from './InfiniteTrackManager';
import { LEVELS } from './levels';
import { buildTrack, BuiltTrack } from './TrackBuilder';
import {
  CrashEvent,
  EnvironmentalEventHud,
  EnvironmentalEventType,
  GarageConfig,
  GhostFrame,
  GhostRun,
  GraphicsQuality,
  GroundTheme,
  HudTelemetry,
  InputState,
  LevelDefinition,
  ScreenMode,
  TrackQueryTarget,
} from './types';
import {
  createGhostVehicleMesh,
  GhostVehicleVisuals,
  VehicleController,
} from './VehicleController';

// Module-scope scratch math objects (zero per-frame GC)
const _camTargetPos = new THREE.Vector3();
const _camLookAt = new THREE.Vector3();
const _carFwd = new THREE.Vector3();
const _carUp = new THREE.Vector3();
const _carRight = new THREE.Vector3();
const _dummyObj = new THREE.Object3D();
const _pColor = new THREE.Color();
const _ghostPosA = new THREE.Vector3();
const _ghostPosB = new THREE.Vector3();
const _ghostQuatA = new THREE.Quaternion();
const _ghostQuatB = new THREE.Quaternion();
const _eventColorA = new THREE.Color();
const _eventColorB = new THREE.Color();
const _eventBgColor = new THREE.Color();

interface ParticleSlot {
  active: boolean;
  life: number;
  maxLife: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  scaleZ: number;
}

export interface EngineCallbacks {
  onHudUpdate: (hud: HudTelemetry) => void;
  onLevelComplete: (
    timeMs: number,
    respawns: number,
    coinsCollected: number,
    airborneSec: number,
    ghostRun: GhostRun,
  ) => void;
  onInfiniteComplete: (
    distanceM: number,
    sector: number,
    coinsCollected: number,
    airborneSec: number,
  ) => void;
  onCrashGameOver: (
    crash: CrashEvent,
    coinsCollected: number,
    elapsedSec: number,
    infiniteResult: {
      distanceM: number;
      sector: number;
      airborneSec: number;
    } | null,
  ) => void;
  onPauseToggle: () => void;
  onContextLost: (lost: boolean) => void;
}

function detectSoftwareWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return false;
  }
}

function detectCompactMobile(): boolean {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  return coarse || Math.min(window.innerWidth, window.innerHeight) < 768;
}

function getAbyssThemeColors(theme: GroundTheme): {
  bg: string;
  primaryLine: string;
  subLine: string;
  sunHex: number;
} {
  switch (theme) {
    case 'hex-plasma':
      return {
        bg: '#080410',
        primaryLine: 'rgba(157, 0, 255, 0.34)',
        subLine: 'rgba(0, 243, 255, 0.16)',
        sunHex: 0x9d00ff,
      };
    case 'circuit-trace':
      return {
        bg: '#0a040a',
        primaryLine: 'rgba(255, 0, 127, 0.32)',
        subLine: 'rgba(255, 170, 0, 0.15)',
        sunHex: 0xff007f,
      };
    case 'holo-glass':
      return {
        bg: '#040a08',
        primaryLine: 'rgba(57, 255, 20, 0.28)',
        subLine: 'rgba(0, 243, 255, 0.14)',
        sunHex: 0x39ff14,
      };
    case 'solar-sand':
      return {
        bg: '#110804',
        primaryLine: 'rgba(255, 170, 0, 0.34)',
        subLine: 'rgba(255, 72, 0, 0.18)',
        sunHex: 0xffaa00,
      };
    case 'cryo-ice':
      return {
        bg: '#040c16',
        primaryLine: 'rgba(56, 189, 248, 0.36)',
        subLine: 'rgba(186, 230, 253, 0.18)',
        sunHex: 0x38bdf8,
      };
    case 'cyber-grid':
    default:
      return {
        bg: '#050508',
        primaryLine: 'rgba(0, 243, 255, 0.28)',
        subLine: 'rgba(157, 0, 255, 0.14)',
        sunHex: 0xff007f,
      };
  }
}

function drawAbyssGridCanvas(canvas: HTMLCanvasElement, theme: GroundTheme): void {
  const ctx = canvas.getContext('2d')!;
  const colors = getAbyssThemeColors(theme);

  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, 512, 512);

  ctx.strokeStyle = colors.primaryLine;
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, 508, 508);

  ctx.strokeStyle = colors.subLine;
  ctx.lineWidth = 2;
  for (let i = 128; i < 512; i += 128) {
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

function createAbyssGridTexture(
  theme: GroundTheme,
  maxAnisotropy: number,
): { tex: THREE.CanvasTexture; canvas: HTMLCanvasElement } {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  drawAbyssGridCanvas(canvas, theme);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(90, 90);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return { tex, canvas };
}

export class GameEngine {
  private container: HTMLElement;
  private callbacks: EngineCallbacks;
  public audio: AudioSynth;

  private isSoftwareGl: boolean;
  private isCompactMobile: boolean;
  private qualityMode: GraphicsQuality;
  private useBloom = false;
  private slowFrameCount = 0;

  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private keyLight: THREE.DirectionalLight;
  private rimLight: THREE.DirectionalLight;
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;

  private vehicle: VehicleController;
  private currentGarage: GarageConfig;
  private currentTrack: BuiltTrack | null = null;
  private currentLevel: LevelDefinition = LEVELS[0];

  // Infinite Mode streaming state
  private infiniteManager: InfiniteTrackManager | null = null;
  private infiniteMode = false;
  private infiniteBestDistanceM = 0;
  private infiniteShields = 3;
  private readonly infiniteMaxShields = 3;
  private infiniteSector = 1;
  private infiniteDistanceM = 0;
  private infiniteRoadLabel = 'Neon Highway';
  private infiniteGroundLabel = 'Cyber Grid';
  private infiniteAccentColor = '#00f3ff';
  private infiniteSecondaryColor = '#ff007f';
  private lastSectorFlash = 0;

  // Infinite Mode procedural environmental events
  private activeEventType: EnvironmentalEventType | null = null;
  private eventRemainingSec = 0;
  private readonly eventDurationSec = 9.5;
  private eventCooldownSec = 9.0;
  private lastEventType: EnvironmentalEventType | null = null;
  private envParticlesAccum = 0;

  // Ghost recording & replay
  private ghostEnabled: boolean;
  private activeGhostRun: GhostRun | null = null;
  private ghostVisuals: GhostVehicleVisuals | null = null;
  private ghostCursor = 0;
  private recordedFrames: GhostFrame[] = [];
  private ghostSampleAccum = 0;

  private abyssGridMesh: THREE.Mesh;
  private abyssGridTex: THREE.CanvasTexture;
  private abyssGridCanvas: HTMLCanvasElement;
  private sunMat: THREE.MeshBasicMaterial;
  private horizonGroup: THREE.Group;
  private monolithsMesh: THREE.InstancedMesh;

  // Pooled neon speed-line / exhaust particles
  private readonly particleCount = 120;
  private particleMesh: THREE.InstancedMesh;
  private particles: ParticleSlot[] = [];
  private particleCursor = 0;
  private particleColorDirty = false;

  private mode: ScreenMode = 'title';
  private orbitAngle = 0.6;
  private runElapsedSec = 0;
  private clock = new THREE.Clock();
  private frameId = 0;
  private disposed = false;
  private hudEmitAccum = 0;

  private input: InputState = {
    throttle: false,
    brake: false,
    left: false,
    right: false,
    boost: false,
    jump: false,
    pitchUp: false,
    pitchDown: false,
    rollLeft: false,
    rollRight: false,
  };

  private keyMap: Record<string, keyof InputState> = {
    KeyW: 'throttle',
    ArrowUp: 'throttle',
    KeyS: 'brake',
    ArrowDown: 'brake',
    KeyA: 'left',
    ArrowLeft: 'left',
    KeyD: 'right',
    ArrowRight: 'right',
    Space: 'boost',
    ShiftLeft: 'jump',
    ShiftRight: 'jump',
    KeyQ: 'rollLeft',
    KeyE: 'rollRight',
  };

  private disposables: { dispose: () => void }[] = [];

  constructor(
    container: HTMLElement,
    initialGarage: GarageConfig,
    initialMuted: boolean,
    initialSensitivity: number,
    initialGhostEnabled: boolean,
    initialQuality: GraphicsQuality,
    callbacks: EngineCallbacks,
  ) {
    this.container = container;
    this.callbacks = callbacks;
    this.currentGarage = initialGarage;
    this.ghostEnabled = initialGhostEnabled;
    this.qualityMode = initialQuality;
    this.audio = new AudioSynth(initialMuted);

    this.isSoftwareGl = detectSoftwareWebGL();
    this.isCompactMobile = detectCompactMobile();
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2),
    );
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const width = Math.max(1, container.clientWidth || window.innerWidth);
    const height = Math.max(1, container.clientHeight || window.innerHeight);
    this.renderer.setSize(width, height);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    container.appendChild(this.renderer.domElement);

    // Scene & Fog
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050508);
    this.scene.fog = new THREE.FogExp2(0x050508, 0.0021);

    // Studio Environment Reflections via RoomEnvironment
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = envTex;
    this.disposables.push(envTex);
    pmrem.dispose();

    // Camera
    this.camera = new THREE.PerspectiveCamera(72, width / height, 0.25, 1600);
    this.camera.position.set(6, 4.2, -2);

    // 3-Point Cyber Lighting Rig
    const hemi = new THREE.HemisphereLight(0x38bdf8, 0x2e1065, 0.75);
    this.keyLight = new THREE.DirectionalLight(0xe0f2fe, 1.5);
    this.keyLight.position.set(45, 95, 35);
    if (!this.isSoftwareGl) {
      this.keyLight.castShadow = true;
      this.keyLight.shadow.mapSize.set(
        this.isCompactMobile ? 512 : 1024,
        this.isCompactMobile ? 512 : 1024,
      );
      this.keyLight.shadow.camera.near = 10;
      this.keyLight.shadow.camera.far = 220;
      this.keyLight.shadow.camera.left = -55;
      this.keyLight.shadow.camera.right = 55;
      this.keyLight.shadow.camera.top = 55;
      this.keyLight.shadow.camera.bottom = -55;
      this.keyLight.shadow.bias = -0.0005;
    }
    this.rimLight = new THREE.DirectionalLight(0xff007f, 1.15);
    this.rimLight.position.set(-50, 35, -70);
    this.scene.add(hemi, this.keyLight, this.keyLight.target, this.rimLight);

    // Abyss Cyber Grid Floor
    const maxAniso = Math.min(this.isCompactMobile ? 4 : 8, this.renderer.capabilities.getMaxAnisotropy());
    const abyssSetup = createAbyssGridTexture('cyber-grid', maxAniso);
    this.abyssGridTex = abyssSetup.tex;
    this.abyssGridCanvas = abyssSetup.canvas;
    const gridGeo = new THREE.PlaneGeometry(1800, 1800);
    gridGeo.rotateX(-Math.PI / 2);
    const gridMat = new THREE.MeshBasicMaterial({
      map: this.abyssGridTex,
      transparent: true,
      opacity: 0.82,
    });
    this.abyssGridMesh = new THREE.Mesh(gridGeo, gridMat);
    this.abyssGridMesh.position.set(0, -72, 0);
    this.scene.add(this.abyssGridMesh);
    this.disposables.push(this.abyssGridTex, gridGeo, gridMat);

    // Distant Cyberpunk Monoliths & Synth Sun Horizon
    this.horizonGroup = new THREE.Group();
    const towerGeo = new THREE.BoxGeometry(1, 1, 1);
    const towerMat = new THREE.MeshStandardMaterial({
      color: 0x0b0f1e,
      emissive: 0x1e1b4b,
      emissiveIntensity: 0.65,
      roughness: 0.5,
      metalness: 0.6,
    });
    const towerCount = 84;
    this.monolithsMesh = new THREE.InstancedMesh(towerGeo, towerMat, towerCount);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < towerCount; i++) {
      const angle = (i / towerCount) * Math.PI * 2;
      const dist = 280 + (i % 5) * 85;
      const h = 45 + ((i * 37) % 130);
      const w = 12 + ((i * 19) % 18);
      dummy.position.set(Math.cos(angle) * dist, -72 + h * 0.5, Math.sin(angle) * dist);
      dummy.scale.set(w, h, w);
      dummy.rotation.y = (i * 0.4) % Math.PI;
      dummy.updateMatrix();
      this.monolithsMesh.setMatrixAt(i, dummy.matrix);
      _pColor.setHSL(i % 2 === 0 ? 0.53 : 0.85, 0.8, 0.28);
      this.monolithsMesh.setColorAt(i, _pColor);
    }
    this.monolithsMesh.instanceMatrix.needsUpdate = true;
    if (this.monolithsMesh.instanceColor) {
      this.monolithsMesh.instanceColor.needsUpdate = true;
    }
    this.monolithsMesh.computeBoundingSphere();
    this.horizonGroup.add(this.monolithsMesh);

    // Distant Synthwave Sun Ring
    const sunGeo = new THREE.RingGeometry(82, 92, 48);
    this.sunMat = new THREE.MeshBasicMaterial({
      color: 0xff007f,
      side: THREE.DoubleSide,
      fog: false,
    });
    const sunRing = new THREE.Mesh(sunGeo, this.sunMat);
    sunRing.position.set(0, 75, -750);
    this.horizonGroup.add(sunRing);
    this.scene.add(this.horizonGroup);
    this.disposables.push(towerGeo, towerMat, sunGeo, this.sunMat);

    // Pooled Neon Speed-Line / Exhaust Particles
    const pGeo = new THREE.BoxGeometry(0.11, 0.11, 1.0);
    const pMat = new THREE.MeshBasicMaterial({
      color: 0x00f3ff,
      transparent: true,
      opacity: 0.85,
    });
    this.particleMesh = new THREE.InstancedMesh(pGeo, pMat, this.particleCount);
    this.particleMesh.frustumCulled = false;
    this.scene.add(this.particleMesh);
    this.disposables.push(pGeo, pMat);

    for (let i = 0; i < this.particleCount; i++) {
      this.particles.push({
        active: false,
        life: 0,
        maxLife: 0.4,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        scaleZ: 1,
      });
      _dummyObj.scale.set(0, 0, 0);
      _dummyObj.updateMatrix();
      this.particleMesh.setMatrixAt(i, _dummyObj.matrix);
    }
    this.particleMesh.instanceMatrix.needsUpdate = true;

    // Player Vehicle
    this.vehicle = new VehicleController(initialGarage, initialSensitivity);
    this.scene.add(this.vehicle.visuals.root);

    // Post-processing UnrealBloomPass (GPU only; skipped on software WebGL or Eco mode)
    if (!this.isSoftwareGl) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      const bloomScale = this.isCompactMobile ? 0.5 : 1;
      this.bloomPass = new UnrealBloomPass(
        new THREE.Vector2(
          Math.max(1, Math.floor(width * bloomScale)),
          Math.max(1, Math.floor(height * bloomScale)),
        ),
        0.68, // crisp neon glow strength
        0.45, // radius
        0.72, // threshold
      );
      this.composer.addPass(this.bloomPass);
    }

    this.applyGraphicsQuality(this.qualityMode);

    // Load initial Level 1 for showcase background
    this.loadLevel(LEVELS[0], null);

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    // Event listeners
    window.addEventListener('resize', this.handleResize);
    window.addEventListener('orientationchange', this.handleResize);
    window.visualViewport?.addEventListener('resize', this.handleResize);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleWindowBlur);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    this.renderer.domElement.addEventListener('webglcontextlost', this.handleContextLost);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.handleContextRestored);

    this.clock.start();
    this.tick();
  }

  private applyGraphicsQuality(quality: GraphicsQuality): void {
    this.qualityMode = quality;
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, this.container.clientWidth || window.innerWidth);
    const height = Math.max(1, this.container.clientHeight || window.innerHeight);

    if (this.isSoftwareGl) {
      this.renderer.setPixelRatio(1);
      this.renderer.shadowMap.enabled = false;
      this.keyLight.castShadow = false;
      this.useBloom = false;
      return;
    }

    if (quality === 'eco') {
      this.renderer.setPixelRatio(1);
      this.renderer.shadowMap.enabled = false;
      this.keyLight.castShadow = false;
      this.useBloom = false;
    } else if (quality === 'high') {
      this.renderer.setPixelRatio(Math.min(dpr, 2));
      this.renderer.shadowMap.enabled = true;
      this.keyLight.castShadow = true;
      this.useBloom = Boolean(this.composer);
    } else {
      // 'auto': balanced crispness for PC & mobile
      this.renderer.setPixelRatio(this.isCompactMobile ? Math.min(dpr, 1.5) : Math.min(dpr, 2));
      this.renderer.shadowMap.enabled = true;
      this.keyLight.castShadow = true;
      this.useBloom = Boolean(this.composer);
    }

    this.renderer.setSize(width, height);
    if (this.composer) {
      this.composer.setSize(width, height);
    }
    if (this.bloomPass) {
      const bloomScale = this.isCompactMobile && quality !== 'high' ? 0.5 : 1;
      this.bloomPass.resolution.set(
        Math.max(1, Math.floor(width * bloomScale)),
        Math.max(1, Math.floor(height * bloomScale)),
      );
    }
  }

  public setGraphicsQuality(quality: GraphicsQuality): void {
    this.slowFrameCount = 0;
    this.applyGraphicsQuality(quality);
  }

  private handleContextLost = (e: Event) => {
    e.preventDefault();
    this.clearInputs();
    this.callbacks.onContextLost(true);
  };

  private handleContextRestored = () => {
    this.callbacks.onContextLost(false);
  };

  private handleWindowBlur = () => {
    this.clearInputs();
  };

  private handleVisibilityChange = () => {
    if (document.hidden) {
      this.clearInputs();
      this.audio.suspend();
      if (this.mode === 'playing') {
        this.callbacks.onPauseToggle();
      }
    } else {
      // Discard accumulated delta while backgrounded
      this.clock.getDelta();
      this.audio.resume();
    }
  };

  private handleResize = () => {
    if (this.disposed) return;
    this.isCompactMobile = detectCompactMobile();
    const width = Math.max(1, this.container.clientWidth || window.innerWidth);
    const height = Math.max(1, this.container.clientHeight || window.innerHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.applyGraphicsQuality(this.qualityMode);
  };

  private handleKeyDown = (e: KeyboardEvent) => {
    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (this.mode === 'playing' || this.mode === 'paused') {
        this.callbacks.onPauseToggle();
      }
      return;
    }
    if (e.code === 'KeyR' && this.mode === 'playing') {
      this.vehicle.respawn(true);
      this.audio.playImpact();
      return;
    }
    const mapped = this.keyMap[e.code];
    if (mapped) {
      if (e.code === 'Space' || e.code.startsWith('Arrow')) {
        e.preventDefault();
      }
      this.input[mapped] = true;
    }
  };

  private handleKeyUp = (e: KeyboardEvent) => {
    const mapped = this.keyMap[e.code];
    if (mapped) {
      this.input[mapped] = false;
    }
  };

  public setTouchInput(control: keyof InputState, active: boolean): void {
    this.input[control] = active;
  }

  public clearInputs(): void {
    (Object.keys(this.input) as (keyof InputState)[]).forEach((k) => {
      this.input[k] = false;
    });
  }

  public updateGarage(garage: GarageConfig): void {
    this.currentGarage = garage;
    this.vehicle.applyGarage(garage, this.scene);
  }

  public setSteeringSensitivity(val: number): void {
    this.vehicle.setSteeringSensitivity(val);
  }

  public setGhostEnabled(enabled: boolean): void {
    this.ghostEnabled = enabled;
    if (!enabled && this.ghostVisuals) {
      this.ghostVisuals.root.visible = false;
    }
    this.emitHud();
  }

  public setMode(mode: ScreenMode): void {
    this.mode = mode;
    if (mode !== 'playing') {
      this.clearInputs();
    }
    if (mode === 'playing') {
      this.audio.startMusic();
    } else if (mode === 'paused' || mode === 'victory') {
      this.audio.updateEngine(0, false, false);
    }
  }

  public startLevel(level: LevelDefinition, bestGhost: GhostRun | null = null): void {
    this.loadLevel(level, bestGhost);
    this.runElapsedSec = 0;
    this.recordedFrames = [];
    this.ghostSampleAccum = 0;
    this.ghostCursor = 0;
    this.recordGhostFrame(0);
    this.mode = 'playing';
    this.audio.startMusic();
    this.emitHud();
  }

  public startInfiniteMode(bestDistanceM: number): void {
    if (this.currentTrack) {
      this.scene.remove(this.currentTrack.group);
      this.currentTrack.dispose();
      this.currentTrack = null;
    }
    if (this.infiniteManager) {
      this.scene.remove(this.infiniteManager.group);
      this.infiniteManager.dispose();
      this.infiniteManager = null;
    }
    this.setupGhostVisuals(null);

    this.infiniteMode = true;
    this.infiniteBestDistanceM = bestDistanceM;
    this.infiniteShields = this.infiniteMaxShields;
    this.infiniteSector = 1;
    this.infiniteDistanceM = 0;
    this.lastSectorFlash = 0;
    this.resetEnvironmentalEvent(false);

    const maxAniso = Math.min(
      this.isCompactMobile ? 4 : 8,
      this.renderer.capabilities.getMaxAnisotropy(),
    );
    this.infiniteManager = new InfiniteTrackManager(maxAniso);
    this.scene.add(this.infiniteManager.group);

    const biome = this.infiniteManager.getActiveBiome();
    this.infiniteRoadLabel = biome.roadLabel;
    this.infiniteGroundLabel = biome.groundLabel;
    this.infiniteAccentColor = biome.accentColor;
    this.infiniteSecondaryColor = biome.secondaryColor;
    this.applyBiomeAtmosphere(biome.groundTheme);

    this.vehicle.resetToSpawn(this.infiniteManager.getSpawnPoint());
    this.runElapsedSec = 0;
    this.recordedFrames = [];
    this.mode = 'playing';
    this.audio.startMusic();
    this.emitHud();
  }

  public endInfiniteRun(): void {
    if (!this.infiniteMode) return;
    this.mode = 'victory';
    this.clearInputs();
    this.audio.updateEngine(0, false, false);
    this.audio.playVictory();
    this.emitHud();
    this.callbacks.onInfiniteComplete(
      this.infiniteDistanceM,
      this.infiniteSector,
      this.vehicle.coinsCollected,
      this.vehicle.airborneSec,
    );
  }

  public restartLevel(): void {
    if (this.infiniteMode) {
      this.startInfiniteMode(Math.max(this.infiniteBestDistanceM, this.infiniteDistanceM));
      return;
    }
    if (!this.currentTrack) return;
    for (const cp of this.currentTrack.checkpoints) {
      cp.activated = false;
      cp.updateVisuals(false);
    }
    this.currentTrack.resetCoins();
    this.currentTrack.resetRings();
    this.vehicle.resetToSpawn(this.currentTrack.spawnPoint);
    this.runElapsedSec = 0;
    this.recordedFrames = [];
    this.ghostSampleAccum = 0;
    this.ghostCursor = 0;
    this.recordGhostFrame(0);
    this.mode = 'playing';
    this.emitHud();
  }

  public respawnAtCheckpoint(): void {
    if (this.mode !== 'playing') return;
    if (this.infiniteMode) {
      this.infiniteShields = Math.max(0, this.infiniteShields - 1);
      if (this.infiniteShields <= 0) {
        this.audio.playImpact();
        this.endInfiniteRun();
        return;
      }
    }
    this.vehicle.respawn(true);
    this.audio.playImpact();
    this.emitHud();
  }

  private setupGhostVisuals(ghostRun: GhostRun | null): void {
    if (this.ghostVisuals) {
      this.scene.remove(this.ghostVisuals.root);
      this.ghostVisuals.dispose();
      this.ghostVisuals = null;
    }
    this.activeGhostRun = ghostRun;
    this.ghostCursor = 0;
    if (ghostRun && ghostRun.frames.length >= 2) {
      this.ghostVisuals = createGhostVehicleMesh(ghostRun.chassisId, ghostRun.gliderId);
      this.ghostVisuals.root.visible = false;
      this.scene.add(this.ghostVisuals.root);
    }
  }

  private recordGhostFrame(timeSec: number): void {
    if (this.recordedFrames.length >= 4500) return;
    const p = this.vehicle.position;
    const q = this.vehicle.quaternion;
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const r3 = (n: number) => Math.round(n * 1000) / 1000;
    this.recordedFrames.push([
      r2(timeSec),
      r2(p.x),
      r2(p.y),
      r2(p.z),
      r3(q.x),
      r3(q.y),
      r3(q.z),
      r3(q.w),
    ]);
  }

  private updateGhostPlayback(timeSec: number): void {
    if (
      !this.ghostVisuals ||
      !this.ghostEnabled ||
      !this.activeGhostRun ||
      this.activeGhostRun.frames.length < 2
    ) {
      if (this.ghostVisuals) this.ghostVisuals.root.visible = false;
      return;
    }
    const frames = this.activeGhostRun.frames;
    const lastIdx = frames.length - 1;
    if (timeSec >= frames[lastIdx][0]) {
      this.ghostVisuals.root.visible = false;
      return;
    }

    while (this.ghostCursor < lastIdx - 1 && frames[this.ghostCursor + 1][0] <= timeSec) {
      this.ghostCursor += 1;
    }
    while (this.ghostCursor > 0 && frames[this.ghostCursor][0] > timeSec) {
      this.ghostCursor -= 1;
    }

    const f0 = frames[this.ghostCursor];
    const f1 = frames[Math.min(lastIdx, this.ghostCursor + 1)];
    const span = Math.max(0.0001, f1[0] - f0[0]);
    const alpha = Math.max(0, Math.min(1, (timeSec - f0[0]) / span));

    _ghostPosA.set(f0[1], f0[2], f0[3]);
    _ghostPosB.set(f1[1], f1[2], f1[3]);
    _ghostQuatA.set(f0[4], f0[5], f0[6], f0[7]);
    _ghostQuatB.set(f1[4], f1[5], f1[6], f1[7]);

    this.ghostVisuals.root.position.lerpVectors(_ghostPosA, _ghostPosB, alpha);
    this.ghostVisuals.root.quaternion.slerpQuaternions(_ghostQuatA, _ghostQuatB, alpha);
    this.ghostVisuals.root.visible = true;
  }

  private applyBiomeAtmosphere(groundTheme: GroundTheme): void {
    const themeColors = getAbyssThemeColors(groundTheme);
    drawAbyssGridCanvas(this.abyssGridCanvas, groundTheme);
    this.abyssGridTex.needsUpdate = true;
    (this.scene.background as THREE.Color).set(themeColors.bg);
    (this.scene.fog as THREE.FogExp2).color.set(themeColors.bg);
    this.sunMat.color.setHex(themeColors.sunHex);
  }

  private resetEnvironmentalEvent(restoreColors = true): void {
    this.activeEventType = null;
    this.eventRemainingSec = 0;
    this.eventCooldownSec = 8.5;
    this.envParticlesAccum = 0;
    this.horizonGroup.rotation.z = 0;
    this.rimLight.color.setHex(0xff007f);
    if (restoreColors && this.infiniteManager) {
      this.infiniteManager.restoreChunkColors();
      this.applyBiomeAtmosphere(this.infiniteManager.getActiveBiome().groundTheme);
    }
  }

  private getActiveEventHud(): EnvironmentalEventHud | null {
    if (!this.activeEventType || this.eventRemainingSec <= 0) return null;
    switch (this.activeEventType) {
      case 'neon-storm':
        return {
          type: 'neon-storm',
          label: 'Neon Storm Pulse',
          description: 'Chromatic surge · High-voltage rails',
          remainingSec: this.eventRemainingSec,
          durationSec: this.eventDurationSec,
          accentColor: '#00f3ff',
        };
      case 'gravity-flux':
        return {
          type: 'gravity-flux',
          label: 'Low-G Ion Flux',
          description: '0.56x Air Gravity · High Jump Lift',
          remainingSec: this.eventRemainingSec,
          durationSec: this.eventDurationSec,
          accentColor: '#9d00ff',
        };
      case 'solar-overdrive':
        return {
          type: 'solar-overdrive',
          label: 'Solar Overdrive',
          description: '+43 KM/H Top Speed · 2.2x Nitro Regen',
          remainingSec: this.eventRemainingSec,
          durationSec: this.eventDurationSec,
          accentColor: '#ffaa00',
        };
    }
  }

  private loadLevel(level: LevelDefinition, bestGhost: GhostRun | null): void {
    this.infiniteMode = false;
    this.resetEnvironmentalEvent(false);
    if (this.infiniteManager) {
      this.scene.remove(this.infiniteManager.group);
      this.infiniteManager.dispose();
      this.infiniteManager = null;
    }

    this.currentLevel = level;
    if (this.currentTrack) {
      this.scene.remove(this.currentTrack.group);
      this.currentTrack.dispose();
      this.currentTrack = null;
    }

    // Update abyss ground & sky atmosphere for this level's ground theme
    this.applyBiomeAtmosphere(level.groundTheme);

    const maxAniso = Math.min(this.isCompactMobile ? 4 : 8, this.renderer.capabilities.getMaxAnisotropy());
    this.currentTrack = buildTrack(level, maxAniso);
    this.scene.add(this.currentTrack.group);
    this.vehicle.resetToSpawn(this.currentTrack.spawnPoint);
    this.setupGhostVisuals(bestGhost);
  }

  private spawnParticle(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    maxLife: number,
    scaleZ: number,
    colorHex: string,
  ): void {
    const idx = this.particleCursor;
    const slot = this.particles[idx];
    this.particleCursor = (this.particleCursor + 1) % this.particleCount;
    slot.active = true;
    slot.life = maxLife;
    slot.maxLife = maxLife;
    slot.pos.set(x, y, z);
    slot.vel.set(vx, vy, vz);
    slot.scaleZ = scaleZ;
    _pColor.set(colorHex);
    this.particleMesh.setColorAt(idx, _pColor);
    this.particleColorDirty = true;
  }

  private updateParticles(dt: number): void {
    let dirty = false;
    for (let i = 0; i < this.particleCount; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      dirty = true;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        _dummyObj.scale.set(0, 0, 0);
        _dummyObj.updateMatrix();
        this.particleMesh.setMatrixAt(i, _dummyObj.matrix);
        continue;
      }
      p.pos.addScaledVector(p.vel, dt);
      const ratio = p.life / p.maxLife;
      _dummyObj.position.copy(p.pos);
      _dummyObj.quaternion.copy(this.vehicle.quaternion);
      _dummyObj.scale.set(ratio, ratio, p.scaleZ * (0.5 + ratio));
      _dummyObj.updateMatrix();
      this.particleMesh.setMatrixAt(i, _dummyObj.matrix);
    }
    if (dirty) {
      this.particleMesh.instanceMatrix.needsUpdate = true;
    }
    if (this.particleColorDirty && this.particleMesh.instanceColor) {
      this.particleMesh.instanceColor.needsUpdate = true;
      this.particleColorDirty = false;
    }
  }

  private emitHud(): void {
    this.callbacks.onHudUpdate({
      speedKmh: this.vehicle.getSpeedKmh(),
      nitro: Math.round(this.vehicle.nitro),
      elapsedSec: this.runElapsedSec,
      checkpointIndex: this.vehicle.currentCheckpoint,
      totalCheckpoints: this.currentTrack ? this.currentTrack.checkpoints.length : 0,
      coins: this.vehicle.coinsCollected,
      totalTrackCoins: this.currentTrack ? this.currentTrack.coins.length : 0,
      airborne: this.vehicle.airborne,
      gliding: this.vehicle.gliding,
      drifting: this.vehicle.drifting,
      boosting: this.vehicle.boosting,
      ghostActive:
        !this.infiniteMode &&
        this.ghostEnabled &&
        Boolean(this.activeGhostRun && this.activeGhostRun.frames.length >= 2),
      respawns: this.vehicle.respawns,
      lastCheckpointFlash: this.vehicle.lastCheckpointFlash,
      hazardHitFlash: this.vehicle.hazardHitFlash,
      infiniteStats: this.infiniteMode
        ? {
            distanceM: this.infiniteDistanceM,
            bestDistanceM: Math.max(this.infiniteBestDistanceM, this.infiniteDistanceM),
            sector: this.infiniteSector,
            roadLabel: this.infiniteRoadLabel,
            groundLabel: this.infiniteGroundLabel,
            shields: this.infiniteShields,
            maxShields: this.infiniteMaxShields,
            lastRingFlash: this.vehicle.lastRingFlash,
            lastSectorFlash: this.lastSectorFlash,
            activeEvent: this.getActiveEventHud(),
          }
        : null,
    });
  }

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (!gl || typeof gl.fenceSync !== 'function') {
      this.frameId = window.setTimeout(cb, 80);
      return;
    }
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) {
        if (sync) gl.deleteSync(sync);
        return;
      }
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private tick = () => {
    if (this.disposed) return;

    const rawDelta = this.clock.getDelta();
    const dt = Math.min(rawDelta, 0.05);
    const elapsed = this.clock.elapsedTime;

    // Auto-quality frame-rate guard on GPU devices when in 'auto' mode
    if (!this.isSoftwareGl && this.qualityMode === 'auto' && this.useBloom) {
      if (rawDelta > 0.032) {
        this.slowFrameCount += 1;
        if (this.slowFrameCount > 90) {
          this.useBloom = false;
          this.renderer.setPixelRatio(1);
          this.slowFrameCount = 0;
        }
      } else if (this.slowFrameCount > 0) {
        this.slowFrameCount -= 1;
      }
    }

    if (this.infiniteMode && this.infiniteManager) {
      this.infiniteManager.update(elapsed);
    } else if (this.currentTrack) {
      this.currentTrack.update(elapsed);
    }

    const activeTrack: TrackQueryTarget | null = this.infiniteMode
      ? this.infiniteManager
      : this.currentTrack;

    if (this.mode === 'playing' && activeTrack) {
      this.runElapsedSec += dt;

      if (this.infiniteMode && this.infiniteManager) {
        if (this.activeEventType) {
          this.eventRemainingSec -= dt;
          if (this.eventRemainingSec <= 0) {
            this.activeEventType = null;
            this.eventRemainingSec = 0;
            this.eventCooldownSec = 11 + Math.random() * 3.5;
            this.horizonGroup.rotation.z = 0;
            this.rimLight.color.setHex(0xff007f);
            this.infiniteManager.restoreChunkColors();
            this.applyBiomeAtmosphere(this.infiniteManager.getActiveBiome().groundTheme);
          }
        } else {
          this.eventCooldownSec -= dt;
          if (this.eventCooldownSec <= 0) {
            const eventPool: EnvironmentalEventType[] = [
              'neon-storm',
              'gravity-flux',
              'solar-overdrive',
            ];
            const candidates = eventPool.filter((ev) => ev !== this.lastEventType);
            const nextType = candidates[Math.floor(Math.random() * candidates.length)];
            this.activeEventType = nextType;
            this.lastEventType = nextType;
            this.eventRemainingSec = this.eventDurationSec;
            this.audio.playEventPulse(nextType);
          }
        }
      }

      const envMod =
        this.infiniteMode && this.activeEventType === 'gravity-flux'
          ? { gravityScale: 0.56 }
          : this.infiniteMode && this.activeEventType === 'solar-overdrive'
            ? { speedBonus: 12, nitroRegenMult: 2.2 }
            : undefined;

      const { finished, fellIntoAbyss, fatalCrash } = this.vehicle.step(
        dt,
        this.input,
        activeTrack,
        this.audio,
        envMod,
      );

      if (fatalCrash) {
        // Spawn dramatic explosion sparks at vehicle impact site
        for (let k = 0; k < 36; k++) {
          const ang = (k / 36) * Math.PI * 2 + Math.random() * 0.2;
          const spd = 12 + Math.random() * 24;
          const color = k % 3 === 0 ? '#ff0055' : k % 3 === 1 ? '#ffaa00' : '#ffffff';
          this.spawnParticle(
            this.vehicle.position.x + (Math.random() - 0.5) * 1.4,
            this.vehicle.position.y + 0.8 + Math.random() * 0.8,
            this.vehicle.position.z + (Math.random() - 0.5) * 1.4,
            Math.cos(ang) * spd,
            6 + Math.random() * 14,
            Math.sin(ang) * spd,
            0.55 + Math.random() * 0.35,
            1.6,
            color,
          );
        }
        if (this.ghostVisuals) {
          this.ghostVisuals.root.visible = false;
        }
        this.mode = 'victory';
        this.clearInputs();
        this.audio.updateEngine(0, false, false);
        this.emitHud();
        this.callbacks.onCrashGameOver(
          fatalCrash,
          this.vehicle.coinsCollected,
          this.runElapsedSec,
          this.infiniteMode
            ? {
                distanceM: this.infiniteDistanceM,
                sector: this.infiniteSector,
                airborneSec: this.vehicle.airborneSec,
              }
            : null,
        );
      } else if (fellIntoAbyss) {
        if (this.infiniteMode) {
          this.infiniteShields = Math.max(0, this.infiniteShields - 1);
          this.audio.playImpact();
          if (this.infiniteShields > 0) {
            this.vehicle.respawn(true);
            this.emitHud();
          } else {
            this.endInfiniteRun();
          }
        } else {
          this.vehicle.respawn(true);
          this.audio.playImpact();
        }
      }

      if (this.mode === 'playing' && this.infiniteMode && this.infiniteManager) {
        const stream = this.infiniteManager.ensureChunksAround(this.vehicle.position);
        this.infiniteDistanceM = stream.distanceM;
        if (stream.sectorChanged && stream.activeSector > this.infiniteSector) {
          this.infiniteSector = stream.activeSector;
          this.lastSectorFlash = performance.now();
          // Restore +1 shield every 2 sectors cleared
          if (
            this.infiniteSector % 2 === 1 &&
            this.infiniteShields < this.infiniteMaxShields
          ) {
            this.infiniteShields += 1;
          }
          this.infiniteRoadLabel = stream.activeBiome.roadLabel;
          this.infiniteGroundLabel = stream.activeBiome.groundLabel;
          this.infiniteAccentColor = stream.activeBiome.accentColor;
          this.infiniteSecondaryColor = stream.activeBiome.secondaryColor;
          this.applyBiomeAtmosphere(stream.activeBiome.groundTheme);
        }

        // Apply active environmental event lighting, color pulses & ambient particles
        if (this.activeEventType) {
          this.envParticlesAccum += dt;
          const emitEnvParticles = this.qualityMode !== 'eco' && this.envParticlesAccum >= 0.04;
          if (emitEnvParticles) {
            this.envParticlesAccum = 0;
          }

          if (this.activeEventType === 'neon-storm') {
            const hueA = (elapsed * 0.28) % 1;
            const hueB = (hueA + 0.42) % 1;
            _eventColorA.setHSL(hueA, 0.96, 0.56);
            _eventColorB.setHSL(hueB, 0.96, 0.56);
            const pulse = 1.05 + 0.48 * Math.sin(elapsed * 9.5);
            this.infiniteManager.applyNeonOverride(_eventColorA, _eventColorB, pulse);
            this.sunMat.color.copy(_eventColorA);
            this.rimLight.color.copy(_eventColorB);
            _eventBgColor.setHSL(hueA, 0.6, 0.045);
            (this.scene.background as THREE.Color).copy(_eventBgColor);
            (this.scene.fog as THREE.FogExp2).color.copy(_eventBgColor);
            if (emitEnvParticles) {
              const pHex = `#${_eventColorA.getHexString()}`;
              this.spawnParticle(
                this.vehicle.position.x + (Math.random() - 0.5) * 28,
                this.vehicle.position.y + 8 + Math.random() * 8,
                this.vehicle.position.z + (Math.random() - 0.5) * 28,
                -8,
                -26,
                -10,
                0.42,
                2.8,
                pHex,
              );
            }
          } else if (this.activeEventType === 'gravity-flux') {
            _eventColorA.setHex(0x9d00ff);
            _eventColorB.setHex(0x00f3ff);
            this.infiniteManager.applyNeonOverride(
              _eventColorA,
              _eventColorB,
              1.25 + 0.2 * Math.sin(elapsed * 6),
            );
            this.sunMat.color.copy(_eventColorA);
            this.rimLight.color.copy(_eventColorB);
            this.horizonGroup.rotation.z = Math.sin(elapsed * 1.15) * 0.16;
            if (emitEnvParticles) {
              this.spawnParticle(
                this.vehicle.position.x + (Math.random() - 0.5) * 26,
                this.vehicle.position.y - 2 + Math.random() * 4,
                this.vehicle.position.z + (Math.random() - 0.5) * 26,
                (Math.random() - 0.5) * 2,
                14 + Math.random() * 8,
                (Math.random() - 0.5) * 2,
                0.55,
                1.9,
                Math.random() < 0.5 ? '#00f3ff' : '#9d00ff',
              );
            }
          } else if (this.activeEventType === 'solar-overdrive') {
            _eventColorA.setHex(0xffaa00);
            _eventColorB.setHex(0xff0055);
            this.infiniteManager.applyNeonOverride(
              _eventColorA,
              _eventColorB,
              1.3 + 0.25 * Math.sin(elapsed * 8),
            );
            this.sunMat.color.copy(_eventColorA);
            this.rimLight.color.copy(_eventColorB);
            if (emitEnvParticles) {
              this.spawnParticle(
                this.vehicle.position.x + (Math.random() - 0.5) * 24,
                this.vehicle.position.y + 1 + Math.random() * 6,
                this.vehicle.position.z + (Math.random() - 0.5) * 24,
                (Math.random() - 0.5) * 5,
                2 + Math.random() * 4,
                18,
                0.32,
                3.2,
                Math.random() < 0.5 ? '#ffaa00' : '#ff0055',
              );
            }
          }
        }
      }

      // Ghost sample recording & replay (fixed circuits)
      if (this.mode === 'playing' && !this.infiniteMode) {
        this.ghostSampleAccum += dt;
        if (this.ghostSampleAccum >= 0.085) {
          this.ghostSampleAccum = 0;
          this.recordGhostFrame(this.runElapsedSec);
        }
        this.updateGhostPlayback(this.runElapsedSec);
      }

      // Engine sound tied to speed (remains silent if run just ended on crash)
      if (this.mode === 'playing') {
        this.audio.updateEngine(this.vehicle.getSpeed() / 70, this.vehicle.boosting, true);
      }

      // Spawn exhaust / speed-line particles when boosting or drifting
      _carFwd.set(0, 0, -1).applyQuaternion(this.vehicle.quaternion);
      _carUp.set(0, 1, 0).applyQuaternion(this.vehicle.quaternion);
      _carRight.set(1, 0, 0).applyQuaternion(this.vehicle.quaternion);

      const activeAccent = this.infiniteMode
        ? this.infiniteAccentColor
        : this.currentLevel.accentColor;
      const activeSecondary = this.infiniteMode
        ? this.infiniteSecondaryColor
        : this.currentLevel.secondaryColor;

      const emitBoostLines = this.qualityMode !== 'eco';
      if (this.vehicle.boosting) {
        const exhaustCount = emitBoostLines ? 2 : 1;
        for (let k = 0; k < exhaustCount; k++) {
          const px = this.vehicle.position.x - _carFwd.x * 2.6 + (Math.random() - 0.5) * 1.1;
          const py = this.vehicle.position.y + 0.55 + (Math.random() - 0.5) * 0.4;
          const pz = this.vehicle.position.z - _carFwd.z * 2.6 + (Math.random() - 0.5) * 1.1;
          this.spawnParticle(
            px,
            py,
            pz,
            -_carFwd.x * 28,
            -_carFwd.y * 28,
            -_carFwd.z * 28,
            0.28,
            3.6,
            activeAccent,
          );
        }
        if (emitBoostLines) {
          // Peripheral wind speed streaks around camera
          const sx =
            this.vehicle.position.x +
            _carFwd.x * 16 +
            _carRight.x * (Math.random() - 0.5) * 18;
          const sy = this.vehicle.position.y + 2.5 + (Math.random() - 0.5) * 7;
          const sz =
            this.vehicle.position.z +
            _carFwd.z * 16 +
            _carRight.z * (Math.random() - 0.5) * 18;
          this.spawnParticle(
            sx,
            sy,
            sz,
            -_carFwd.x * 58,
            -_carFwd.y * 58,
            -_carFwd.z * 58,
            0.24,
            5.2,
            '#ffffff',
          );
        }
      } else if (this.vehicle.drifting && emitBoostLines) {
        const px = this.vehicle.position.x - _carFwd.x * 1.6 + (Math.random() - 0.5) * 1.8;
        const py = this.vehicle.position.y + 0.25;
        const pz = this.vehicle.position.z - _carFwd.z * 1.6 + (Math.random() - 0.5) * 1.8;
        this.spawnParticle(
          px,
          py,
          pz,
          -_carFwd.x * 8,
          1.2,
          -_carFwd.z * 8,
          0.22,
          1.4,
          activeSecondary,
        );
      }

      // Smooth damped chase camera (follows car local up through loops!)
      const followDist = this.vehicle.boosting ? 10.6 : 9.4;
      const followHeight = 3.7;
      _camTargetPos
        .copy(this.vehicle.position)
        .addScaledVector(_carFwd, -followDist)
        .addScaledVector(_carUp, followHeight);

      this.camera.position.lerp(_camTargetPos, 1 - Math.exp(-10 * dt));
      this.camera.up.lerp(_carUp, 1 - Math.exp(-8 * dt)).normalize();
      _camLookAt.copy(this.vehicle.position).addScaledVector(_carFwd, 8);
      this.camera.lookAt(_camLookAt);

      // Dynamic FOV kick with speed / boost + portrait phone FOV compensation
      const portraitBoost = this.camera.aspect < 1 ? Math.min(20, (1 - this.camera.aspect) * 32) : 0;
      const targetFov =
        70 +
        portraitBoost +
        Math.min(16, (this.vehicle.getSpeed() / 85) * 14) +
        (this.vehicle.boosting ? 6 : 0);
      if (Math.abs(this.camera.fov - targetFov) > 0.05) {
        this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 7, dt);
        this.camera.updateProjectionMatrix();
      }

      // Keep abyss grid, directional shadow frustum, & distant horizon anchored to car
      const snapX = Math.floor(this.vehicle.position.x / 20) * 20;
      const snapZ = Math.floor(this.vehicle.position.z / 20) * 20;
      this.abyssGridMesh.position.set(snapX, -72, snapZ);
      this.horizonGroup.position.set(this.vehicle.position.x, 0, this.vehicle.position.z);

      if (this.keyLight.castShadow) {
        const sx = Math.round(this.vehicle.position.x / 4) * 4;
        const sy = Math.round(this.vehicle.position.y / 4) * 4;
        const sz = Math.round(this.vehicle.position.z / 4) * 4;
        this.keyLight.target.position.set(sx, sy, sz);
        this.keyLight.position.set(sx + 45, sy + 95, sz + 35);
      }

      this.hudEmitAccum += dt;
      if (this.hudEmitAccum >= 0.05) {
        this.hudEmitAccum = 0;
        this.emitHud();
      }

      if (finished && !this.infiniteMode) {
        this.recordGhostFrame(this.runElapsedSec);
        if (this.ghostVisuals) {
          this.ghostVisuals.root.visible = false;
        }
        this.mode = 'victory';
        this.audio.updateEngine(0, false, false);
        this.audio.playVictory();
        this.emitHud();
        this.callbacks.onLevelComplete(
          Math.round(this.runElapsedSec * 1000),
          this.vehicle.respawns,
          this.vehicle.coinsCollected,
          this.vehicle.airborneSec,
          {
            chassisId: this.currentGarage.chassisId,
            gliderId: this.currentGarage.gliderId,
            frames: this.recordedFrames.slice(),
          },
        );
      }
    } else {
      // Showcase auto-orbiting camera around the parked neon car
      if (this.ghostVisuals) {
        this.ghostVisuals.root.visible = false;
      }
      this.vehicle.updateShowcaseGlider(dt, this.mode === 'garage');
      this.audio.updateEngine(0, false, false);
      this.orbitAngle += dt * 0.38;
      const isPortrait = this.camera.aspect < 1;
      const orbitR = (this.mode === 'garage' ? 6.4 : 7.8) + (isPortrait ? 2.4 : 0);
      const orbitH = (this.mode === 'garage' ? 2.3 : 2.9) + (isPortrait ? 0.6 : 0);

      _camTargetPos.set(
        this.vehicle.position.x + Math.sin(this.orbitAngle) * orbitR,
        this.vehicle.position.y + orbitH,
        this.vehicle.position.z + Math.cos(this.orbitAngle) * orbitR,
      );
      this.camera.position.lerp(_camTargetPos, 1 - Math.exp(-5 * dt));
      this.camera.up.set(0, 1, 0);
      _camLookAt.set(
        this.vehicle.position.x,
        this.vehicle.position.y + (isPortrait && this.mode === 'garage' ? 0.1 : 0.75),
        this.vehicle.position.z,
      );
      this.camera.lookAt(_camLookAt);
      const showcaseFov = isPortrait ? 68 : 58;
      if (Math.abs(this.camera.fov - showcaseFov) > 0.1) {
        this.camera.fov = THREE.MathUtils.damp(this.camera.fov, showcaseFov, 5, dt);
        this.camera.updateProjectionMatrix();
      }
      this.abyssGridMesh.position.set(0, -72, 0);
      this.horizonGroup.position.set(0, 0, 0);
      if (this.keyLight.castShadow) {
        this.keyLight.target.position.copy(this.vehicle.position);
        this.keyLight.position.set(
          this.vehicle.position.x + 45,
          this.vehicle.position.y + 95,
          this.vehicle.position.z + 35,
        );
      }
    }

    this.updateParticles(dt);

    if (this.isSoftwareGl || !this.useBloom || !this.composer) {
      this.renderer.render(this.scene, this.camera);
    } else {
      this.composer.render();
    }

    if (this.isSoftwareGl) {
      this.afterDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  };

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    window.clearTimeout(this.frameId);

    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('orientationchange', this.handleResize);
    window.visualViewport?.removeEventListener('resize', this.handleResize);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleWindowBlur);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.renderer.domElement.removeEventListener('webglcontextlost', this.handleContextLost);
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.handleContextRestored);

    this.audio.dispose();
    if (this.currentTrack) {
      this.currentTrack.dispose();
    }
    if (this.infiniteManager) {
      this.infiniteManager.dispose();
    }
    if (this.ghostVisuals) {
      this.ghostVisuals.dispose();
    }
    this.vehicle.visuals.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.composer?.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
