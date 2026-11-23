import React from 'react';
import { ArrowLeft, Play, Trophy } from 'lucide-react';
import { LEVELS } from '../game/levels';
import { LevelBestRecord, LevelDefinition } from '../game/types';
import { formatTimeSec } from './RacingHud';

interface LevelSelectModalProps {
  bestTimes: Record<string, LevelBestRecord>;
  onSelectLevel: (level: LevelDefinition) => void;
  onBack: () => void;
}

const MEDAL_LABEL: Record<'gold' | 'silver' | 'bronze', { text: string; color: string }> = {
  gold: { text: 'Gold', color: 'text-amber-300' },
  silver: { text: 'Silver', color: 'text-slate-200' },
  bronze: { text: 'Bronze', color: 'text-orange-400' },
};

export const LevelSelectModal: React.FC<LevelSelectModalProps> = ({
  bestTimes,
  onSelectLevel,
  onBack,
}) => {
  return (
    <div className="fixed inset-0 z-30 overflow-y-auto bg-[#050508]/86 p-4 sm:p-8">
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
                Select Circuit
              </h2>
              <p className="text-xs text-slate-400 sm:text-sm">
                Eight elevated obstacle courses across distinct cyber grounds
              </p>
            </div>
          </div>
        </div>

        {/* 8-Level Grid */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {LEVELS.map((level) => {
            const record = bestTimes[level.id];
            return (
              <button
                key={level.id}
                type="button"
                onClick={() => onSelectLevel(level)}
                className="group flex flex-col justify-between rounded-xl border border-white/15 bg-[#090c17]/95 p-4 text-left transition-colors hover:border-cyan-400/70 hover:bg-[#0d1222] cursor-pointer"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
                    <span className="font-semibold" style={{ color: level.accentColor }}>
                      0{level.number}. {level.difficulty}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="text-slate-300">{level.groundLabel}</span>
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
