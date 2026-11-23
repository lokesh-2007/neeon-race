import { GarageConfig, GhostRun, LevelBestRecord, SavedProgress } from './types';

const STORAGE_KEY = 'neon_challenge_legends_save_v1';

const DEFAULT_SAVE: SavedProgress = {
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
  totalCoins: 0,
};

export function loadProgress(): SavedProgress {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_SAVE);
    const parsed = JSON.parse(raw) as Partial<SavedProgress>;
    const sens = Number(parsed.steeringSensitivity);
    const coins = Number(parsed.totalCoins);
    return {
      bestTimes: parsed.bestTimes && typeof parsed.bestTimes === 'object' ? parsed.bestTimes : {},
      ghostRuns: parsed.ghostRuns && typeof parsed.ghostRuns === 'object' ? parsed.ghostRuns : {},
      garage: {
        chassisId: parsed.garage?.chassisId ?? DEFAULT_SAVE.garage.chassisId,
        gliderId: parsed.garage?.gliderId ?? DEFAULT_SAVE.garage.gliderId,
        primaryColor: parsed.garage?.primaryColor ?? DEFAULT_SAVE.garage.primaryColor,
        secondaryColor: parsed.garage?.secondaryColor ?? DEFAULT_SAVE.garage.secondaryColor,
      },
      muted: Boolean(parsed.muted),
      ghostEnabled: parsed.ghostEnabled !== undefined ? Boolean(parsed.ghostEnabled) : true,
      steeringSensitivity:
        Number.isFinite(sens) && sens >= 0.4 && sens <= 1.8 ? sens : DEFAULT_SAVE.steeringSensitivity,
      totalCoins: Number.isFinite(coins) && coins >= 0 ? Math.floor(coins) : 0,
    };
  } catch {
    return structuredClone(DEFAULT_SAVE);
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

export function recordLevelCompletion(
  levelId: string,
  timeMs: number,
  parTimes: { gold: number; silver: number; bronze: number },
  coinsCollected: number,
  ghostRun: GhostRun | null,
): { progress: SavedProgress; isNewBest: boolean; medal: 'gold' | 'silver' | 'bronze' } {
  const sec = timeMs / 1000;
  const medal: 'gold' | 'silver' | 'bronze' =
    sec <= parTimes.gold ? 'gold' : sec <= parTimes.silver ? 'silver' : 'bronze';

  const current = loadProgress();
  const prev = current.bestTimes[levelId];
  const isNewBest = !prev || timeMs < prev.bestTimeMs;

  current.totalCoins += Math.max(0, Math.floor(coinsCollected));

  if (isNewBest) {
    const record: LevelBestRecord = { bestTimeMs: timeMs, medal };
    current.bestTimes[levelId] = record;
    if (ghostRun && ghostRun.frames.length > 2) {
      current.ghostRuns[levelId] = ghostRun;
    }
  }

  saveProgress(current);
  return { progress: current, isNewBest, medal };
}
