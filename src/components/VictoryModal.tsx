import React from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Coins,
  Ghost,
  Infinity as InfinityIcon,
  RotateCcw,
  Target,
  Trophy,
} from 'lucide-react';
import {
  DailyMissionDefinition,
  FATAL_TRAP_SPEED_KMH,
  LevelDefinition,
  MovingObstacle,
  TRAP_LABELS,
} from '../game/types';
import { formatTimeSec } from './RacingHud';

export interface InfiniteRunSummary {
  distanceM: number;
  bestDistanceM: number;
  sector: number;
  coinsCollected: number;
  isNewBestDistance: boolean;
}

export interface CrashSummary {
  trapType: MovingObstacle['type'];
  speedKmh: number;
  elapsedSec: number;
  coinsCollected: number;
  checkpointIndex: number;
  totalCheckpoints: number;
  infiniteResult: {
    distanceM: number;
    bestDistanceM: number;
    sector: number;
    isNewBestDistance: boolean;
  } | null;
}

interface VictoryModalProps {
  level: LevelDefinition;
  timeMs: number;
  respawns: number;
  coinsCollected: number;
  totalCoins: number;
  medal: 'gold' | 'silver' | 'bronze';
  isNewBest: boolean;
  newlyCompletedMissions: DailyMissionDefinition[];
  hasNextLevel: boolean;
  infiniteSummary?: InfiniteRunSummary | null;
  crashSummary?: CrashSummary | null;
  onNextLevel: () => void;
  onRetry: () => void;
  onLevelSelect: () => void;
}

const MEDAL_STYLES: Record<'gold' | 'silver' | 'bronze', { label: string; textClass: string }> = {
  gold: { label: 'Gold Medal', textClass: 'text-amber-300' },
  silver: { label: 'Silver Medal', textClass: 'text-slate-200' },
  bronze: { label: 'Bronze Medal', textClass: 'text-orange-400' },
};

