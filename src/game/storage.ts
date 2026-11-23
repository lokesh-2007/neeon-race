import {
  createFreshDailyMissions,
  getDailyMissionDefinitions,
  getTodayDateKey,
  MISSION_CATALOG,
} from './missions';
import {
  CameraMode,
  DailyMissionDefinition,
  GarageConfig,
  GhostRun,
  GraphicsQuality,
  LevelBestRecord,
  SavedProgress,
} from './types';

const STORAGE_KEY = 'neon_challenge_legends_save_v1';

function buildDefaultSave(): SavedProgress {
  return {
    bestTimes: {},
    ghostRuns: {},
    garage: {
      chassisId: 'interceptor',
      gliderId: 'aero-wings',
      primaryColor: '#00f3ff',
      secondaryColor: '#ff007f',
    },
    muted: false,
    ghostEnabled: true,
    steeringSensitivity: 1.0,
    graphicsQuality: 'auto',
    cameraMode: 'chase',
    totalCoins: 0,
    bestInfiniteDistanceM: 0,
    bestInfiniteSector: 0,
    dailyMissions: createFreshDailyMissions(),
  };
}

export function loadProgress(): SavedProgress {
  const defaults = buildDefaultSave();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<SavedProgress>;
    const sens = Number(parsed.steeringSensitivity);
    const coins = Number(parsed.totalCoins);
    const today = getTodayDateKey();
    const savedDaily = parsed.dailyMissions;
    const dailyMissions =
      savedDaily &&
      savedDaily.dateKey === today &&
      Array.isArray(savedDaily.missionIds) &&
      savedDaily.missionIds.length > 0
        ? {
            dateKey: today,
            missionIds: savedDaily.missionIds,
            progress:
              savedDaily.progress && typeof savedDaily.progress === 'object'
                ? savedDaily.progress
                : {},
            claimed:
              savedDaily.claimed && typeof savedDaily.claimed === 'object'
                ? savedDaily.claimed
                : {},
          }
        : createFreshDailyMissions(today);

    return {
      bestTimes: parsed.bestTimes && typeof parsed.bestTimes === 'object' ? parsed.bestTimes : {},
      ghostRuns: parsed.ghostRuns && typeof parsed.ghostRuns === 'object' ? parsed.ghostRuns : {},
      garage: {
        chassisId: parsed.garage?.chassisId ?? defaults.garage.chassisId,
        gliderId: parsed.garage?.gliderId ?? defaults.garage.gliderId,
        primaryColor: parsed.garage?.primaryColor ?? defaults.garage.primaryColor,
        secondaryColor: parsed.garage?.secondaryColor ?? defaults.garage.secondaryColor,
      },
      muted: Boolean(parsed.muted),
      ghostEnabled: parsed.ghostEnabled !== undefined ? Boolean(parsed.ghostEnabled) : true,
      steeringSensitivity:
        Number.isFinite(sens) && sens >= 0.4 && sens <= 1.8 ? sens : defaults.steeringSensitivity,
      graphicsQuality:
        parsed.graphicsQuality === 'high' ||
        parsed.graphicsQuality === 'eco' ||
        parsed.graphicsQuality === 'auto'
          ? parsed.graphicsQuality
          : defaults.graphicsQuality,
      cameraMode:
        parsed.cameraMode === 'chase' ||
        parsed.cameraMode === 'cockpit' ||
        parsed.cameraMode === 'birds-eye'
          ? parsed.cameraMode
          : defaults.cameraMode,
      totalCoins: Number.isFinite(coins) && coins >= 0 ? Math.floor(coins) : 0,
      bestInfiniteDistanceM:
        Number.isFinite(Number(parsed.bestInfiniteDistanceM)) &&
        Number(parsed.bestInfiniteDistanceM) >= 0
          ? Math.floor(Number(parsed.bestInfiniteDistanceM))
          : 0,
      bestInfiniteSector:
        Number.isFinite(Number(parsed.bestInfiniteSector)) &&
        Number(parsed.bestInfiniteSector) >= 0
          ? Math.floor(Number(parsed.bestInfiniteSector))
          : 0,
      dailyMissions,
    };
  } catch {
    return defaults;
  }
}

export function saveProgress(progress: SavedProgress): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // If localStorage quota is tight because of many ghost runs, keep current & newest ghosts
    try {
      const trimmed: SavedProgress = {
        ...progress,
        ghostRuns: Object.fromEntries(Object.entries(progress.ghostRuns).slice(-3)),
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch {
      // Ignore storage quota errors in restricted contexts
    }
  }
}

export function saveGarageConfig(garage: GarageConfig): SavedProgress {
  const current = loadProgress();
  current.garage = garage;
  saveProgress(current);
  return current;
}

export function saveMutePreference(muted: boolean): SavedProgress {
  const current = loadProgress();
  current.muted = muted;
  saveProgress(current);
  return current;
}

export function saveGhostEnabled(ghostEnabled: boolean): SavedProgress {
  const current = loadProgress();
  current.ghostEnabled = ghostEnabled;
  saveProgress(current);
  return current;
}

export function saveSteeringSensitivity(steeringSensitivity: number): SavedProgress {
  const current = loadProgress();
  current.steeringSensitivity = Math.max(0.4, Math.min(1.8, steeringSensitivity));
  saveProgress(current);
  return current;
}

export function saveGraphicsQuality(graphicsQuality: GraphicsQuality): SavedProgress {
  const current = loadProgress();
  current.graphicsQuality = graphicsQuality;
  saveProgress(current);
  return current;
}

