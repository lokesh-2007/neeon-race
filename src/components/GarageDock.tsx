import React from 'react';
import { ArrowLeft, Check, Coins, Wind } from 'lucide-react';
import {
  CHASSIS_SPECS,
  ChassisId,
  GarageConfig,
  GLIDER_SPECS,
  GliderId,
  NEON_PRESETS,
} from '../game/types';

interface GarageDockProps {
  garage: GarageConfig;
  steeringSensitivity: number;
  totalCoins: number;
  onChangeGarage: (next: GarageConfig) => void;
  onChangeSensitivity: (val: number) => void;
  onClose: () => void;
  onRace: () => void;
}

const CHASSIS_ORDER: ChassisId[] = [
  'interceptor',
  'apex',
  'vortex',
  'titan',
  'phantom',
  'spectre',
  'valkyrie',
  'nemesis',
  'nova',
  'zenith',
];

const GLIDER_ORDER: GliderId[] = ['none', 'aero-wings', 'plasma-kite', 'jet-pack'];

export const GarageDock: React.FC<GarageDockProps> = ({
  garage,
  steeringSensitivity,
  totalCoins,
  onChangeGarage,
  onChangeSensitivity,
  onClose,
  onRace,
}) => {
  const activeSpec = CHASSIS_SPECS[garage.chassisId];
  const activeGlider = GLIDER_SPECS[garage.gliderId];

  return (
    <div className="pointer-events-none fixed inset-0 z-30 flex flex-col justify-between p-4 sm:p-6">
      {/* Top Bar */}
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={onClose}
          className="pointer-events-auto flex h-10 items-center gap-2 rounded-lg border border-white/15 bg-[#070913]/90 px-4 text-sm font-medium text-slate-200 transition-colors hover:border-cyan-400/50 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back</span>
        </button>

        <div className="pointer-events-auto flex flex-col items-end gap-1.5">
          <div className="rounded-lg border border-white/15 bg-[#070913]/90 px-4 py-2 text-right">
            <div className="font-display text-base sm:text-lg font-bold tracking-tight text-white">
              {activeSpec.name}
            </div>
            <div className="text-[11px] sm:text-xs text-slate-400">{activeSpec.tagline}</div>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg border border-amber-400/35 bg-[#070913]/90 px-3 py-1 text-xs font-semibold text-amber-300 tabular-nums">
            <Coins className="h-3.5 w-3.5" />
            <span>{totalCoins} Coins</span>
          </div>
        </div>
      </div>

      {/* Bottom Dock (keeps center 3D car & glider unobstructed; scrollable on narrow phones) */}
      <div className="pointer-events-auto mx-auto w-full max-w-5xl max-h-[54vh] overflow-y-auto lg:max-h-none lg:overflow-visible rounded-2xl border border-white/15 bg-[#070913]/92 p-3.5 sm:p-5">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-center">
          {/* Chassis Selector */}
          <div className="lg:col-span-5 space-y-2.5">
            <div className="text-xs font-medium text-slate-400">
              Select Vehicle · 10 Frames
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 lg:grid-cols-3 gap-1.5">
              {CHASSIS_ORDER.map((id) => {
                const spec = CHASSIS_SPECS[id];
                const selected = garage.chassisId === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onChangeGarage({ ...garage, chassisId: id })}
                    className={`rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition-colors whitespace-nowrap truncate cursor-pointer ${
                      selected
                        ? 'border-cyan-400 bg-cyan-500/20 text-white'
                        : 'border-white/12 bg-white/5 text-slate-300 hover:border-white/25 hover:text-white'
                    }`}
                  >
                    {spec.name}
                  </button>
                );
              })}
            </div>

            {/* Performance Bars */}
            <div className="grid grid-cols-3 gap-3 pt-1">
              {[
                { label: 'Speed', val: activeSpec.stats.speed },
                { label: 'Grip', val: activeSpec.stats.grip },
                { label: 'Nitro', val: activeSpec.stats.boost },
              ].map((s) => (
                <div key={s.label}>
                  <div className="flex justify-between text-[11px] text-slate-400">
                    <span>{s.label}</span>
                    <span className="font-mono-tabular text-slate-200">{s.val}</span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-cyan-400 transition-all duration-200"
                      style={{ width: `${s.val}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Glider, Neon Trim Colors & Steering Sensitivity */}
          <div className="lg:col-span-5 space-y-3 border-t border-white/10 pt-3.5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-5">
            {/* Glider Selector */}
            <div>
              <div className="mb-1.5 flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 font-medium text-slate-300">
                  <Wind className="h-3.5 w-3.5 text-cyan-300" />
                  Glider Wing
                </span>
                <span className="text-[11px] text-slate-400 truncate max-w-[200px]">
                  {activeGlider.tagline}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {GLIDER_ORDER.map((gid) => {
                  const gSpec = GLIDER_SPECS[gid];
                  const selected = garage.gliderId === gid;
                  return (
                    <button
                      key={gid}
                      type="button"
                      onClick={() => onChangeGarage({ ...garage, gliderId: gid })}
                      className={`rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition-colors whitespace-nowrap truncate cursor-pointer ${
                        selected
                          ? 'border-fuchsia-400 bg-fuchsia-500/20 text-white'
                          : 'border-white/12 bg-white/5 text-slate-300 hover:border-white/25 hover:text-white'
                      }`}
                    >
                      {gSpec.name}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <div className="mb-1.5 text-xs font-medium text-slate-400">Primary Neon</div>
                <div className="flex flex-wrap gap-1.5">
                  {NEON_PRESETS.map((preset) => {
                    const active = garage.primaryColor.toLowerCase() === preset.hex.toLowerCase();
                    return (
                      <button
                        key={`p-${preset.hex}`}
                        type="button"
                        title={preset.name}
                        aria-label={`Primary color ${preset.name}`}
                        onClick={() => onChangeGarage({ ...garage, primaryColor: preset.hex })}
                        className={`flex h-6 w-6 items-center justify-center rounded-full border transition-transform cursor-pointer ${
                          active ? 'scale-110 border-white' : 'border-white/25 hover:scale-105'
                        }`}
                        style={{ backgroundColor: preset.hex }}
                      >
                        {active && <Check className="h-3 w-3 text-slate-950 stroke-[3]" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="mb-1.5 text-xs font-medium text-slate-400">Secondary Neon</div>
                <div className="flex flex-wrap gap-1.5">
                  {NEON_PRESETS.map((preset) => {
                    const active = garage.secondaryColor.toLowerCase() === preset.hex.toLowerCase();
                    return (
                      <button
                        key={`s-${preset.hex}`}
                        type="button"
                        title={preset.name}
                        aria-label={`Secondary color ${preset.name}`}
                        onClick={() => onChangeGarage({ ...garage, secondaryColor: preset.hex })}
                        className={`flex h-6 w-6 items-center justify-center rounded-full border transition-transform cursor-pointer ${
                          active ? 'scale-110 border-white' : 'border-white/25 hover:scale-105'
                        }`}
                        style={{ backgroundColor: preset.hex }}
                      >
                        {active && <Check className="h-3 w-3 text-slate-950 stroke-[3]" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Steering Sensitivity Slider */}
            <div className="pt-0.5">
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="font-medium text-slate-300">Steering Sensitivity</span>
                <span className="font-mono-tabular font-semibold text-cyan-300">
                  {Math.round(steeringSensitivity * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0.4}
                max={1.8}
                step={0.05}
                value={steeringSensitivity}
                onChange={(e) => onChangeSensitivity(parseFloat(e.target.value))}
                aria-label="Steering Sensitivity"
                className="h-2 w-full cursor-pointer accent-cyan-400"
              />
            </div>
          </div>

          {/* Launch Action */}
          <div className="lg:col-span-2 flex justify-end">
            <button
              type="button"
              onClick={onRace}
              className="w-full lg:w-auto rounded-xl bg-cyan-400 px-5 py-3 text-sm font-bold text-slate-950 transition-colors hover:bg-cyan-300 whitespace-nowrap shrink-0 cursor-pointer"
            >
              Race Now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
