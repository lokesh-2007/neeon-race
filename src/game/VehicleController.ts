import * as THREE from 'three';
import { AudioSynth } from './AudioSynth';
import {
  CHASSIS_SPECS,
  ChassisId,
  ColliderQuad,
  CrashEvent,
  FATAL_TRAP_SPEED_KMH,
  GarageConfig,
  GLIDER_SPECS,
  GliderId,
  InputState,
  TrackQueryTarget,
} from './types';

// Pre-allocated scratch math helpers (zero per-frame GC)
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _right = new THREE.Vector3();
const _push = new THREE.Vector3();
const _proj = new THREE.Vector3();
const _targetQuat = new THREE.Quaternion();
const _rotQuat = new THREE.Quaternion();
const _mat4 = new THREE.Matrix4();
const _candidates: ColliderQuad[] = [];

function pointInTriangle(
  p: THREE.Vector3,
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
): boolean {
  _v1.subVectors(c, a);
  _v2.subVectors(b, a);
  _v3.subVectors(p, a);

  const dot00 = _v1.dot(_v1);
  const dot01 = _v1.dot(_v2);
  const dot02 = _v1.dot(_v3);
  const dot11 = _v2.dot(_v2);
  const dot12 = _v2.dot(_v3);

  const denom = dot00 * dot11 - dot01 * dot01;
  if (Math.abs(denom) < 1e-6) return false;
  const invDenom = 1 / denom;
  const u = (dot11 * dot02 - dot01 * dot12) * invDenom;
  const v = (dot00 * dot12 - dot01 * dot02) * invDenom;
  return u >= -0.06 && v >= -0.06 && u + v <= 1.08;
}

export interface VehicleVisuals {
  root: THREE.Group;
  wheels: THREE.Object3D[];
  frontSteerPivots: THREE.Object3D[];
  flames: THREE.Mesh[];
  underglow: THREE.PointLight;
  updateGliderDeploy: (openFactor: number) => void;
  updateColors: (primaryHex: string, secondaryHex: string) => void;
  dispose: () => void;
}

export interface GhostVehicleVisuals {
  root: THREE.Group;
  updateGliderDeploy: (openFactor: number) => void;
  dispose: () => void;
}

function createGliderAttachment(
  gliderId: GliderId,
  primaryMat: THREE.Material,
  secondaryMat: THREE.Material,
  frameMat: THREE.Material,
  disposables: { dispose: () => void }[],
  isGhost = false,
): { group: THREE.Group; updateDeploy: (openFactor: number) => void } {
  const group = new THREE.Group();
  if (gliderId === 'none') {
    return { group, updateDeploy: () => {} };
  }

  if (gliderId === 'aero-wings') {
    // Retractable swept cyber-wings mounted on dorsal spine
    const spineGeo = new THREE.BoxGeometry(0.42, 0.14, 1.35);
    const wingBladeGeo = new THREE.BoxGeometry(2.45, 0.06, 0.85);
    const wingEdgeGeo = new THREE.BoxGeometry(2.5, 0.07, 0.1);
    disposables.push(spineGeo, wingBladeGeo, wingEdgeGeo);

    const spine = new THREE.Mesh(spineGeo, frameMat);
    spine.position.set(0, 1.15, 0.35);
    group.add(spine);

    const leftPivot = new THREE.Group();
    leftPivot.position.set(-0.18, 1.18, 0.28);
    const rightPivot = new THREE.Group();
    rightPivot.position.set(0.18, 1.18, 0.28);

    const bladeL = new THREE.Mesh(wingBladeGeo, frameMat);
    bladeL.position.set(-1.25, 0, 0.12);
    const edgeL = new THREE.Mesh(wingEdgeGeo, primaryMat);
    edgeL.position.set(-1.25, 0.01, -0.32);
    leftPivot.add(bladeL, edgeL);

    const bladeR = new THREE.Mesh(wingBladeGeo, frameMat);
    bladeR.position.set(1.25, 0, 0.12);
    const edgeR = new THREE.Mesh(wingEdgeGeo, primaryMat);
    edgeR.position.set(1.25, 0.01, -0.32);
    rightPivot.add(bladeR, edgeR);

    group.add(leftPivot, rightPivot);

    return {
      group,
      updateDeploy: (openFactor: number) => {
        const f = Math.max(0, Math.min(1, openFactor));
        group.visible = f > 0.03;
        leftPivot.rotation.y = THREE.MathUtils.lerp(1.18, 0.24, f);
        rightPivot.rotation.y = THREE.MathUtils.lerp(-1.18, -0.24, f);
        leftPivot.rotation.z = THREE.MathUtils.lerp(-0.1, 0.08, f);
        rightPivot.rotation.z = THREE.MathUtils.lerp(0.1, -0.08, f);
        const s = THREE.MathUtils.lerp(0.28, 1.0, f);
        leftPivot.scale.set(s, 1, s);
        rightPivot.scale.set(s, 1, s);
      },
    };
  }

  if (gliderId === 'plasma-kite') {
    // Overhead delta plasma sail with neon leading spars
    const pylonGeo = new THREE.CylinderGeometry(0.06, 0.08, 0.85, 8);
    const canopyGeo = new THREE.ConeGeometry(2.6, 2.3, 3);
    canopyGeo.rotateX(Math.PI / 2);
    canopyGeo.scale(1.18, 0.12, 1.0);
    const sparGeo = new THREE.BoxGeometry(0.08, 0.08, 2.65);
    disposables.push(pylonGeo, canopyGeo, sparGeo);

    const pylon = new THREE.Mesh(pylonGeo, frameMat);
    pylon.position.set(0, 1.42, 0.22);

    const kiteRoot = new THREE.Group();
    kiteRoot.position.set(0, 1.88, 0.15);

    const sailMat = isGhost
      ? primaryMat
      : new THREE.MeshBasicMaterial({
          color: 0x0b1628,
          transparent: true,
          opacity: 0.78,
          side: THREE.DoubleSide,
        });
    if (!isGhost) disposables.push(sailMat);

    const sail = new THREE.Mesh(canopyGeo, sailMat);
    sail.position.set(0, 0, 0.15);
    const centerSpar = new THREE.Mesh(sparGeo, secondaryMat);
    centerSpar.position.set(0, 0.04, 0.15);
    const leftSpar = new THREE.Mesh(sparGeo, primaryMat);
    leftSpar.position.set(-1.18, 0, 0.22);
    leftSpar.rotation.y = 0.68;
    const rightSpar = new THREE.Mesh(sparGeo, primaryMat);
    rightSpar.position.set(1.18, 0, 0.22);
    rightSpar.rotation.y = -0.68;

    kiteRoot.add(sail, centerSpar, leftSpar, rightSpar);
    group.add(pylon, kiteRoot);

    return {
      group,
      updateDeploy: (openFactor: number) => {
        const f = Math.max(0, Math.min(1, openFactor));
        group.visible = f > 0.03;
        pylon.scale.y = Math.max(0.05, f);
        kiteRoot.position.y = THREE.MathUtils.lerp(1.15, 1.92, f);
        const s = Math.max(0.08, f);
        kiteRoot.scale.set(s, 1, s);
      },
    };
  }

  // 'jet-pack' — Twin Jet Wing with glowing dorsal thrusters
  const wingGeo = new THREE.BoxGeometry(3.4, 0.08, 0.76);
  const podGeo = new THREE.CylinderGeometry(0.16, 0.2, 1.25, 10);
  podGeo.rotateX(Math.PI / 2);
  const ringGeo = new THREE.TorusGeometry(0.18, 0.04, 8, 16);
  disposables.push(wingGeo, podGeo, ringGeo);

  const jetRoot = new THREE.Group();
  jetRoot.position.set(0, 1.24, 0.55);

  const wing = new THREE.Mesh(wingGeo, frameMat);
  const leadEdge = new THREE.Mesh(new THREE.BoxGeometry(3.42, 0.09, 0.1), secondaryMat);
  leadEdge.position.set(0, 0, -0.36);
  disposables.push(leadEdge.geometry);
  jetRoot.add(wing, leadEdge);

  for (const xSide of [-0.72, 0.72]) {
    const pod = new THREE.Mesh(podGeo, frameMat);
    pod.position.set(xSide, 0.08, 0.08);
    const ring = new THREE.Mesh(ringGeo, primaryMat);
    ring.position.set(xSide, 0.08, 0.71);
    jetRoot.add(pod, ring);
  }

  group.add(jetRoot);

  return {
    group,
    updateDeploy: (openFactor: number) => {
      const f = Math.max(0, Math.min(1, openFactor));
      group.visible = f > 0.03;
      jetRoot.position.y = THREE.MathUtils.lerp(0.95, 1.26, f);
      jetRoot.scale.set(THREE.MathUtils.lerp(0.35, 1.0, f), 1, THREE.MathUtils.lerp(0.45, 1.0, f));
    },
  };
}