export const VictoryModal: React.FC<VictoryModalProps> = ({
  level,
  timeMs,
  respawns,
  coinsCollected,
  totalCoins,
  medal,
  isNewBest,
  newlyCompletedMissions,
  hasNextLevel,
  infiniteSummary,
  crashSummary,
  onNextLevel,
  onRetry,
  onLevelSelect,
}) => {
  const mStyle = MEDAL_STYLES[medal];
  const isCrash = Boolean(crashSummary);
  const isInfinite = Boolean(infiniteSummary || crashSummary?.infiniteResult);

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-[#050508]/84 p-4">
      <div
        className={`w-full max-w-md rounded-2xl border bg-[#090c17] p-6 sm:p-7 ${
          isCrash ? 'border-rose-500/45' : 'border-white/15'
        }`}
      >
        {crashSummary ? (
          <>
            <div className="flex items-center gap-2 text-xs text-rose-300">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span className="font-semibold uppercase tracking-wider">Game Over</span>
              <span aria-hidden="true">·</span>
              <span className="text-slate-300">
                {crashSummary.infiniteResult
                  ? `Infinite Sector ${crashSummary.infiniteResult.sector}`
                  : `Lv.${level.number} · ${level.name}`}
              </span>
            </div>

            <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-white">
              Vehicle Wrecked
            </h2>
            <p className="mt-1 text-xs text-slate-300">
              High-speed impact with{' '}
              <span className="font-semibold text-rose-300">
                {TRAP_LABELS[crashSummary.trapType]}
              </span>{' '}
              at{' '}
              <span className="font-mono-tabular font-semibold text-white">
                {crashSummary.speedKmh} KM/H
              </span>
              .
            </p>

            <div className="mt-5 rounded-xl border border-rose-500/25 bg-[#05070e] p-4">
              {crashSummary.infiniteResult ? (
                <>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs text-slate-400">Distance Driven</div>
                      <div className="mt-1 font-mono-tabular text-3xl font-bold text-cyan-300">
                        {crashSummary.infiniteResult.distanceM.toLocaleString()}
                        <span className="ml-1 text-base font-semibold text-slate-400">m</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-slate-400">Impact Speed</div>
                      <div className="mt-1 font-mono-tabular text-xl font-bold text-rose-400">
                        {crashSummary.speedKmh} KM/H
                      </div>
                      {crashSummary.infiniteResult.isNewBestDistance && (
                        <div className="mt-0.5 text-xs font-semibold text-[#39ff14]">
                          New Distance Record
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3 text-xs text-slate-300">
                    <span className="flex items-center gap-1.5 font-semibold text-amber-300 tabular-nums">
                      <Coins className="h-3.5 w-3.5" />
                      +{crashSummary.coinsCollected} Coins Saved
                    </span>
                    <span className="text-slate-400 tabular-nums">Bank: {totalCoins}</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs text-slate-400">Impact Speed</div>
                      <div className="mt-1 font-mono-tabular text-3xl font-bold text-rose-400">
                        {crashSummary.speedKmh}
                        <span className="ml-1 text-sm font-semibold text-slate-400">KM/H</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-slate-400">Time Survived</div>
                      <div className="mt-1 font-mono-tabular text-xl font-bold text-white">
                        {formatTimeSec(crashSummary.elapsedSec)}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3 text-xs text-slate-300">
                    <span className="tabular-nums">
                      Checkpoints: {crashSummary.checkpointIndex}/{crashSummary.totalCheckpoints}
                    </span>
                    <span className="text-slate-400">
                      Safe Trap Limit: &lt; {FATAL_TRAP_SPEED_KMH} KM/H
                    </span>
                  </div>
                </>
              )}
            </div>
          </>
        ) : infiniteSummary ? (
          <>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="inline-flex items-center gap-1 font-semibold text-fuchsia-300">
                <InfinityIcon className="h-3.5 w-3.5" />
                Infinite Mode
              </span>
              <span aria-hidden="true">·</span>
              <span className="text-slate-200">Sector {infiniteSummary.sector} Reached</span>
            </div>

            <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-white">
              Run Logged
            </h2>

            <div className="mt-5 rounded-xl border border-white/10 bg-[#05070e] p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-slate-400">Distance Driven</div>
                  <div className="mt-1 font-mono-tabular text-3xl font-bold text-cyan-300">
                    {infiniteSummary.distanceM.toLocaleString()}
                    <span className="ml-1 text-base font-semibold text-slate-400">m</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <Trophy className="h-5 w-5 text-fuchsia-300" />
                    <span className="font-display text-lg font-bold text-fuchsia-200">
                      Sector {infiniteSummary.sector}
                    </span>
                  </div>
                  {infiniteSummary.isNewBestDistance && (
                    <div className="mt-1 text-xs font-semibold text-[#39ff14]">
                      New Distance Record
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3 text-xs text-slate-300">
                <span className="flex items-center gap-1.5 font-semibold text-amber-300 tabular-nums">
                  <Coins className="h-3.5 w-3.5" />
                  +{infiniteSummary.coinsCollected} Coins
                </span>
                <span className="text-slate-400 tabular-nums">Bank: {totalCoins}</span>
              </div>

              <div className="mt-2.5 flex items-center justify-between text-xs text-slate-400">
                <span>Best Distance: {infiniteSummary.bestDistanceM.toLocaleString()} m</span>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span>Level {level.number} Complete</span>
              <span aria-hidden="true">·</span>
              <span className="text-slate-200">{level.name}</span>
            </div>

            <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-white">
              Course Cleared
            </h2>

            {/* Time & Medal Block */}
            <div className="mt-5 rounded-xl border border-white/10 bg-[#05070e] p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-slate-400">Finish Time</div>
                  <div className="mt-1 font-mono-tabular text-3xl font-bold text-cyan-300">
                    {formatTimeSec(timeMs / 1000)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <Trophy className={`h-5 w-5 ${mStyle.textClass}`} />
                    <span className={`font-display text-lg font-bold ${mStyle.textClass}`}>
                      {mStyle.label}
                    </span>
                  </div>
                  {isNewBest && (
                    <div className="mt-1 flex items-center justify-end gap-1 text-xs font-semibold text-[#39ff14]">
                      <Ghost className="h-3.5 w-3.5" />
                      <span>New Best · Ghost Saved</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3 text-xs text-slate-300">
                <span className="flex items-center gap-1.5 font-semibold text-amber-300 tabular-nums">
                  <Coins className="h-3.5 w-3.5" />
                  +{coinsCollected} Coins
                </span>
                <span className="text-slate-400 tabular-nums">Bank: {totalCoins}</span>
              </div>

              <div className="mt-2.5 flex items-center justify-between text-xs text-slate-400">
                <span>Gold Target: {formatTimeSec(level.parTimes.gold)}</span>
                <span className="tabular-nums">Respawns: {respawns}</span>
              </div>
            </div>
          </>
        )}

        {newlyCompletedMissions.length > 0 && (
          <div className="mt-3.5 rounded-xl border border-amber-400/40 bg-amber-500/10 p-3">
            <div className="flex items-center gap-1.5 text-xs font-bold text-amber-300">
              <Target className="h-3.5 w-3.5" />
              <span>Daily Mission Completed · Claim in Main Menu</span>
            </div>
            <div className="mt-1.5 space-y-1">
              {newlyCompletedMissions.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between text-xs text-slate-200"
                >
                  <span className="truncate">{m.title}</span>
                  <span className="font-semibold text-amber-300 tabular-nums">
                    +{m.rewardCoins}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
          {!isCrash && !isInfinite && hasNextLevel && (
            <button
              type="button"
              onClick={onNextLevel}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-cyan-400 px-4 py-3 text-sm font-bold text-slate-950 transition-colors hover:bg-cyan-300 cursor-pointer whitespace-nowrap"
            >
              <span>Next Level</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onRetry}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold transition-colors cursor-pointer whitespace-nowrap ${
              isCrash
                ? 'bg-rose-500 text-white hover:bg-rose-400'
                : isInfinite
                  ? 'bg-fuchsia-400 text-slate-950 hover:bg-fuchsia-300'
                  : 'border border-white/15 bg-white/5 font-semibold text-white hover:border-cyan-400/50'
            }`}
          >
            <RotateCcw className="h-4 w-4" />
            <span>{isInfinite ? 'Play Again' : isCrash ? 'Retry Course' : 'Retry'}</span>
          </button>
          <button
            type="button"
            onClick={onLevelSelect}
            className="flex items-center justify-center rounded-xl border border-white/15 bg-transparent px-4 py-3 text-sm font-medium text-slate-300 transition-colors hover:border-white/30 hover:text-white cursor-pointer whitespace-nowrap"
          >
            Levels
          </button>
        </div>
      </div>
    </div>
  );
};
