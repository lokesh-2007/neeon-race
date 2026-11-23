import React, { useEffect, useState } from 'react';
import {
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Coins,
  Flame,
  Gamepad2,
  Ghost,
  Infinity as InfinityIcon,
  Orbit,
  Pause,
  RotateCcw,
  Shield,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react';
import { FATAL_TRAP_SPEED_KMH, HudTelemetry, InputState, LevelDefinition } from '../game/types';

interface RacingHudProps {
  level: LevelDefinition;
  hud: HudTelemetry;
  muted: boolean;
  ghostEnabled: boolean;
  onToggleMute: () => void;
  onToggleGhost: () => void;
  onRespawn: () => void;
  onRestart: () => void;
  onPause: () => void;
  onTouchInput: (control: keyof InputState, active: boolean) => void;
}

export function formatTimeSec(sec: number): string {
  const mins = Math.floor(sec / 60);
  const rem = sec - mins * 60;
  const whole = Math.floor(rem);
  const hundredths = Math.floor((rem - whole) * 100);
  return `${String(mins).padStart(2, '0')}:${String(whole).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}

export const RacingHud: React.FC<RacingHudProps> = ({
  level,
  hud,
  muted,
  ghostEnabled,
  onToggleMute,
  onToggleGhost,
  onRespawn,
  onRestart,
  onPause,
  onTouchInput,
}) => {
  const [showTouch, setShowTouch] = useState(false);
  const [nowMs, setNowMs] = useState(() => performance.now());

  useEffect(() => {
    const isTouch =
      typeof window !== 'undefined' &&
      ('ontouchstart' in window || navigator.maxTouchPoints > 0 || window.innerWidth < 768);
    setShowTouch(isTouch);
  }, []);

  const inf = hud.infiniteStats;
  const ringFlashMs = inf?.lastRingFlash ?? 0;
  const sectorFlashMs = inf?.lastSectorFlash ?? 0;

  useEffect(() => {
    if (
      performance.now() - hud.lastCheckpointFlash < 1600 ||
      performance.now() - hud.hazardHitFlash < 700 ||
      performance.now() - ringFlashMs < 1500 ||
      performance.now() - sectorFlashMs < 2000
    ) {
      const id = window.setTimeout(() => setNowMs(performance.now()), 120);
      return () => window.clearTimeout(id);
    }
  }, [hud.lastCheckpointFlash, hud.hazardHitFlash, ringFlashMs, sectorFlashMs, nowMs]);

  const cpFlashing = nowMs - hud.lastCheckpointFlash < 1400;
  const hitFlashing = nowMs - hud.hazardHitFlash < 500;
  const ringFlashing = Boolean(inf && nowMs - ringFlashMs < 1300);
  const sectorFlashing = Boolean(inf && nowMs - sectorFlashMs < 1900);

  const bindHold = (control: keyof InputState) => ({
    onContextMenu: (e: React.MouseEvent<HTMLButtonElement>) => e.preventDefault(),
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Ignore if pointer capture unsupported
      }
      onTouchInput(control, true);
    },
    onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      onTouchInput(control, false);
    },
    onPointerCancel: () => onTouchInput(control, false),
    onLostPointerCapture: () => onTouchInput(control, false),
  });

  return (
    <div className="pointer-events-none fixed inset-0 z-20 flex flex-col justify-between p-3 sm:p-6 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]">
      {/* Hazard screen border flash */}
      {hitFlashing && (
        <div className="pointer-events-none fixed inset-0 border-4 border-[#ff0055]/60" />
      )}

      {/* Top Bar */}
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2 sm:gap-4">
          {/* Top-Left: Level OR Infinite Telemetry (+ compact mobile speed/nitro) */}
          <div className="pointer-events-auto rounded-xl border border-white/15 bg-[#070913]/85 px-3 py-2 sm:px-4 sm:py-3">
            {inf ? (
              <>
                <div className="flex items-center gap-1.5 text-[11px] sm:text-xs text-slate-400">
                  <span className="inline-flex items-center gap-1 font-semibold text-fuchsia-300">
                    <InfinityIcon className="h-3.5 w-3.5" />
                    Sector {inf.sector}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="max-w-[130px] truncate text-slate-200 sm:max-w-none">
                    {inf.roadLabel}
                  </span>
                </div>
                <div className="mt-0.5 flex items-baseline gap-2.5 sm:mt-1 sm:gap-4">
                  <span className="font-mono-tabular text-lg font-bold tracking-tight text-white sm:text-3xl">
                    {inf.distanceM.toLocaleString()}
                    <span className="ml-1 text-xs font-semibold text-cyan-300 sm:text-sm">m</span>
                  </span>
                  <div
                    className="flex items-center gap-1"
                    aria-label={`Shields: ${inf.shields} of ${inf.maxShields}`}
                    title={`Shields: ${inf.shields}/${inf.maxShields} (+1 every 2 sectors)`}
                  >
                    <Shield className="h-3.5 w-3.5 text-cyan-300" />
                    {Array.from({ length: inf.maxShields }).map((_, idx) => (
                      <span
                        key={idx}
                        className={`h-2.5 w-3.5 rounded-sm border ${
                          idx < inf.shields
                            ? 'border-cyan-300 bg-cyan-400'
                            : 'border-white/15 bg-white/5'
                        }`}
                      />
                    ))}
                  </div>
                  <span className="flex items-center gap-1 text-[11px] font-semibold text-amber-300 tabular-nums sm:text-xs">
                    <Coins className="h-3.5 w-3.5" />
                    {hud.coins}
                  </span>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-1.5 text-[11px] sm:text-xs text-slate-400">
                  <span className="font-semibold text-cyan-300">Lv.{level.number}</span>
                  <span aria-hidden="true">·</span>
                  <span className="max-w-[110px] truncate text-slate-200 sm:max-w-none">
                    {level.name}
                  </span>
                </div>
                <div className="mt-0.5 flex items-baseline gap-2.5 sm:mt-1 sm:gap-4">
                  <span className="font-mono-tabular text-lg font-bold tracking-tight text-white sm:text-3xl">
                    {formatTimeSec(hud.elapsedSec)}
                  </span>
                  <span className="text-[11px] font-medium text-slate-300 tabular-nums sm:text-xs">
                    CP {hud.checkpointIndex}/{hud.totalCheckpoints}
                  </span>
                  <span className="flex items-center gap-1 text-[11px] font-semibold text-amber-300 tabular-nums sm:text-xs">
                    <Coins className="h-3.5 w-3.5" />
                    {hud.coins}/{hud.totalTrackCoins}
                  </span>
                </div>
              </>
            )}
            {/* Compact Mobile Speed & Nitro Bar (visible on < md or when touch active on small screens) */}
            <div className="mt-1.5 flex items-center gap-2.5 md:hidden">
              <span
                className={`font-display text-sm font-bold tabular-nums ${
                  hud.speedKmh >= FATAL_TRAP_SPEED_KMH ? 'text-rose-400' : 'text-cyan-300'
                }`}
              >
                {hud.speedKmh} <span className="text-[10px] text-slate-400">KM/H</span>
              </span>
              <div className="h-1.5 w-20 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full transition-all duration-75"
                  style={{
                    width: `${hud.nitro}%`,
                    background: hud.boosting
                      ? 'linear-gradient(90deg, #00f3ff, #ff007f)'
                      : '#00f3ff',
                  }}
                />
              </div>
              {hud.gliding && (
                <span className="text-[10px] font-semibold text-fuchsia-300">Glide</span>
              )}
            </div>
          </div>

          {/* Center Transient Banner (Sector / Ring / Checkpoint) */}
          {sectorFlashing && inf ? (
            <div className="hidden lg:flex items-center rounded-lg border border-fuchsia-400/60 bg-[#14071d]/90 px-4 py-2 text-sm font-semibold tracking-wide text-fuchsia-300">
              Sector {inf.sector} · {inf.roadLabel} · {inf.groundLabel}
            </div>
          ) : ringFlashing ? (
            <div className="hidden lg:flex items-center rounded-lg border border-amber-400/60 bg-[#1a1104]/90 px-4 py-2 text-sm font-semibold tracking-wide text-amber-300">
              Speed Ring · +5 Coins · Nitro Surge
            </div>
          ) : cpFlashing ? (
            <div className="hidden lg:flex items-center rounded-lg border border-[#39ff14]/50 bg-[#07150b]/90 px-4 py-2 text-sm font-semibold tracking-wide text-[#39ff14]">
              Checkpoint Activated · Nitro Recharged
            </div>
          ) : null}

          {/* Top-Right: Quick Actions */}
          <div className="pointer-events-auto flex items-center gap-1.5 sm:gap-2">
            {!inf && (
              <button
                type="button"
                onClick={onToggleGhost}
                title={ghostEnabled ? 'Hide Best Run Ghost' : 'Show Best Run Ghost'}
                className={`flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer sm:h-10 sm:px-3 ${
                  ghostEnabled
                    ? 'border-cyan-400/60 bg-cyan-500/20 text-cyan-200'
                    : 'border-white/15 bg-[#070913]/85 text-slate-400 hover:border-white/30'
                }`}
              >
                <Ghost className="h-4 w-4" />
                <span className="hidden md:inline">{hud.ghostActive ? 'Ghost On' : 'Ghost'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowTouch((v) => !v)}
              title="Toggle On-Screen Touch Controls"
              className={`flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer sm:h-10 sm:px-3 ${
                showTouch
                  ? 'border-cyan-400/60 bg-cyan-500/20 text-cyan-200'
                  : 'border-white/15 bg-[#070913]/85 text-slate-200 hover:border-white/30'
              }`}
            >
              <Gamepad2 className="h-4 w-4" />
              <span className="hidden md:inline">Touch</span>
            </button>

            <button
              type="button"
              onClick={onRespawn}
              title="Respawn at Checkpoint (R)"
              className="flex h-9 items-center gap-1.5 rounded-lg border border-white/15 bg-[#070913]/85 px-2.5 text-xs font-medium text-slate-200 transition-colors hover:border-cyan-400/50 hover:text-white whitespace-nowrap shrink-0 cursor-pointer sm:h-10 sm:px-3"
            >
              <RotateCcw className="h-4 w-4" />
              <span className="hidden sm:inline">Respawn</span>
            </button>

            <button
              type="button"
              onClick={onRestart}
              title="Restart Level"
              className="hidden sm:flex h-10 items-center rounded-lg border border-white/15 bg-[#070913]/85 px-3 text-xs font-medium text-slate-200 transition-colors hover:border-white/30 hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
            >
              Restart
            </button>

            <button
              type="button"
              onClick={onToggleMute}
              aria-label={muted ? 'Unmute audio' : 'Mute audio'}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 bg-[#070913]/85 text-slate-200 transition-colors hover:border-white/30 hover:text-white shrink-0 cursor-pointer sm:h-10 sm:w-10"
            >
              {muted ? <VolumeX className="h-4 w-4 text-rose-400" /> : <Volume2 className="h-4 w-4 text-cyan-300" />}
            </button>

            <button
              type="button"
              onClick={onPause}
              aria-label="Pause game"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 bg-[#070913]/85 text-slate-200 transition-colors hover:border-white/30 hover:text-white shrink-0 cursor-pointer sm:h-10 sm:w-10"
            >
              <Pause className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Mobile Transient Toast */}
        {sectorFlashing && inf ? (
          <div className="mx-auto flex lg:hidden items-center rounded-lg border border-fuchsia-400/60 bg-[#14071d]/90 px-3 py-1 text-xs font-semibold text-fuchsia-300">
            Sector {inf.sector} · {inf.roadLabel}
          </div>
        ) : ringFlashing ? (
          <div className="mx-auto flex lg:hidden items-center rounded-lg border border-amber-400/60 bg-[#1a1104]/90 px-3 py-1 text-xs font-semibold text-amber-300">
            Speed Ring · +5 Coins
          </div>
        ) : cpFlashing ? (
          <div className="mx-auto flex lg:hidden items-center rounded-lg border border-[#39ff14]/50 bg-[#07150b]/90 px-3 py-1 text-xs font-semibold text-[#39ff14]">
            Checkpoint · Nitro Recharged
          </div>
        ) : null}

        {/* Active Infinite Environmental Event Banner */}
        {inf?.activeEvent && (
          <div
            className="mx-auto flex w-full max-w-[300px] sm:max-w-[340px] flex-col gap-1 rounded-lg border bg-[#070913]/90 px-3 py-1.5"
            style={{ borderColor: `${inf.activeEvent.accentColor}88` }}
          >
            <div className="flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-1.5 font-display font-bold uppercase tracking-wider">
                {inf.activeEvent.type === 'neon-storm' ? (
                  <Zap
                    className="h-3.5 w-3.5 shrink-0"
                    style={{ color: inf.activeEvent.accentColor }}
                  />
                ) : inf.activeEvent.type === 'gravity-flux' ? (
                  <Orbit
                    className="h-3.5 w-3.5 shrink-0"
                    style={{ color: inf.activeEvent.accentColor }}
                  />
                ) : (
                  <Flame
                    className="h-3.5 w-3.5 shrink-0"
                    style={{ color: inf.activeEvent.accentColor }}
                  />
                )}
                <span style={{ color: inf.activeEvent.accentColor }}>
                  {inf.activeEvent.label}
                </span>
              </div>
              <span className="font-display text-[11px] font-semibold tabular-nums text-slate-300">
                {inf.activeEvent.remainingSec.toFixed(1)}s
              </span>
            </div>
            <div className="text-[11px] text-slate-300 truncate">
              {inf.activeEvent.description}
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full transition-all duration-75"
                style={{
                  width: `${Math.max(
                    0,
                    Math.min(100, (inf.activeEvent.remainingSec / inf.activeEvent.durationSec) * 100),
                  )}%`,
                  backgroundColor: inf.activeEvent.accentColor,
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Bottom Area: Phone Touch Controls & Desktop Telemetry */}
      <div className="flex items-end justify-between gap-2 sm:gap-4 pb-1 sm:pb-0">
        {/* Bottom-Left: Touch Steering OR Desktop Key Hint */}
        {showTouch ? (
          <div className="pointer-events-auto flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              aria-label="Steer Left"
              {...bindHold('left')}
              className="touch-none select-none flex h-14 w-14 sm:h-16 sm:w-16 items-center justify-center rounded-2xl border border-cyan-400/45 bg-[#070913]/80 text-cyan-200 active:bg-cyan-500/35"
            >
              <ChevronLeft className="h-7 w-7 sm:h-8 sm:w-8" />
            </button>
            <button
              type="button"
              aria-label="Steer Right"
              {...bindHold('right')}
              className="touch-none select-none flex h-14 w-14 sm:h-16 sm:w-16 items-center justify-center rounded-2xl border border-cyan-400/45 bg-[#070913]/80 text-cyan-200 active:bg-cyan-500/35"
            >
              <ChevronRight className="h-7 w-7 sm:h-8 sm:w-8" />
            </button>
          </div>
        ) : (
          <div className="hidden md:flex items-center gap-3 rounded-lg border border-white/10 bg-[#070913]/80 px-3.5 py-2 text-xs text-slate-300">
            <span>WASD / Arrows: Drive</span>
            <span aria-hidden="true">·</span>
            <span>Space: Nitro</span>
            <span aria-hidden="true">·</span>
            <span>Shift: Jump</span>
            <span aria-hidden="true">·</span>
            <span>R: Respawn</span>
            <span aria-hidden="true">·</span>
            <span>P: Pause</span>
          </div>
        )}

        {/* Bottom-Right: Touch Pedals + Desktop Jump Button + Telemetry Cluster */}
        <div className="flex items-end gap-2.5 sm:gap-3 ml-auto">
          {showTouch ? (
            <div className="pointer-events-auto flex items-end gap-1.5 sm:gap-2.5">
              <button
                type="button"
                {...bindHold('brake')}
                className="touch-none select-none flex h-12 w-12 sm:h-15 sm:w-15 items-center justify-center rounded-2xl border border-rose-400/45 bg-[#070913]/80 text-[11px] sm:text-xs font-semibold text-rose-200 active:bg-rose-500/35"
              >
                Brake
              </button>
              <button
                type="button"
                aria-label="Jump"
                {...bindHold('jump')}
                className="touch-none select-none flex h-12 w-12 sm:h-15 sm:w-15 flex-col items-center justify-center gap-0.5 rounded-2xl border border-amber-400/55 bg-[#070913]/85 text-[10px] sm:text-xs font-bold text-amber-200 active:bg-amber-500/35"
              >
                <ArrowUp className="h-4 w-4 sm:h-5 sm:w-5" />
                <span>Jump</span>
              </button>
              <button
                type="button"
                aria-label="Nitro Boost"
                {...bindHold('boost')}
                className="touch-none select-none flex h-12 w-12 sm:h-15 sm:w-15 items-center justify-center rounded-2xl border border-fuchsia-400/50 bg-[#070913]/80 text-fuchsia-200 active:bg-fuchsia-500/35"
              >
                <Flame className="h-5 w-5 sm:h-6 sm:w-6" />
              </button>
              <button
                type="button"
                {...bindHold('throttle')}
                className="touch-none select-none flex h-15 w-14 sm:h-20 sm:w-18 items-center justify-center rounded-2xl border border-[#39ff14]/55 bg-[#070913]/85 text-xs sm:text-sm font-bold text-[#39ff14] active:bg-[#39ff14]/25"
              >
                Gas
              </button>
            </div>
          ) : (
            <button
              type="button"
              aria-label="Jump (Shift)"
              title="Jump (Shift)"
              {...bindHold('jump')}
              className="pointer-events-auto hidden md:flex h-16 w-16 flex-col items-center justify-center gap-1 rounded-xl border border-amber-400/55 bg-[#070913]/88 text-xs font-bold text-amber-200 transition-colors hover:border-amber-300 hover:bg-amber-500/20 active:bg-amber-500/35 cursor-pointer select-none"
            >
              <ArrowUp className="h-5 w-5" />
              <span>Jump</span>
            </button>
          )}

          {/* Desktop / Tablet Speed & Nitro Cluster */}
          <div className="pointer-events-auto hidden md:block min-w-[190px] rounded-xl border border-white/15 bg-[#070913]/88 px-4 py-3 text-right">
            <div className="flex items-center justify-end gap-2 text-xs font-medium text-slate-400">
              {hud.speedKmh >= FATAL_TRAP_SPEED_KMH && (
                <span className="font-semibold text-rose-400">High-Speed Risk</span>
              )}
              {hud.gliding && <span className="text-fuchsia-300">Gliding</span>}
              {!hud.gliding && hud.airborne && <span className="text-amber-300">Airborne</span>}
              {hud.drifting && <span className="text-fuchsia-400">Drift</span>}
              {hud.boosting && <span className="text-cyan-300">Nitro Active</span>}
              {hud.speedKmh < FATAL_TRAP_SPEED_KMH &&
                !hud.airborne &&
                !hud.drifting &&
                !hud.boosting && <span>Telemetry</span>}
            </div>

            <div className="mt-0.5 flex items-baseline justify-end gap-1.5">
              <span
                className={`font-display text-4xl font-bold tracking-tight tabular-nums ${
                  hud.speedKmh >= FATAL_TRAP_SPEED_KMH ? 'text-rose-400' : 'text-white'
                }`}
              >
                {hud.speedKmh}
              </span>
              <span className="text-xs font-semibold text-slate-400">KM/H</span>
            </div>

            {/* Nitro Bar */}
            <div className="mt-2">
              <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-slate-400">
                <span>Nitro</span>
                <span className="font-mono-tabular text-cyan-300">{hud.nitro}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full transition-all duration-75"
                  style={{
                    width: `${hud.nitro}%`,
                    background: hud.boosting
                      ? 'linear-gradient(90deg, #00f3ff, #ff007f)'
                      : '#00f3ff',
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
