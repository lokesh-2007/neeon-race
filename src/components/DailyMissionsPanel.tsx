import React, { useState } from 'react';
import { Check, ChevronDown, ChevronUp, Coins, Target } from 'lucide-react';
import { getDailyMissionDefinitions } from '../game/missions';
import { DailyMissionsSave } from '../game/types';

interface DailyMissionsPanelProps {
  dailyMissions: DailyMissionsSave;
  onClaimReward: (missionId: string) => void;
}

export const DailyMissionsPanel: React.FC<DailyMissionsPanelProps> = ({
  dailyMissions,
  onClaimReward,
}) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const missions = getDailyMissionDefinitions(dailyMissions);

  const completedCount = missions.filter(
    (m) => (dailyMissions.progress[m.id] ?? 0) >= m.target,
  ).length;
  const claimableCount = missions.filter(
    (m) =>
      (dailyMissions.progress[m.id] ?? 0) >= m.target &&
      !dailyMissions.claimed[m.id],
  ).length;

  return (
    <div className="pointer-events-auto w-full md:w-80">
      {/* Mobile Compact Header Toggle */}
      <button
        type="button"
        onClick={() => setMobileOpen((prev) => !prev)}
        className="flex w-full items-center justify-between rounded-xl border border-white/15 bg-[#070913]/90 px-3.5 py-2.5 text-left md:hidden cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-cyan-300" />
          <span className="font-display text-sm font-bold text-white">
            Daily Missions
          </span>
          <span className="font-mono-tabular text-xs text-slate-400">
            {completedCount}/{missions.length}
          </span>
          {claimableCount > 0 && (
            <span className="rounded-md bg-amber-400/20 px-1.5 py-0.5 text-[11px] font-bold text-amber-300">
              {claimableCount} Ready
            </span>
          )}
        </div>
        {mobileOpen ? (
          <ChevronUp className="h-4 w-4 text-slate-300" />
        ) : (
          <ChevronDown className="h-4 w-4 text-slate-300" />
        )}
      </button>

      {/* Panel Card (always visible on md+, toggled on mobile) */}
      <div
        className={`${
          mobileOpen ? 'mt-2 block' : 'hidden'
        } md:block rounded-2xl border border-white/15 bg-[#070913]/92 p-4`}
      >
        <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-cyan-300" />
            <h2 className="font-display text-sm font-bold tracking-tight text-white">
              Daily Missions
            </h2>
          </div>
          <span className="font-mono-tabular text-xs font-semibold text-slate-400">
            {completedCount}/{missions.length} Done
          </span>
        </div>

        <div className="mt-3 flex max-h-[44dvh] flex-col gap-2.5 overflow-y-auto pr-0.5 md:max-h-[52dvh]">
          {missions.map((mission) => {
            const rawProgress = dailyMissions.progress[mission.id] ?? 0;
            const cur = Math.min(mission.target, rawProgress);
            const pct = Math.min(100, Math.round((cur / mission.target) * 100));
            const isComplete = cur >= mission.target;
            const isClaimed = Boolean(dailyMissions.claimed[mission.id]);

            return (
              <div
                key={mission.id}
                className={`rounded-xl border p-2.5 transition-colors ${
                  isComplete && !isClaimed
                    ? 'border-amber-400/50 bg-amber-500/10'
                    : isClaimed
                      ? 'border-[#39ff14]/25 bg-[#050810]'
                      : 'border-white/10 bg-[#050810]'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-bold text-white">
                      {mission.title}
                    </div>
                    <div className="mt-0.5 text-[11px] leading-snug text-slate-400">
                      {mission.description}
                    </div>
                  </div>

                  {isComplete && !isClaimed ? (
                    <button
                      type="button"
                      onClick={() => onClaimReward(mission.id)}
                      className="flex shrink-0 items-center gap-1 rounded-lg bg-amber-400 px-2.5 py-1 text-[11px] font-bold text-slate-950 transition-colors hover:bg-amber-300 cursor-pointer whitespace-nowrap"
                    >
                      <Coins className="h-3 w-3" />
                      <span>Claim +{mission.rewardCoins}</span>
                    </button>
                  ) : isClaimed ? (
                    <span className="flex shrink-0 items-center gap-1 rounded-lg border border-[#39ff14]/35 bg-[#39ff14]/10 px-2 py-1 text-[11px] font-semibold text-[#39ff14]">
                      <Check className="h-3 w-3" />
                      <span>Claimed</span>
                    </span>
                  ) : (
                    <span className="flex shrink-0 items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-semibold text-amber-300 tabular-nums">
                      <Coins className="h-3 w-3" />
                      <span>+{mission.rewardCoins}</span>
                    </span>
                  )}
                </div>

                {/* Progress Bar & Counter */}
                <div className="mt-2 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-sm bg-white/10">
                    <div
                      className={`h-full transition-all ${
                        isClaimed
                          ? 'bg-[#39ff14]'
                          : isComplete
                            ? 'bg-amber-400'
                            : 'bg-cyan-400'
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="font-mono-tabular text-[11px] font-semibold text-slate-300">
                    {cur}/{mission.target}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
