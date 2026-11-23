import { DailyMissionDefinition, DailyMissionsSave } from './types';

export const MISSION_CATALOG: Record<string, DailyMissionDefinition> = {
  finish_3_levels: {
    id: 'finish_3_levels',
    title: 'Finish 3 Levels',
    description: 'Complete any 3 stunt circuits today',
    metric: 'levels_finished',
    target: 3,
    rewardCoins: 150,
  },
  collect_50_run: {
    id: 'collect_50_run',
    title: 'Coin Rush',
    description: 'Collect 50 coins in a single run',
    metric: 'single_run_coins',
    target: 50,
    rewardCoins: 200,
  },
  collect_100_today: {
    id: 'collect_100_today',
    title: 'Vault Collector',
    description: 'Collect 100 coins total today',
    metric: 'total_coins_today',
    target: 100,
    rewardCoins: 220,
  },
  zero_respawn: {
    id: 'zero_respawn',
    title: 'Flawless Pilot',
    description: 'Finish any level without respawning',
    metric: 'zero_respawn_finish',
    target: 1,
    rewardCoins: 140,
  },
  gold_medal: {
    id: 'gold_medal',
    title: 'Gold Velocity',
    description: 'Earn a Gold medal on any circuit',
    metric: 'gold_medal_finish',
    target: 1,
    rewardCoins: 180,
  },
  glider_8_sec: {
    id: 'glider_8_sec',
    title: 'Skyward Glide',
    description: 'Stay airborne for 8 seconds in one run',
    metric: 'single_run_airborne_sec',
    target: 8,
    rewardCoins: 130,
  },
  mega_circuit: {
    id: 'mega_circuit',
    title: 'Endurance Legend',
    description: 'Complete Level 7, 8, or 9',
    metric: 'mega_level_finish',
    target: 1,
    rewardCoins: 250,
  },
};

const ROTATING_IDS = [
  'zero_respawn',
  'gold_medal',
  'collect_100_today',
  'glider_8_sec',
  'mega_circuit',
];

export function getTodayDateKey(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getDailyMissionIdsForDate(dateKey: string): string[] {
  // Hash dateKey to deterministically pick 2 rotating bonus missions alongside core daily tasks
  let hash = 0;
  for (let i = 0; i < dateKey.length; i++) {
    hash = (hash * 31 + dateKey.charCodeAt(i)) >>> 0;
  }
  const idxA = hash % ROTATING_IDS.length;
  const idxB = (idxA + 1 + ((hash >> 3) % (ROTATING_IDS.length - 1))) % ROTATING_IDS.length;
  return ['finish_3_levels', 'collect_50_run', ROTATING_IDS[idxA], ROTATING_IDS[idxB]];
}

export function createFreshDailyMissions(dateKey = getTodayDateKey()): DailyMissionsSave {
  const missionIds = getDailyMissionIdsForDate(dateKey);
  const progress: Record<string, number> = {};
  const claimed: Record<string, boolean> = {};
  for (const id of missionIds) {
    progress[id] = 0;
    claimed[id] = false;
  }
  return {
    dateKey,
    missionIds,
    progress,
    claimed,
  };
}

export function getDailyMissionDefinitions(save: DailyMissionsSave): DailyMissionDefinition[] {
  return save.missionIds
    .map((id) => MISSION_CATALOG[id])
    .filter((m): m is DailyMissionDefinition => Boolean(m));
}