export function saveCameraMode(cameraMode: CameraMode): SavedProgress {
  const current = loadProgress();
  current.cameraMode = cameraMode;
  saveProgress(current);
  return current;
}

export function claimDailyMissionReward(missionId: string): {
  progress: SavedProgress;
  rewardCoins: number;
} {
  const current = loadProgress();
  const def = MISSION_CATALOG[missionId];
  if (!def) return { progress: current, rewardCoins: 0 };

  const curVal = current.dailyMissions.progress[missionId] ?? 0;
  const alreadyClaimed = Boolean(current.dailyMissions.claimed[missionId]);
  if (curVal < def.target || alreadyClaimed) {
    return { progress: current, rewardCoins: 0 };
  }

  current.dailyMissions.claimed[missionId] = true;
  current.totalCoins += def.rewardCoins;
  saveProgress(current);
  return { progress: current, rewardCoins: def.rewardCoins };
}

export function recordLevelCompletion(
  levelId: string,
  timeMs: number,
  parTimes: { gold: number; silver: number; bronze: number },
  coinsCollected: number,
  respawns: number,
  airborneSec: number,
  ghostRun: GhostRun | null,
): {
  progress: SavedProgress;
  isNewBest: boolean;
  medal: 'gold' | 'silver' | 'bronze';
  newlyCompletedMissions: DailyMissionDefinition[];
} {
  const sec = timeMs / 1000;
  const medal: 'gold' | 'silver' | 'bronze' =
    sec <= parTimes.gold ? 'gold' : sec <= parTimes.silver ? 'silver' : 'bronze';

  const current = loadProgress();
  const prev = current.bestTimes[levelId];
  const isNewBest = !prev || timeMs < prev.bestTimeMs;

  const safeCoins = Math.max(0, Math.floor(coinsCollected));
  current.totalCoins += safeCoins;

  if (isNewBest) {
    const record: LevelBestRecord = { bestTimeMs: timeMs, medal };
    current.bestTimes[levelId] = record;
    if (ghostRun && ghostRun.frames.length > 2) {
      current.ghostRuns[levelId] = ghostRun;
    }
  }

  // Update Daily Missions progress
  const activeDefs = getDailyMissionDefinitions(current.dailyMissions);
  const newlyCompletedMissions: DailyMissionDefinition[] = [];
  const isMegaLevel = levelId === 'level-7' || levelId === 'level-8' || levelId === 'level-9';

  for (const m of activeDefs) {
    const before = current.dailyMissions.progress[m.id] ?? 0;
    let nextVal = before;
    switch (m.metric) {
      case 'levels_finished':
        nextVal = before + 1;
        break;
      case 'single_run_coins':
        nextVal = Math.max(before, safeCoins);
        break;
      case 'total_coins_today':
        nextVal = before + safeCoins;
        break;
      case 'zero_respawn_finish':
        if (respawns === 0) nextVal = Math.max(before, 1);
        break;
      case 'gold_medal_finish':
        if (medal === 'gold') nextVal = Math.max(before, 1);
        break;
      case 'mega_level_finish':
        if (isMegaLevel) nextVal = Math.max(before, 1);
        break;
      case 'single_run_airborne_sec':
        nextVal = Math.max(before, Math.floor(airborneSec));
        break;
      case 'infinite_distance_m':
        break;
    }
    const clamped = Math.min(m.target, nextVal);
    current.dailyMissions.progress[m.id] = clamped;
    if (before < m.target && clamped >= m.target) {
      newlyCompletedMissions.push(m);
    }
  }

  saveProgress(current);
  return { progress: current, isNewBest, medal, newlyCompletedMissions };
}

export function recordInfiniteCompletion(
  distanceM: number,
  sector: number,
  coinsCollected: number,
  airborneSec: number,
): {
  progress: SavedProgress;
  isNewBestDistance: boolean;
  newlyCompletedMissions: DailyMissionDefinition[];
} {
  const current = loadProgress();
  const safeDist = Math.max(0, Math.floor(distanceM));
  const safeSector = Math.max(1, Math.floor(sector));
  const safeCoins = Math.max(0, Math.floor(coinsCollected));

  const isNewBestDistance = safeDist > current.bestInfiniteDistanceM;
  if (isNewBestDistance) {
    current.bestInfiniteDistanceM = safeDist;
  }
  if (safeSector > current.bestInfiniteSector) {
    current.bestInfiniteSector = safeSector;
  }
  current.totalCoins += safeCoins;

  const activeDefs = getDailyMissionDefinitions(current.dailyMissions);
  const newlyCompletedMissions: DailyMissionDefinition[] = [];

  for (const m of activeDefs) {
    const before = current.dailyMissions.progress[m.id] ?? 0;
    let nextVal = before;
    switch (m.metric) {
      case 'levels_finished':
        if (safeDist >= 1000) {
          nextVal = before + 1;
        }
        break;
      case 'single_run_coins':
        nextVal = Math.max(before, safeCoins);
        break;
      case 'total_coins_today':
        nextVal = before + safeCoins;
        break;
      case 'single_run_airborne_sec':
        nextVal = Math.max(before, Math.floor(airborneSec));
        break;
      case 'infinite_distance_m':
        nextVal = Math.max(before, safeDist);
        break;
      default:
        break;
    }
    const clamped = Math.min(m.target, nextVal);
    current.dailyMissions.progress[m.id] = clamped;
    if (before < m.target && clamped >= m.target) {
      newlyCompletedMissions.push(m);
    }
  }

  saveProgress(current);
  return { progress: current, isNewBestDistance, newlyCompletedMissions };
}
