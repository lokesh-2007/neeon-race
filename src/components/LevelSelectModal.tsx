import React from 'react';
import { ArrowLeft, Infinity as InfinityIcon, Play, Trophy } from 'lucide-react';
import { LEVELS } from '../game/levels';
import { LevelBestRecord, LevelDefinition } from '../game/types';
import { formatTimeSec } from './RacingHud';

interface LevelSelectModalProps {
  bestTimes: Record<string, LevelBestRecord>;
  bestInfiniteDistanceM: number;
  bestInfiniteSector: number;
  onSelectLevel: (level: LevelDefinition) => void;
  onStartInfinite: () => void;
  onBack: () => void;
}

const MEDAL_LABEL: Record<'gold' | 'silver' | 'bronze', { text: string; color: string }> = {
  gold: { text: 'Gold', color: 'text-amber-300' },
  silver: { text: 'Silver', color: 'text-slate-200' },
  bronze: { text: 'Bronze', color: 'text-orange-400' },
};

export const LevelSelectModal: React.FC<LevelSelectModalProps> = ({
  bestTimes,
  bestInfiniteDistanceM,
  bestInfiniteSector,
  onSelectLevel,
  onStartInfinite,
  onBack,
}) => {
  return (
    <div className="fixed inset-0 z-30 overflow-y-auto overscroll-contain bg-[#050508]/86 p-4 sm:p-8 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto w-full max-w-6xl space-y-6 py-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={onBack}
              className="flex h-10 items-center gap-2 rounded-lg border border-white/15 bg-[#0a0d18] px-4 text-sm font-medium text-slate-200 transition-colors hover:border-cyan-400/60 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>Back</span>
            </button>
            <div>
              <h2 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
                Select Mode & Circuit
              </h2>
              <p className="text-xs text-slate-400 sm:text-sm">
                Launch Infinite Mode or race nine circuits across distinct cyber grounds
              </p>
            </div>
          </div>
        </div>

        {/* Featured Infinite Mode Card */}
        <button
          type="button"
          onClick={onStartInfinite}
          className="group flex w-full flex-col justify-between gap-4 rounded-2xl border border-fuchsia-400/50 bg-[#12071b]/95 p-5 text-left transition-colors hover:border-fuchsia-300 hover:bg-[#190a26] sm:flex-row sm:items-center cursor-pointer"
        >
          <div className="max-w-2xl">
            <div className="flex flex-wrap items-center gap-2 text-xs text-fuchsia-300">
              <span className="inline-flex items-center gap-1 font-bold uppercase tracking-wider">
                <InfinityIcon className="h-4 w-4" />
                Infinite Mode
              </span>
              <span aria-hidden="true">·</span>
              <span className="text-slate-300">6 Road Designs · Jump Pads · Speed Rings · New Traps</span>
            </div>
            <h3 className="mt-1.5 font-display text-xl font-bold tracking-tight text-white group-hover:text-fuchsia-200 transition-colors sm:text-2xl">
              Endless Horizon Run
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-300 sm:text-sm">
              Stream infinite sectors cycling through Twin Split-Bridges, Harmonic Wave Decks, Armored Trenches, Photon Conduits, and Precision Skybeams with 3 Shields.
            </p>
          </div>

          <div className="flex shrink-0 items-center justify-between gap-5 border-t border-white/10 pt-3 sm:flex-col sm:items-end sm:border-t-0 sm:pt-0">
            <div className="text-left sm:text-right">
              <div className="text-[11px] text-slate-400">Best Run</div>
              {bestInfiniteDistanceM > 0 ? (
                <div className="font-mono-tabular text-base font-bold text-white">
                  {bestInfiniteDistanceM.toLocaleString()} m{' '}
                  <span className="text-xs font-medium text-fuchsia-300">
                    · Sec {bestInfiniteSector}
                  </span>
                </div>
              ) : (
                <div className="text-xs font-medium text-slate-400">Uncharted</div>
              )}
            </div>

            <span className="inline-flex items-center gap-1.5 rounded-xl bg-fuchsia-400 px-4 py-2.5 text-xs font-bold text-slate-950 transition-colors group-hover:bg-fuchsia-300 whitespace-nowrap">
              <Play className="h-3.5 w-3.5 fill-current" />
              Launch Infinite
            </span>
          </div>
        </button>

        {/* 9-Level Grid (Levels 1-8 + Featured Mega Circuit Level 9) */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {LEVELS.map((level) => {
            const record = bestTimes[level.id];
            const isMega = level.number === 9;
            return (
              <button
                key={level.id}
                type="button"
                onClick={() => onSelectLevel(level)}
                className={`group flex flex-col justify-between rounded-xl border p-4 text-left transition-colors cursor-pointer ${
                  isMega
                    ? 'sm:col-span-2 lg:col-span-4 border-[#39ff14]/40 bg-[#081312]/95 hover:border-[#39ff14] hover:bg-[#0b1a18]'
                    : 'border-white/15 bg-[#090c17]/95 hover:border-cyan-400/70 hover:bg-[#0d1222]'
                }`}
              >
                <div>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
                    <span className="font-semibold" style={{ color: level.accentColor }}>
                      0{level.number}. {level.difficulty}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="text-slate-300">{level.groundLabel}</span>
                    {isMega && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-semibold text-[#39ff14]">Mega Circuit</span>
                      </>
                    )}
                  </div>

                  <h3 className="mt-2 font-display text-lg font-bold tracking-tight text-white group-hover:text-cyan-300 transition-colors">
                    {level.name}
                  </h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                    {level.subtitle}
                  </p>
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3">
                  {record ? (
                    <div className="flex items-center gap-1.5 text-xs">
                      <Trophy className={`h-3.5 w-3.5 ${MEDAL_LABEL[record.medal].color}`} />
                      <span className="font-mono-tabular font-semibold text-white">
                        {formatTimeSec(record.bestTimeMs / 1000)}
                      </span>
                      <span className={MEDAL_LABEL[record.medal].color}>
                        {MEDAL_LABEL[record.medal].text}
                      </span>
                    </div>
                  ) : (
                    <span className="font-mono-tabular text-xs text-slate-500">
                      Gold {formatTimeSec(level.parTimes.gold)}
                    </span>
                  )}

                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-cyan-300 group-hover:translate-x-0.5 transition-transform whitespace-nowrap shrink-0">
                    <Play className="h-3.5 w-3.5 fill-current" />
                    Race
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
