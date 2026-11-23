import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { AudioSynth } from './AudioSynth';
import { LEVELS } from './levels';
import { buildTrack, BuiltTrack } from './TrackBuilder';
import {
  GarageConfig,
  GhostFrame,
  GhostRun,
  GroundTheme,
  HudTelemetry,
  InputState,
  LevelDefinition,
  ScreenMode,
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
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;

  private vehicle: VehicleController;
  private currentGarage: GarageConfig;
  private currentTrack: BuiltTrack | null = null;
  private currentLevel: LevelDefinition = LEVELS[0];

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
    callbacks: EngineCallbacks,
  ) {
    this.container = container;
    this.callbacks = callbacks;
    this.currentGarage = initialGarage;
    this.ghostEnabled = initialGhostEnabled;
    this.audio = new AudioSynth(initialMuted);

    this.isSoftwareGl = detectSoftwareWebGL();
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
    const keyLight = new THREE.DirectionalLight(0xe0f2fe, 1.5);
    keyLight.position.set(45, 95, 35);
    if (!this.isSoftwareGl) {
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(1024, 1024);
      keyLight.shadow.camera.near = 10;
      keyLight.shadow.camera.far = 260;
      keyLight.shadow.camera.left = -80;
      keyLight.shadow.camera.right = 80;
      keyLight.shadow.camera.top = 80;
      keyLight.shadow.camera.bottom = -80;
      keyLight.shadow.bias = -0.0005;
    }
    const rimLight = new THREE.DirectionalLight(0xff007f, 1.15);
    rimLight.position.set(-50, 35, -70);
    this.scene.add(hemi, keyLight, rimLight);

    // Abyss Cyber Grid Floor
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
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

    // Post-processing UnrealBloomPass (GPU only; skipped on software WebGL)
    if (!this.isSoftwareGl) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloomPass = new UnrealBloomPass(
        new THREE.Vector2(width, height),
        0.68, // crisp neon glow strength
        0.45, // radius
        0.72, // threshold
      );
      this.composer.addPass(this.bloomPass);
    }

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
    this.renderer.domElement.addEventListener('webglcontextlost', this.handleContextLost);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.handleContextRestored);

    this.clock.start();
    this.tick();
  }

  private handleContextLost = (e: Event) => {
    e.preventDefault();
    this.callbacks.onContextLost(true);
  };

  private handleContextRestored = () => {
    this.callbacks.onContextLost(false);
  };

  private handleResize = () => {
    if (this.disposed) return;
    const width = Math.max(1, this.container.clientWidth || window.innerWidth);
    const height = Math.max(1, this.container.clientHeight || window.innerHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    if (this.composer) {
      this.composer.setSize(width, height);
    }
    if (this.bloomPass) {
      this.bloomPass.resolution.set(width, height);
    }
  };

  private handleKeyDown = (e: KeyboardEvent) => {
    if (e.code === 'Escape') {
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

  public restartLevel(): void {
    if (!this.currentTrack) return;
    for (const cp of this.currentTrack.checkpoints) {
      cp.activated = false;
      cp.updateVisuals(false);
    }
    for (const coin of this.currentTrack.coins) {
      coin.collected = false;
      coin.mesh.visible = true;
    }
    this.vehicle.resetToTrack(this.currentTrack);
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
    this.vehicle.respawn(true);
    this.audio.playImpact();
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

  private loadLevel(level: LevelDefinition, bestGhost: GhostRun | null): void {
    this.currentLevel = level;
    if (this.currentTrack) {
      this.scene.remove(this.currentTrack.group);
      this.currentTrack.dispose();
      this.currentTrack = null;
    }

    // Update abyss ground & sky atmosphere for this level's ground theme
    const themeColors = getAbyssThemeColors(level.groundTheme);
    drawAbyssGridCanvas(this.abyssGridCanvas, level.groundTheme);
    this.abyssGridTex.needsUpdate = true;
    this.scene.background = new THREE.Color(themeColors.bg);
    this.scene.fog = new THREE.FogExp2(themeColors.bg, 0.0021);
    this.sunMat.color.setHex(themeColors.sunHex);

    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.currentTrack = buildTrack(level, maxAniso);
    this.scene.add(this.currentTrack.group);
    this.vehicle.resetToTrack(this.currentTrack);
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
    if (this.particleMesh.instanceColor) {
      this.particleMesh.instanceColor.needsUpdate = true;
    }
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
        this.ghostEnabled &&
        Boolean(this.activeGhostRun && this.activeGhostRun.frames.length >= 2),
      respawns: this.vehicle.respawns,
      lastCheckpointFlash: this.vehicle.lastCheckpointFlash,
      hazardHitFlash: this.vehicle.hazardHitFlash,
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

    const dt = Math.min(this.clock.getDelta(), 0.05);
    const elapsed = this.clock.elapsedTime;

    if (this.currentTrack) {
      this.currentTrack.update(elapsed);
    }

    if (this.mode === 'playing' && this.currentTrack) {
      this.runElapsedSec += dt;
      const { finished } = this.vehicle.step(dt, this.input, this.currentTrack, this.audio);

      // Ghost sample recording & replay
      this.ghostSampleAccum += dt;
      if (this.ghostSampleAccum >= 0.085) {
        this.ghostSampleAccum = 0;
        this.recordGhostFrame(this.runElapsedSec);
      }
      this.updateGhostPlayback(this.runElapsedSec);

      // Engine sound tied to speed
      this.audio.updateEngine(this.vehicle.getSpeed() / 70, this.vehicle.boosting, true);

      // Spawn exhaust / speed-line particles when boosting or drifting
      _carFwd.set(0, 0, -1).applyQuaternion(this.vehicle.quaternion);
      _carUp.set(0, 1, 0).applyQuaternion(this.vehicle.quaternion);
      _carRight.set(1, 0, 0).applyQuaternion(this.vehicle.quaternion);

      if (this.vehicle.boosting) {
        for (let k = 0; k < 2; k++) {
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
            this.currentLevel.accentColor,
          );
        }
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
      } else if (this.vehicle.drifting) {
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
          this.currentLevel.secondaryColor,
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

      // Keep abyss grid & distant horizon anchored seamlessly to car XZ
      const snapX = Math.floor(this.vehicle.position.x / 20) * 20;
      const snapZ = Math.floor(this.vehicle.position.z / 20) * 20;
      this.abyssGridMesh.position.set(snapX, -72, snapZ);
      this.horizonGroup.position.set(this.vehicle.position.x, 0, this.vehicle.position.z);

      this.hudEmitAccum += dt;
      if (this.hudEmitAccum >= 0.05) {
        this.hudEmitAccum = 0;
        this.emitHud();
      }

      if (finished) {
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
    }

    this.updateParticles(dt);

    if (this.isSoftwareGl || !this.composer) {
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
    this.renderer.domElement.removeEventListener('webglcontextlost', this.handleContextLost);
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.handleContextRestored);

    this.audio.dispose();
    if (this.currentTrack) {
      this.currentTrack.dispose();
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