export function createVehicleMesh(
  chassisId: ChassisId,
  gliderId: GliderId,
  primaryHex: string,
  secondaryHex: string,
): VehicleVisuals {
  const root = new THREE.Group();
  const wheels: THREE.Object3D[] = [];
  const frontSteerPivots: THREE.Object3D[] = [];
  const flames: THREE.Mesh[] = [];
  const disposables: { dispose: () => void }[] = [];

  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: 0x101423,
    metalness: 0.72,
    roughness: 0.22,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08,
  });
  const carbonMat = new THREE.MeshStandardMaterial({
    color: 0x090b12,
    metalness: 0.25,
    roughness: 0.78,
  });
  const alloyMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    metalness: 0.92,
    roughness: 0.18,
  });
  const canopyMat = new THREE.MeshPhysicalMaterial({
    color: 0x050a18,
    metalness: 0.15,
    roughness: 0.08,
    clearcoat: 1.0,
    opacity: 0.88,
    transparent: true,
  });
  const primaryGlowMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(primaryHex),
    emissive: new THREE.Color(primaryHex),
    emissiveIntensity: 3.0,
    roughness: 0.2,
  });
  const secondaryGlowMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(secondaryHex),
    emissive: new THREE.Color(secondaryHex),
    emissiveIntensity: 2.8,
    roughness: 0.2,
  });
  const flameMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(primaryHex),
    transparent: true,
    opacity: 0.9,
  });
  disposables.push(bodyMat, carbonMat, alloyMat, canopyMat, primaryGlowMat, secondaryGlowMat, flameMat);

  // Chassis silhouette extrusion profile
  const sideProfile = new THREE.Shape();
  if (chassisId === 'vortex') {
    // Low-drag hypercar wedge
    sideProfile.moveTo(-2.35, 0.22);
    sideProfile.lineTo(2.3, 0.22);
    sideProfile.lineTo(2.45, 0.42);
    sideProfile.lineTo(1.2, 0.62);
    sideProfile.lineTo(0.25, 1.02);
    sideProfile.lineTo(-1.15, 0.98);
    sideProfile.lineTo(-2.2, 0.68);
    sideProfile.closePath();
  } else if (chassisId === 'apex') {
    // Muscular widebody drifter
    sideProfile.moveTo(-2.15, 0.24);
    sideProfile.lineTo(2.15, 0.24);
    sideProfile.lineTo(2.2, 0.56);
    sideProfile.lineTo(1.05, 0.7);
    sideProfile.lineTo(0.35, 1.12);
    sideProfile.lineTo(-1.05, 1.1);
    sideProfile.lineTo(-2.05, 0.78);
    sideProfile.closePath();
  } else if (chassisId === 'titan') {
    // High-clearance off-road stunt buggy
    sideProfile.moveTo(-2.05, 0.42);
    sideProfile.lineTo(2.05, 0.42);
    sideProfile.lineTo(2.1, 0.72);
    sideProfile.lineTo(0.9, 0.92);
    sideProfile.lineTo(0.25, 1.38);
    sideProfile.lineTo(-1.15, 1.36);
    sideProfile.lineTo(-1.95, 0.92);
    sideProfile.closePath();
  } else if (chassisId === 'phantom') {
    // Needle-nose stealth delta-wing racer
    sideProfile.moveTo(-2.35, 0.22);
    sideProfile.lineTo(2.45, 0.22);
    sideProfile.lineTo(2.6, 0.36);
    sideProfile.lineTo(1.3, 0.56);
    sideProfile.lineTo(0.1, 0.96);
    sideProfile.lineTo(-1.35, 0.92);
    sideProfile.lineTo(-2.3, 0.62);
    sideProfile.closePath();
  } else if (chassisId === 'spectre') {
    // Sculpted fastback grand tourer
    sideProfile.moveTo(-2.3, 0.24);
    sideProfile.lineTo(2.25, 0.24);
    sideProfile.lineTo(2.35, 0.5);
    sideProfile.lineTo(1.1, 0.72);
    sideProfile.lineTo(0.15, 1.14);
    sideProfile.lineTo(-1.6, 1.02);
    sideProfile.lineTo(-2.25, 0.74);
    sideProfile.closePath();
  } else if (chassisId === 'valkyrie') {
    // Narrow open-wheel cyber formula fuselage
    sideProfile.moveTo(-2.45, 0.22);
    sideProfile.lineTo(2.55, 0.2);
    sideProfile.lineTo(2.7, 0.34);
    sideProfile.lineTo(1.2, 0.52);
    sideProfile.lineTo(0.05, 0.88);
    sideProfile.lineTo(-1.55, 0.82);
    sideProfile.lineTo(-2.4, 0.56);
    sideProfile.closePath();
  } else if (chassisId === 'nemesis') {
    // Broad aggressive cyberpunk muscle coupe
    sideProfile.moveTo(-2.25, 0.26);
    sideProfile.lineTo(2.2, 0.26);
    sideProfile.lineTo(2.28, 0.66);
    sideProfile.lineTo(0.95, 0.74);
    sideProfile.lineTo(0.2, 1.18);
    sideProfile.lineTo(-1.15, 1.16);
    sideProfile.lineTo(-2.18, 0.82);
    sideProfile.closePath();
  } else if (chassisId === 'nova') {
    // Twin-turbine sleek aero prototype
    sideProfile.moveTo(-2.3, 0.24);
    sideProfile.lineTo(2.35, 0.24);
    sideProfile.lineTo(2.48, 0.44);
    sideProfile.lineTo(1.25, 0.64);
    sideProfile.lineTo(0.3, 1.04);
    sideProfile.lineTo(-1.3, 0.96);
    sideProfile.lineTo(-2.25, 0.68);
    sideProfile.closePath();
  } else if (chassisId === 'zenith') {
    // Long Le Mans endurance hypercar silhouette
    sideProfile.moveTo(-2.45, 0.22);
    sideProfile.lineTo(2.48, 0.22);
    sideProfile.lineTo(2.6, 0.44);
    sideProfile.lineTo(1.25, 0.66);
    sideProfile.lineTo(0.25, 1.08);
    sideProfile.lineTo(-1.45, 1.04);
    sideProfile.lineTo(-2.4, 0.66);
    sideProfile.closePath();
  } else {
    // Cyber Interceptor aggressive pursuit wedge
    sideProfile.moveTo(-2.25, 0.24);
    sideProfile.lineTo(2.25, 0.24);
    sideProfile.lineTo(2.35, 0.48);
    sideProfile.lineTo(1.15, 0.66);
    sideProfile.lineTo(0.2, 1.08);
    sideProfile.lineTo(-1.2, 1.04);
    sideProfile.lineTo(-2.15, 0.72);
    sideProfile.closePath();
  }

  const hullWidth =
    chassisId === 'apex' || chassisId === 'nemesis'
      ? 1.98
      : chassisId === 'titan'
        ? 1.66
        : chassisId === 'phantom'
          ? 1.56
          : chassisId === 'valkyrie'
            ? 1.08
            : chassisId === 'zenith'
              ? 1.88
              : 1.78;
  const hullGeo = new THREE.ExtrudeGeometry(sideProfile, {
    depth: hullWidth,
    bevelEnabled: true,
    bevelThickness: 0.1,
    bevelSize: 0.08,
    bevelSegments: 2,
  });
  hullGeo.center();
  // Orient side profile (+X nose -> -Z nose)
  hullGeo.rotateY(Math.PI / 2);
  disposables.push(hullGeo);

  const hullMesh = new THREE.Mesh(hullGeo, bodyMat);
  hullMesh.position.set(0, 0.65, 0);
  hullMesh.castShadow = true;
  root.add(hullMesh);

  // Lower carbon splitter & diffuser skirt
  const skirtGeo = new THREE.BoxGeometry(hullWidth + 0.34, 0.18, 4.55);
  disposables.push(skirtGeo);
  const skirt = new THREE.Mesh(skirtGeo, carbonMat);
  skirt.position.set(0, 0.3, 0.02);
  root.add(skirt);

  // Tinted glass canopy
  const canopyGeo = new THREE.BoxGeometry(hullWidth * 0.68, 0.34, 1.85);
  disposables.push(canopyGeo);
  const canopy = new THREE.Mesh(canopyGeo, canopyMat);
  canopy.position.set(0, 0.98, -0.08);
  root.add(canopy);

  // Neon side rocker trim strips (Primary)
  const trimGeo = new THREE.BoxGeometry(0.08, 0.09, 3.7);
  disposables.push(trimGeo);
  const leftTrim = new THREE.Mesh(trimGeo, primaryGlowMat);
  leftTrim.position.set(-(hullWidth * 0.5 + 0.14), 0.38, 0);
  const rightTrim = new THREE.Mesh(trimGeo, primaryGlowMat);
  rightTrim.position.set(hullWidth * 0.5 + 0.14, 0.38, 0);
  root.add(leftTrim, rightTrim);

  // Front LED visor headlight bar (Primary)
  const visorGeo = new THREE.BoxGeometry(hullWidth * 0.86, 0.08, 0.14);
  disposables.push(visorGeo);
  const visor = new THREE.Mesh(visorGeo, primaryGlowMat);
  visor.position.set(0, 0.52, -2.28);
  root.add(visor);

  // Rear taillight strip (Secondary)
  const tailGeo = new THREE.BoxGeometry(hullWidth * 0.88, 0.1, 0.14);
  disposables.push(tailGeo);
  const tailBar = new THREE.Mesh(tailGeo, secondaryGlowMat);
  tailBar.position.set(0, 0.7, 2.26);
  root.add(tailBar);

  // Chassis-specific aero wings, cages, and blades
  if (chassisId === 'vortex') {
    const wingDeckGeo = new THREE.BoxGeometry(2.3, 0.08, 0.55);
    const pylonGeo = new THREE.BoxGeometry(0.1, 0.45, 0.45);
    const wingTipGeo = new THREE.BoxGeometry(0.08, 0.24, 0.62);
    disposables.push(wingDeckGeo, pylonGeo, wingTipGeo);

    const wingDeck = new THREE.Mesh(wingDeckGeo, carbonMat);
    wingDeck.position.set(0, 1.28, 2.02);
    const pL = new THREE.Mesh(pylonGeo, alloyMat);
    pL.position.set(-0.58, 1.05, 1.98);
    const pR = new THREE.Mesh(pylonGeo, alloyMat);
    pR.position.set(0.58, 1.05, 1.98);
    const tipL = new THREE.Mesh(wingTipGeo, secondaryGlowMat);
    tipL.position.set(-1.16, 1.26, 2.02);
    const tipR = new THREE.Mesh(wingTipGeo, secondaryGlowMat);
    tipR.position.set(1.16, 1.26, 2.02);
    root.add(wingDeck, pL, pR, tipL, tipR);
  } else if (chassisId === 'apex') {
    const wingGeo = new THREE.BoxGeometry(2.15, 0.09, 0.48);
    const finGeo = new THREE.BoxGeometry(0.1, 0.36, 0.52);
    disposables.push(wingGeo, finGeo);
    const wing = new THREE.Mesh(wingGeo, bodyMat);
    wing.position.set(0, 1.22, 1.96);
    const finL = new THREE.Mesh(finGeo, secondaryGlowMat);
    finL.position.set(-1.05, 1.12, 1.96);
    const finR = new THREE.Mesh(finGeo, secondaryGlowMat);
    finR.position.set(1.05, 1.12, 1.96);
    root.add(wing, finL, finR);
  } else if (chassisId === 'titan') {
    // Tubular neon roll-cage & roof LED lightbar
    const cageBarGeo = new THREE.CylinderGeometry(0.055, 0.055, 2.3, 8);
    cageBarGeo.rotateX(Math.PI / 2);
    const lightbarGeo = new THREE.BoxGeometry(1.35, 0.14, 0.24);
    const bullbarGeo = new THREE.BoxGeometry(1.75, 0.14, 0.14);
    disposables.push(cageBarGeo, lightbarGeo, bullbarGeo);

    for (const xSide of [-0.72, 0.72]) {
      const bar = new THREE.Mesh(cageBarGeo, secondaryGlowMat);
      bar.position.set(xSide, 1.38, 0.45);
      bar.rotation.x = 0.22;
      root.add(bar);
    }
    const lightbar = new THREE.Mesh(lightbarGeo, primaryGlowMat);
    lightbar.position.set(0, 1.5, -0.35);
    const bullbar = new THREE.Mesh(bullbarGeo, alloyMat);
    bullbar.position.set(0, 0.58, -2.22);
    root.add(lightbar, bullbar);
  } else if (chassisId === 'phantom') {
    // Swept delta side-wings + dorsal blade fin
    const deltaWingGeo = new THREE.BoxGeometry(2.75, 0.07, 1.25);
    const dorsalGeo = new THREE.BoxGeometry(0.08, 0.58, 1.45);
    const bladeEdgeGeo = new THREE.BoxGeometry(0.08, 0.08, 1.35);
    disposables.push(deltaWingGeo, dorsalGeo, bladeEdgeGeo);

    const deltaWing = new THREE.Mesh(deltaWingGeo, carbonMat);
    deltaWing.position.set(0, 0.54, 0.75);
    const dorsal = new THREE.Mesh(dorsalGeo, bodyMat);
    dorsal.position.set(0, 1.24, 1.25);
    const edgeL = new THREE.Mesh(bladeEdgeGeo, secondaryGlowMat);
    edgeL.position.set(-1.38, 0.54, 0.75);
    const edgeR = new THREE.Mesh(bladeEdgeGeo, secondaryGlowMat);
    edgeR.position.set(1.38, 0.54, 0.75);
    root.add(deltaWing, dorsal, edgeL, edgeR);
  } else if (chassisId === 'spectre') {
    // Wide ducktail spoiler + twin hood neon intake strips
    const duckGeo = new THREE.BoxGeometry(1.96, 0.16, 0.42);
    const hoodStripGeo = new THREE.BoxGeometry(0.1, 0.05, 1.45);
    disposables.push(duckGeo, hoodStripGeo);

    const duck = new THREE.Mesh(duckGeo, bodyMat);
    duck.position.set(0, 1.12, 2.02);
    duck.rotation.x = -0.35;
    const stripL = new THREE.Mesh(hoodStripGeo, secondaryGlowMat);
    stripL.position.set(-0.42, 0.76, -1.25);
    stripL.rotation.x = 0.18;
    const stripR = new THREE.Mesh(hoodStripGeo, secondaryGlowMat);
    stripR.position.set(0.42, 0.76, -1.25);
    stripR.rotation.x = 0.18;
    root.add(duck, stripL, stripR);
  } else if (chassisId === 'valkyrie') {
    // Open-wheel formula wide front wing, sidepods, cockpit halo, and tall F1 rear wing
    const frontWingGeo = new THREE.BoxGeometry(2.35, 0.08, 0.58);
    const frontTipGeo = new THREE.BoxGeometry(2.4, 0.14, 0.12);
    const sidePodGeo = new THREE.BoxGeometry(0.48, 0.34, 1.75);
    const rearWingGeo = new THREE.BoxGeometry(2.2, 0.09, 0.6);
    const endplateGeo = new THREE.BoxGeometry(0.08, 0.54, 0.66);
    disposables.push(frontWingGeo, frontTipGeo, sidePodGeo, rearWingGeo, endplateGeo);

    const frontWing = new THREE.Mesh(frontWingGeo, carbonMat);
    frontWing.position.set(0, 0.34, -2.38);
    const frontTip = new THREE.Mesh(frontTipGeo, secondaryGlowMat);
    frontTip.position.set(0, 0.36, -2.65);

    const podL = new THREE.Mesh(sidePodGeo, bodyMat);
    podL.position.set(-0.76, 0.46, 0.25);
    const podR = new THREE.Mesh(sidePodGeo, bodyMat);
    podR.position.set(0.76, 0.46, 0.25);

    const rearWing = new THREE.Mesh(rearWingGeo, carbonMat);
    rearWing.position.set(0, 1.24, 2.2);
    const plateL = new THREE.Mesh(endplateGeo, secondaryGlowMat);
    plateL.position.set(-1.12, 1.08, 2.2);
    const plateR = new THREE.Mesh(endplateGeo, secondaryGlowMat);
    plateR.position.set(1.12, 1.08, 2.2);
    root.add(frontWing, frontTip, podL, podR, rearWing, plateL, plateR);
  } else if (chassisId === 'nemesis') {
    // Supercharged hood blower + glowing intake core + rear louver deck
    const blowerGeo = new THREE.BoxGeometry(0.66, 0.34, 0.92);
    const scoopGeo = new THREE.BoxGeometry(0.56, 0.16, 0.22);
    const louverGeo = new THREE.BoxGeometry(1.48, 0.07, 0.16);
    disposables.push(blowerGeo, scoopGeo, louverGeo);

    const blower = new THREE.Mesh(blowerGeo, alloyMat);
    blower.position.set(0, 0.92, -1.22);
    const scoop = new THREE.Mesh(scoopGeo, secondaryGlowMat);
    scoop.position.set(0, 1.04, -1.68);
    root.add(blower, scoop);

    for (let k = 0; k < 3; k++) {
      const louver = new THREE.Mesh(louverGeo, carbonMat);
      louver.position.set(0, 1.05 - k * 0.08, 1.28 + k * 0.28);
      louver.rotation.x = -0.22;
      root.add(louver);
    }
  } else if (chassisId === 'nova') {
    // Twin dorsal turbine pods + angled cyber tailfins
    const podGeo = new THREE.CylinderGeometry(0.24, 0.28, 1.45, 12);
    podGeo.rotateX(Math.PI / 2);
    const glowRingGeo = new THREE.TorusGeometry(0.25, 0.045, 8, 18);
    const tailFinGeo = new THREE.BoxGeometry(0.08, 0.55, 0.85);
    disposables.push(podGeo, glowRingGeo, tailFinGeo);

    for (const xSide of [-0.55, 0.55]) {
      const pod = new THREE.Mesh(podGeo, carbonMat);
      pod.position.set(xSide, 0.96, 1.35);
      const ring = new THREE.Mesh(glowRingGeo, secondaryGlowMat);
      ring.position.set(xSide, 0.96, 2.08);
      const fin = new THREE.Mesh(tailFinGeo, bodyMat);
      fin.position.set(xSide * 1.45, 1.06, 1.75);
      fin.rotation.z = xSide < 0 ? 0.35 : -0.35;
      root.add(pod, ring, fin);
    }
  } else if (chassisId === 'zenith') {
    // Le Mans dorsal shark-fin + wide split endurance wing
    const sharkFinGeo = new THREE.BoxGeometry(0.08, 0.62, 1.95);
    const wingGeo = new THREE.BoxGeometry(2.38, 0.08, 0.56);
    const wingSideGeo = new THREE.BoxGeometry(0.08, 0.38, 0.62);
    disposables.push(sharkFinGeo, wingGeo, wingSideGeo);

    const sharkFin = new THREE.Mesh(sharkFinGeo, secondaryGlowMat);
    sharkFin.position.set(0, 1.24, 1.05);
    const wing = new THREE.Mesh(wingGeo, carbonMat);
    wing.position.set(0, 1.22, 2.18);
    const endL = new THREE.Mesh(wingSideGeo, primaryGlowMat);
    endL.position.set(-1.18, 1.14, 2.18);
    const endR = new THREE.Mesh(wingSideGeo, primaryGlowMat);
    endR.position.set(1.18, 1.14, 2.18);
    root.add(sharkFin, wing, endL, endR);
  } else {
    // Interceptor twin angled stabilizer fins
    const finGeo = new THREE.BoxGeometry(0.1, 0.44, 0.88);
    const bridgeGeo = new THREE.BoxGeometry(1.4, 0.08, 0.36);
    disposables.push(finGeo, bridgeGeo);

    const finL = new THREE.Mesh(finGeo, bodyMat);
    finL.position.set(-0.78, 1.14, 1.75);
    finL.rotation.z = 0.22;
    const finR = new THREE.Mesh(finGeo, bodyMat);
    finR.position.set(0.78, 1.14, 1.75);
    finR.rotation.z = -0.22;
    const finGlowL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.44, 0.14), secondaryGlowMat);
    finGlowL.position.set(-0.78, 1.14, 2.15);
    finGlowL.rotation.z = 0.22;
    const finGlowR = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.44, 0.14), secondaryGlowMat);
    finGlowR.position.set(0.78, 1.14, 2.15);
    finGlowR.rotation.z = -0.22;
    const bridge = new THREE.Mesh(bridgeGeo, carbonMat);
    bridge.position.set(0, 1.28, 1.95);
    disposables.push(finGlowL.geometry, finGlowR.geometry);
    root.add(finL, finR, finGlowL, finGlowR, bridge);
  }

  // Twin rear jet exhaust thrusters & dynamic nitro flames
  const nozzleGeo = new THREE.CylinderGeometry(0.18, 0.22, 0.3, 12);
  nozzleGeo.rotateX(Math.PI / 2);
  const flameGeo = new THREE.ConeGeometry(0.19, 1.4, 10);
  flameGeo.rotateX(Math.PI / 2);
  flameGeo.translate(0, 0, 0.7);
  disposables.push(nozzleGeo, flameGeo);

  for (const xOff of [-0.42, 0.42]) {
    const nozzle = new THREE.Mesh(nozzleGeo, alloyMat);
    nozzle.position.set(xOff, 0.46, 2.25);
    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.position.set(xOff, 0.46, 2.34);
    flame.scale.set(1, 1, 0.2);
    root.add(nozzle, flame);
    flames.push(flame);
  }

  // 4 composite wheels (oversized tires for Titan Buggy)
  const wheelRadius = chassisId === 'titan' ? 0.52 : 0.42;
  const wheelWidth = chassisId === 'titan' ? 0.46 : 0.34;
  const tireGeo = new THREE.CylinderGeometry(wheelRadius, wheelRadius, wheelWidth, 20);
  tireGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(wheelRadius * 0.56, wheelRadius * 0.56, wheelWidth + 0.02, 12);
  hubGeo.rotateZ(Math.PI / 2);
  const rimRingGeo = new THREE.TorusGeometry(wheelRadius * 0.75, 0.032, 8, 20);
  rimRingGeo.rotateY(Math.PI / 2);
  disposables.push(tireGeo, hubGeo, rimRingGeo);

  const wheelTrackX =
    chassisId === 'valkyrie'
      ? 1.08
      : hullWidth * 0.5 + (chassisId === 'titan' ? 0.3 : 0.16);
  const wheelConfigs = [
    { x: -wheelTrackX, z: -1.42, front: true, side: -1 },
    { x: wheelTrackX, z: -1.42, front: true, side: 1 },
    { x: -wheelTrackX, z: 1.42, front: false, side: -1 },
    { x: wheelTrackX, z: 1.42, front: false, side: 1 },
  ];

  for (const wc of wheelConfigs) {
    const steerPivot = new THREE.Group();
    steerPivot.position.set(wc.x, wheelRadius, wc.z);

    const spinGroup = new THREE.Group();
    const tire = new THREE.Mesh(tireGeo, carbonMat);
    const hub = new THREE.Mesh(hubGeo, alloyMat);
    const rim = new THREE.Mesh(rimRingGeo, primaryGlowMat);
    rim.position.x = wc.side * (wheelWidth * 0.5 + 0.005);
    spinGroup.add(tire, hub, rim);

    steerPivot.add(spinGroup);
    root.add(steerPivot);

    wheels.push(spinGroup);
    if (wc.front) {
      frontSteerPivots.push(steerPivot);
    }
  }

  // Deployable Glider Attachment
  const glider = createGliderAttachment(
    gliderId,
    primaryGlowMat,
    secondaryGlowMat,
    carbonMat,
    disposables,
    false,
  );
  glider.updateDeploy(0);
  root.add(glider.group);

  // Dynamic underglow point light attached to the vehicle
  const underglow = new THREE.PointLight(new THREE.Color(primaryHex), 4.5, 16, 1.6);
  underglow.position.set(0, 0.5, 0);
  root.add(underglow);

  return {
    root,
    wheels,
    frontSteerPivots,
    flames,
    underglow,
    updateGliderDeploy: glider.updateDeploy,
    updateColors: (pHex: string, sHex: string) => {
      primaryGlowMat.color.set(pHex);
      primaryGlowMat.emissive.set(pHex);
      secondaryGlowMat.color.set(sHex);
      secondaryGlowMat.emissive.set(sHex);
      flameMat.color.set(pHex);
      underglow.color.set(pHex);
    },
    dispose: () => {
      for (const d of disposables) {
        d.dispose();
      }
    },
  };
}

export function createGhostVehicleMesh(
  chassisId: ChassisId,
  gliderId: GliderId,
): GhostVehicleVisuals {
  const root = new THREE.Group();
  const disposables: { dispose: () => void }[] = [];

  const ghostShellMat = new THREE.MeshBasicMaterial({
    color: 0x00f3ff,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
  });
  const ghostTrimMat = new THREE.MeshBasicMaterial({
    color: 0x7dd3fc,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  const ghostWireMat = new THREE.MeshBasicMaterial({
    color: 0x00f3ff,
    wireframe: true,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  });
  disposables.push(ghostShellMat, ghostTrimMat, ghostWireMat);

  const hullWidth =
    chassisId === 'apex' || chassisId === 'nemesis'
      ? 1.98
      : chassisId === 'titan'
        ? 1.66
        : chassisId === 'phantom'
          ? 1.56
          : chassisId === 'valkyrie'
            ? 1.08
            : chassisId === 'zenith'
              ? 1.88
              : 1.78;
  const bodyGeo = new THREE.BoxGeometry(hullWidth, 0.68, 4.4);
  const cabinGeo = new THREE.BoxGeometry(hullWidth * 0.72, 0.36, 1.85);
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.34, 12);
  wheelGeo.rotateZ(Math.PI / 2);
  disposables.push(bodyGeo, cabinGeo, wheelGeo);

  const body = new THREE.Mesh(bodyGeo, ghostShellMat);
  body.position.set(0, 0.62, 0);
  const bodyWire = new THREE.Mesh(bodyGeo, ghostWireMat);
  bodyWire.position.set(0, 0.62, 0);
  const cabin = new THREE.Mesh(cabinGeo, ghostTrimMat);
  cabin.position.set(0, 1.06, -0.05);
  root.add(body, bodyWire, cabin);

  const wx = hullWidth * 0.5 + 0.16;
  for (const [x, z] of [
    [-wx, -1.42],
    [wx, -1.42],
    [-wx, 1.42],
    [wx, 1.42],
  ]) {
    const w = new THREE.Mesh(wheelGeo, ghostTrimMat);
    w.position.set(x, 0.42, z);
    root.add(w);
  }

  const glider = createGliderAttachment(
    gliderId,
    ghostTrimMat,
    ghostTrimMat,
    ghostShellMat,
    disposables,
    true,
  );
  glider.updateDeploy(0);
  root.add(glider.group);

  return {
    root,
    updateGliderDeploy: glider.updateDeploy,
    dispose: () => {
      for (const d of disposables) {
        d.dispose();
      }
    },
  };
}

export class VehicleController {
  public visuals: VehicleVisuals;
  public position = new THREE.Vector3(0, 0.85, -10);
  public velocity = new THREE.Vector3();
  public quaternion = new THREE.Quaternion();

  public grounded = true;
  public airborne = false;
  public gliding = false;
  public drifting = false;
  public boosting = false;
  public nitro = 100;
  public steerVisual = 0;
  private steerSmooth = 0;
  public wheelSpin = 0;
  private gliderOpen = 0;

  public currentCheckpoint = 0;
  public coinsCollected = 0;
  public airborneSec = 0;
  public respawns = 0;
  public lastCheckpointFlash = 0;
  public lastRingFlash = 0;
  public hazardHitFlash = 0;

  private spec = CHASSIS_SPECS.interceptor;
  private gliderId: GliderId = 'aero-wings';
  private steeringSensitivity = 1.0;
  private boostPadTimer = 0;
  private jumpPadCooldown = 0;
  private jumpCooldown = 0;
  private coyoteTimer = 0;
  private jumpLock = false;
  private hazardCooldown = 0;
  private respawnPos = new THREE.Vector3(0, 0.85, -10);
  private respawnQuat = new THREE.Quaternion();

  constructor(garage: GarageConfig, steeringSensitivity = 1.0) {
    this.spec = CHASSIS_SPECS[garage.chassisId];
    this.gliderId = garage.gliderId;
    this.steeringSensitivity = steeringSensitivity;
    this.visuals = createVehicleMesh(
      garage.chassisId,
      garage.gliderId,
      garage.primaryColor,
      garage.secondaryColor,
    );
  }

  public setSteeringSensitivity(val: number): void {
    this.steeringSensitivity = Math.max(0.4, Math.min(1.8, val));
  }

  public applyGarage(garage: GarageConfig, scene: THREE.Scene): void {
    const needRebuild =
      this.spec.id !== garage.chassisId || this.gliderId !== garage.gliderId;
    this.spec = CHASSIS_SPECS[garage.chassisId];
    this.gliderId = garage.gliderId;
    if (needRebuild) {
      scene.remove(this.visuals.root);
      this.visuals.dispose();
      this.visuals = createVehicleMesh(
        garage.chassisId,
        garage.gliderId,
        garage.primaryColor,
        garage.secondaryColor,
      );
      this.visuals.root.position.copy(this.position);
      this.visuals.root.quaternion.copy(this.quaternion);
      this.visuals.updateGliderDeploy(this.gliderOpen);
      scene.add(this.visuals.root);
    } else {
      this.visuals.updateColors(garage.primaryColor, garage.secondaryColor);
    }
  }

  public updateShowcaseGlider(dt: number, forceOpen: boolean): void {
    const target = forceOpen && this.gliderId !== 'none' ? 1 : 0;
    this.gliderOpen = THREE.MathUtils.damp(this.gliderOpen, target, 8, Math.min(dt, 0.05));
    this.visuals.updateGliderDeploy(this.gliderOpen);
  }

  public resetToSpawn(spawnPoint: {
    position: THREE.Vector3;
    forward: THREE.Vector3;
    up: THREE.Vector3;
  }): void {
    this.respawnPos.copy(spawnPoint.position);
    _mat4.makeBasis(
      _v1.crossVectors(spawnPoint.forward, spawnPoint.up).normalize(),
      spawnPoint.up,
      spawnPoint.forward.clone().negate(),
    );
    this.respawnQuat.setFromRotationMatrix(_mat4);

    this.currentCheckpoint = 0;
    this.coinsCollected = 0;
    this.airborneSec = 0;
    this.respawns = 0;
    this.nitro = 100;
    this.boostPadTimer = 0;
    this.jumpPadCooldown = 0;
    this.jumpCooldown = 0;
    this.coyoteTimer = 0;
    this.jumpLock = false;
    this.hazardCooldown = 0;
    this.lastCheckpointFlash = 0;
    this.lastRingFlash = 0;
    this.hazardHitFlash = 0;
    this.gliding = false;
    this.gliderOpen = 0;
    this.visuals.updateGliderDeploy(0);
    this.respawn(false);
  }

  public respawn(countAsRespawn = true): void {
    if (countAsRespawn) this.respawns += 1;
    this.position.copy(this.respawnPos);
    this.quaternion.copy(this.respawnQuat);
    this.velocity.set(0, 0, 0);
    this.grounded = true;
    this.airborne = false;
    this.gliding = false;
    this.drifting = false;
    this.boosting = false;
    this.boostPadTimer = 0;
    this.jumpCooldown = 0;
    this.coyoteTimer = 0;
    this.jumpLock = false;
    this.steerSmooth = 0;
    this.steerVisual = 0;
    this.gliderOpen = 0;
    this.visuals.updateGliderDeploy(0);
    this.visuals.root.position.copy(this.position);
    this.visuals.root.quaternion.copy(this.quaternion);
  }

  public getSpeed(): number {
    return this.velocity.length();
  }

  public getSpeedKmh(): number {
    return Math.round(this.velocity.length() * 3.6);
  }

  private findSupportingQuad(track: TrackQueryTarget): { quad: ColliderQuad; dist: number; proj: THREE.Vector3 } | null {
    track.queryQuads(this.position.x, this.position.z, _candidates);
    if (_candidates.length === 0) return null;

    _up.set(0, 1, 0).applyQuaternion(this.quaternion).normalize();
    let bestQuad: ColliderQuad | null = null;
    let bestAbsDist = Infinity;
    let bestSignedDist = 0;

    for (let i = 0; i < _candidates.length; i++) {
      const q = _candidates[i];
      const align = q.normal.dot(_up);
      if (align < 0.25) continue;

      _v4.subVectors(this.position, q.center);
      const dist = _v4.dot(q.normal);

      const minD = this.grounded ? -1.4 : -0.9;
      const maxD = this.grounded ? 1.55 : 0.85;
      if (dist < minD || dist > maxD) continue;

      if (!this.grounded && this.velocity.dot(q.normal) > 6) continue;

      _proj.copy(this.position).addScaledVector(q.normal, -dist);
      if (
        pointInTriangle(_proj, q.a, q.b, q.c) ||
        pointInTriangle(_proj, q.a, q.c, q.d)
      ) {
        const absD = Math.abs(dist);
        if (absD < bestAbsDist) {
          bestAbsDist = absD;
          bestSignedDist = dist;
          bestQuad = q;
        }
      }
    }

    if (!bestQuad) return null;
    _proj.copy(this.position).addScaledVector(bestQuad.normal, -bestSignedDist);
    return { quad: bestQuad, dist: bestSignedDist, proj: _proj };
  }

  public step(
    dt: number,
    input: InputState,
    track: TrackQueryTarget,
    audio: AudioSynth,
    envMod?: {
      gravityScale?: number;
      speedBonus?: number;
      nitroRegenMult?: number;
    },
  ): {
    finished: boolean;
    boostTriggered: boolean;
    fellIntoAbyss: boolean;
    fatalCrash: CrashEvent | null;
  } {
    const safeDt = Math.min(dt, 0.04);
    const gravityScale = envMod?.gravityScale ?? 1;
    const speedBonus = envMod?.speedBonus ?? 0;
    const nitroRegenMult = envMod?.nitroRegenMult ?? 1;
    let boostTriggered = false;
    let fatalCrash: CrashEvent | null = null;

    if (this.boostPadTimer > 0) {
      this.boostPadTimer = Math.max(0, this.boostPadTimer - safeDt);
    }
    if (this.jumpPadCooldown > 0) {
      this.jumpPadCooldown = Math.max(0, this.jumpPadCooldown - safeDt);
    }
    if (this.jumpCooldown > 0) {
      this.jumpCooldown = Math.max(0, this.jumpCooldown - safeDt);
    }
    if (this.hazardCooldown > 0) {
      this.hazardCooldown = Math.max(0, this.hazardCooldown - safeDt);
    }

    // Current local basis
    _fwd.set(0, 0, -1).applyQuaternion(this.quaternion).normalize();
    _up.set(0, 1, 0).applyQuaternion(this.quaternion).normalize();
    _right.set(1, 0, 0).applyQuaternion(this.quaternion).normalize();

    // Nitro logic
    const wantsNitro = input.boost && this.nitro > 1;
    const isPadBoost = this.boostPadTimer > 0;
    this.boosting = wantsNitro || isPadBoost;
    if (wantsNitro) {
      this.nitro = Math.max(0, this.nitro - 26 * safeDt);
    } else {
      this.nitro = Math.min(100, this.nitro + (this.drifting ? 16 : 9) * nitroRegenMult * safeDt);
    }

    const support = this.findSupportingQuad(track);
    const wasGrounded = this.grounded;

    if (support) {
      const { quad, proj } = support;
      const inLoop = quad.isLoop && this.velocity.length() > 12;

      // Detach only if nearly stopped upside down in a loop
      if (quad.normal.y < -0.35 && this.velocity.length() < 9) {
        this.grounded = false;
        this.coyoteTimer = Math.max(0, this.coyoteTimer - safeDt);
      } else {
        this.grounded = true;
        this.coyoteTimer = 0.14;
        this.airborne = false;
        this.gliding = false;

        // Smoothly seat vehicle onto surface
        const rideHeight = 0.08;
        _v1.copy(proj).addScaledVector(quad.normal, rideHeight);
        this.position.lerp(_v1, 1 - Math.exp(-26 * safeDt));

        // Remove velocity component pushing into the deck
        const vNorm = this.velocity.dot(quad.normal);
        if (vNorm < 0) {
          this.velocity.addScaledVector(quad.normal, -vNorm);
        } else if (wasGrounded && vNorm > 0 && inLoop) {
          this.velocity.addScaledVector(quad.normal, -vNorm * 0.9);
        }

        // Align vehicle up vector with surface normal
        _rotQuat.setFromUnitVectors(_up, quad.normal);
        _targetQuat.multiplyQuaternions(_rotQuat, this.quaternion);
        this.quaternion.slerp(_targetQuat, 1 - Math.exp(-16 * safeDt)).normalize();

        // Recompute basis after alignment
        _fwd.set(0, 0, -1).applyQuaternion(this.quaternion).normalize();
        _up.set(0, 1, 0).applyQuaternion(this.quaternion).normalize();
        _right.set(1, 0, 0).applyQuaternion(this.quaternion).normalize();

        // Progressive, speed-stabilized steering
        const steerInput = (input.left ? 1 : 0) - (input.right ? 1 : 0);
        this.steerSmooth = THREE.MathUtils.damp(this.steerSmooth, steerInput, 10, safeDt);
        this.steerVisual = THREE.MathUtils.damp(this.steerVisual, steerInput * 0.36, 12, safeDt);

        const fwdSpeed = this.velocity.dot(_fwd);
        const speedFactor = Math.min(1, Math.abs(fwdSpeed) / 10);
        const highSpeedDamp = 1 / (1 + Math.max(0, Math.abs(fwdSpeed) - 38) * 0.012);
        const steerDir = fwdSpeed >= -1 ? 1 : -1;
        const turnRate =
          this.steerSmooth *
          this.spec.handling *
          this.steeringSensitivity *
          speedFactor *
          highSpeedDamp *
          steerDir;

        if (Math.abs(turnRate) > 0.001) {
          _rotQuat.setFromAxisAngle(_up, turnRate * safeDt);
          this.quaternion.premultiply(_rotQuat).normalize();
          _fwd.set(0, 0, -1).applyQuaternion(this.quaternion).normalize();
          _right.set(1, 0, 0).applyQuaternion(this.quaternion).normalize();
        }

        // Acceleration, Braking, Nitro
        const maxSpd =
          this.spec.topSpeed + speedBonus + (this.boosting ? this.spec.nitroPower : 0);
        const accel = this.spec.acceleration + (this.boosting ? 20 : 0);

        if (input.throttle || isPadBoost) {
          if (fwdSpeed < maxSpd) {
            this.velocity.addScaledVector(_fwd, accel * safeDt);
          }
        } else if (input.brake) {
          if (fwdSpeed > 2) {
            this.velocity.addScaledVector(_fwd, -accel * 1.65 * safeDt);
          } else if (fwdSpeed > -20) {
            this.velocity.addScaledVector(_fwd, -accel * 0.7 * safeDt);
          }
        } else {
          // Gentle rolling drag
          this.velocity.multiplyScalar(1 - 0.5 * safeDt);
        }

        // Lateral grip modulated by track ground surface (e.g. Cryo Ice is driftier)
        const latVel = this.velocity.dot(_right);
        this.drifting = Math.abs(latVel) > 6.5 && Math.abs(fwdSpeed) > 24;
        const baseGrip = Math.abs(steerInput) > 0.5 && Math.abs(fwdSpeed) > 42 ? 8.5 : 14.0;
        const grip = baseGrip * track.getGripAt(this.position.x, this.position.z);
        this.velocity.addScaledVector(_right, -latVel * Math.min(1, grip * safeDt));

        // Tangential gravity slope effect (suppressed on loops so magnetic loop flow stays exhilarating)
        if (!inLoop) {
          const gSlope = -36 * quad.normal.y;
          // Project world gravity (0, -36, 0) onto surface
          _v2.set(0, -36, 0);
          _v3.copy(quad.normal).multiplyScalar(_v2.dot(quad.normal));
          _v2.sub(_v3);
          this.velocity.addScaledVector(_v2, safeDt * 0.45);
          void gSlope;
        }
      }
    } else {
      // Airborne & Glider physics
      this.grounded = false;
      this.coyoteTimer = Math.max(0, this.coyoteTimer - safeDt);
      this.airborne = true;
      this.airborneSec += safeDt;
      this.drifting = false;
      this.steerVisual = THREE.MathUtils.damp(this.steerVisual, 0, 8, safeDt);

      const gliderSpec = GLIDER_SPECS[this.gliderId];
      this.gliding = this.gliderId !== 'none';

      // Glider slows downward sink once past initial ramp apex
      const effectiveGravity =
        (this.gliding && this.velocity.y > 4 ? 26 : gliderSpec.airGravity) * gravityScale;
      this.velocity.y -= effectiveGravity * safeDt;

      // Glider gentle terminal sink speed cap when deployed
      if (this.gliding && this.velocity.y < -14) {
        this.velocity.y = THREE.MathUtils.damp(this.velocity.y, -11, 6, safeDt);
      }

      // Glider forward thrust + optional nitro air boost
      const fwdAirSpd = this.velocity.dot(_fwd);
      if (this.gliding && gliderSpec.airThrust > 0 && fwdAirSpd < this.spec.topSpeed + speedBonus + 12) {
        this.velocity.addScaledVector(_fwd, gliderSpec.airThrust * safeDt);
      }
      if (this.boosting) {
        this.velocity.addScaledVector(_fwd, 20 * safeDt);
      }

      // Mid-air pitch & glider-enhanced steering
      const pitchInput = (input.pitchUp ? 1 : 0) - (input.pitchDown ? 1 : 0);
      const airTurn = (input.left ? 1 : 0) - (input.right ? 1 : 0);
      const rollInput = (input.rollLeft ? 1 : 0) - (input.rollRight ? 1 : 0);

      if (pitchInput !== 0) {
        _rotQuat.setFromAxisAngle(_right, -pitchInput * 1.15 * safeDt);
        this.quaternion.premultiply(_rotQuat).normalize();
      }
      if (airTurn !== 0) {
        _rotQuat.setFromAxisAngle(
          _up,
          airTurn * 0.9 * gliderSpec.airControl * this.steeringSensitivity * safeDt,
        );
        this.quaternion.premultiply(_rotQuat).normalize();
        if (this.gliding) {
          // Gently steer velocity vector into glide turn
          this.velocity.applyAxisAngle(
            _up,
            airTurn * 0.65 * gliderSpec.airControl * this.steeringSensitivity * safeDt,
          );
        }
      }
      if (rollInput !== 0) {
        _rotQuat.setFromAxisAngle(_fwd, rollInput * 1.6 * safeDt);
        this.quaternion.premultiply(_rotQuat).normalize();
      }

      // Smooth horizon self-leveling so jumps & glides land cleanly and predictably
      if (pitchInput === 0 && rollInput === 0) {
        _v1.set(_fwd.x, Math.max(-0.18, Math.min(0.18, _fwd.y)), _fwd.z).normalize();
        _v2.set(0, 1, 0);
        _v3.crossVectors(_v1, _v2).normalize();
        _v2.crossVectors(_v3, _v1).normalize();
        _v4.copy(_v1).negate();
        _mat4.makeBasis(_v3, _v2, _v4);
        _targetQuat.setFromRotationMatrix(_mat4);
        this.quaternion.slerp(_targetQuat, 1 - Math.exp(-4.5 * safeDt)).normalize();
      }
    }

    // Manual Jump (works while grounded or during brief coyote-time window off edges)
    if (
      input.jump &&
      !this.jumpLock &&
      (this.grounded || this.coyoteTimer > 0) &&
      this.jumpCooldown <= 0
    ) {
      this.jumpLock = true;
      this.jumpCooldown = 0.52;
      this.coyoteTimer = 0;
      this.grounded = false;
      this.airborne = true;
      this.position.addScaledVector(_up, 0.48);
      const vUp = this.velocity.dot(_up);
      const jumpTarget = gravityScale < 0.8 ? 18.2 : 16.5;
      if (vUp < jumpTarget) {
        this.velocity.addScaledVector(_up, jumpTarget - Math.max(0, vUp));
      }
      audio.playJump();
    } else if (!input.jump) {
      this.jumpLock = false;
    }

    // Integrate position
    this.position.addScaledVector(this.velocity, safeDt);

    // Check Boost Zones
    track.forEachBoostZone((bz) => {
      if (this.position.distanceToSquared(bz.center) < bz.radius * bz.radius) {
        if (this.boostPadTimer < 0.25) {
          boostTriggered = true;
          audio.playBoost();
        }
        this.boostPadTimer = 0.75;
        this.nitro = Math.min(100, this.nitro + 30 * safeDt);
        const curForwardSpd = this.velocity.dot(bz.forward);
        if (curForwardSpd < this.spec.topSpeed + 34) {
          this.velocity.addScaledVector(bz.forward, 65 * safeDt);
        }
      }
    });

    // Check Vertical Jump Pads
    if (this.jumpPadCooldown <= 0) {
      track.forEachJumpPad((jp) => {
        if (this.jumpPadCooldown > 0) return;
        if (this.position.distanceToSquared(jp.center) < jp.radius * jp.radius) {
          this.jumpPadCooldown = 0.55;
          this.grounded = false;
          this.airborne = true;
          this.velocity.y = Math.max(this.velocity.y, jp.impulse);
          this.velocity.addScaledVector(jp.forward, 10);
          this.position.y += 0.6;
          this.nitro = Math.min(100, this.nitro + 18);
          boostTriggered = true;
          audio.playJumpPad();
        }
      });
    }

    // Check Moving Obstacles & Traps (high-speed impacts are fatal and end the run)
    const preImpactSpeedKmh = this.getSpeedKmh();
    if (this.hazardCooldown <= 0 || preImpactSpeedKmh >= FATAL_TRAP_SPEED_KMH) {
      let hit = false;
      track.forEachObstacle((obs) => {
        if (hit) return;
        if (obs.checkCollision(this.position, 1.25, _push)) {
          hit = true;
          this.hazardHitFlash = performance.now();
          if (preImpactSpeedKmh >= FATAL_TRAP_SPEED_KMH) {
            fatalCrash = {
              trapType: obs.type,
              speedKmh: preImpactSpeedKmh,
            };
            audio.playCrashExplosion();
            this.velocity.multiplyScalar(0.22);
            this.velocity.y = Math.max(this.velocity.y, 6);
            _push.y = 0;
            if (_push.lengthSq() > 0.001) _push.normalize();
            this.velocity.addScaledVector(_push, 6);
          } else {
            this.hazardCooldown = 0.75;
            audio.playImpact();
            // Gentle speed trim & soft pushback on low-speed impacts
            this.velocity.multiplyScalar(0.72);
            _push.y = 0;
            if (_push.lengthSq() > 0.001) _push.normalize();
            this.velocity.addScaledVector(_push, 9);
          }
        }
      });
    }

    // Check Checkpoints
    track.forEachCheckpoint((cp) => {
      if (!cp.activated) {
        const halfW = cp.width * 0.5 + 1.5;
        _v1.subVectors(this.position, cp.position);
        const fwdDist = Math.abs(_v1.dot(cp.forward));
        const sideDist = Math.abs(_v1.dot(cp.right));
        const upDist = Math.abs(_v1.dot(cp.up));

        if (fwdDist < 4.5 && sideDist < halfW && upDist < 8.5) {
          cp.activated = true;
          cp.updateVisuals(true);
          this.currentCheckpoint = Math.max(this.currentCheckpoint, cp.index + 1);
          this.lastCheckpointFlash = performance.now();
          this.nitro = Math.min(100, this.nitro + 35);
          audio.playCheckpoint();

          // Update respawn point cleanly above checkpoint deck
          this.respawnPos.copy(cp.position).addScaledVector(cp.up, 0.85);
          _mat4.makeBasis(cp.right, cp.up, cp.forward.clone().negate());
          this.respawnQuat.setFromRotationMatrix(_mat4);
        }
      }
    });

    // Check Collectible Coins
    track.forEachCoin((coin, markCollected) => {
      if (coin.collected) return;
      if (this.position.distanceToSquared(coin.basePosition) < 3.4 * 3.4) {
        markCollected();
        this.coinsCollected += 1;
        this.nitro = Math.min(100, this.nitro + 6);
        audio.playCoin();
      }
    });

    // Check Stunt Speed Rings (+5 coins, +45 nitro, forward surge)
    track.forEachRing((ring, markCollected) => {
      if (ring.collected) return;
      if (this.position.distanceToSquared(ring.center) < ring.radius * ring.radius) {
        markCollected();
        this.coinsCollected += 5;
        this.nitro = Math.min(100, this.nitro + 45);
        this.boostPadTimer = Math.max(this.boostPadTimer, 0.9);
        this.velocity.addScaledVector(ring.forward, 14);
        this.lastRingFlash = performance.now();
        boostTriggered = true;
        audio.playRing();
      }
    });

    // Check Finish Gate (when present in fixed circuits)
    let finished = false;
    if (track.finishGate) {
      _v1.subVectors(this.position, track.finishGate.position);
      const fFwd = Math.abs(_v1.dot(track.finishGate.forward));
      if (fFwd < 5.0 && _v1.length() < track.finishGate.width * 0.65 + 2.5) {
        finished = true;
      }
    }

    const fellIntoAbyss = this.position.y < this.respawnPos.y - 52;

    // Update 3D visuals (wheels, steering pivots, exhaust flames, glider wings, underglow)
    this.visuals.root.position.copy(this.position);
    this.visuals.root.quaternion.copy(this.quaternion);

    this.gliderOpen = THREE.MathUtils.damp(this.gliderOpen, this.gliding ? 1 : 0, 10, safeDt);
    this.visuals.updateGliderDeploy(this.gliderOpen);

    const spd = this.velocity.length();
    this.wheelSpin -= spd * safeDt * 1.45;
    for (let i = 0; i < this.visuals.wheels.length; i++) {
      this.visuals.wheels[i].rotation.x = this.wheelSpin;
    }
    for (let i = 0; i < this.visuals.frontSteerPivots.length; i++) {
      this.visuals.frontSteerPivots[i].rotation.y = this.steerVisual;
    }

    const flameTarget = this.boosting ? 1.55 + Math.random() * 0.35 : input.throttle ? 0.55 : 0.16;
    for (let i = 0; i < this.visuals.flames.length; i++) {
      this.visuals.flames[i].scale.z = THREE.MathUtils.damp(
        this.visuals.flames[i].scale.z,
        flameTarget,
        18,
        safeDt,
      );
    }

    this.visuals.underglow.intensity = this.boosting ? 8.5 : 4.5;

    return {
      finished: fatalCrash ? false : finished,
      boostTriggered,
      fellIntoAbyss: fatalCrash ? false : fellIntoAbyss,
      fatalCrash,
    };
  }
}
