import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Coins,
  Ghost,
  Map,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
  Wrench,
} from 'lucide-react';
import { GarageDock } from './components/GarageDock';
import { LevelSelectModal } from './components/LevelSelectModal';
import { RacingHud } from './components/RacingHud';
import { VictoryModal } from './components/VictoryModal';
import { GameEngine } from './game/GameEngine';
import { LEVELS } from './game/levels';
import {
  loadProgress,
  recordLevelCompletion,
  saveGarageConfig,
  saveGhostEnabled,
  saveMutePreference,
  saveSteeringSensitivity,
} from './game/storage';
import {
  GarageConfig,
  HudTelemetry,
  InputState,
  LevelDefinition,
  SavedProgress,
  ScreenMode,
} from './game/types';

const INITIAL_HUD: HudTelemetry = {
  speedKmh: 0,
  nitro: 100,
  elapsedSec: 0,
  checkpointIndex: 0,
  totalCheckpoints: 0,
  coins: 0,
  totalTrackCoins: 0,
  airborne: false,
  gliding: false,
  drifting: false,
  boosting: false,
  ghostActive: false,
  respawns: 0,
  lastCheckpointFlash: 0,
  hazardHitFlash: 0,
};

export default function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);

  const [saveData, setSaveData] = useState<SavedProgress>(() => loadProgress());
  const [screen, setScreen] = useState<ScreenMode>('title');
  const [activeLevel, setActiveLevel] = useState<LevelDefinition>(LEVELS[0]);
  const [hud, setHud] = useState<HudTelemetry>(INITIAL_HUD);
  const [contextLost, setContextLost] = useState(false);

  const [victoryInfo, setVictoryInfo] = useState<{
    timeMs: number;
    respawns: number;
    coinsCollected: number;
    medal: 'gold' | 'silver' | 'bronze';
    isNewBest: boolean;
  } | null>(null);

  const activeLevelRef = useRef<LevelDefinition>(activeLevel);
  activeLevelRef.current = activeLevel;

  const screenRef = useRef<ScreenMode>(screen);
  screenRef.current = screen;

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const initialSave = loadProgress();
    const engine = new GameEngine(
      container,
      initialSave.garage,
      initialSave.muted,
      initialSave.steeringSensitivity,
      initialSave.ghostEnabled,
      {
        onHudUpdate: (nextHud) => {
          setHud(nextHud);
        },
        onLevelComplete: (timeMs, respawns, coinsCollected, ghostRun) => {
          const lvl = activeLevelRef.current;
          const res = recordLevelCompletion(
            lvl.id,
            timeMs,
            lvl.parTimes,
            coinsCollected,
            ghostRun,
          );
          setSaveData(res.progress);
          setVictoryInfo({
            timeMs,
            respawns,
            coinsCollected,
            medal: res.medal,
            isNewBest: res.isNewBest,
          });
          setScreen('victory');
        },
        onPauseToggle: () => {
          if (screenRef.current === 'playing') {
            engine.setMode('paused');
            setScreen('paused');
          } else if (screenRef.current === 'paused') {
            engine.setMode('playing');
            setScreen('playing');
          }
        },
        onContextLost: (lost) => {
          setContextLost(lost);
        },
      },
    );

    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  const handleToggleMute = useCallback(() => {
    setSaveData((prev) => {
      const nextMuted = !prev.muted;
      engineRef.current?.audio.unlock();
      engineRef.current?.audio.setMuted(nextMuted);
      return saveMutePreference(nextMuted);
    });
  }, []);

  const handleToggleGhost = useCallback(() => {
    setSaveData((prev) => {
      const nextGhost = !prev.ghostEnabled;
      engineRef.current?.setGhostEnabled(nextGhost);
      return saveGhostEnabled(nextGhost);
    });
  }, []);

  const handleChangeGarage = useCallback((nextGarage: GarageConfig) => {
    engineRef.current?.audio.unlock();
    engineRef.current?.updateGarage(nextGarage);
    setSaveData(saveGarageConfig(nextGarage));
  }, []);

  const handleChangeSensitivity = useCallback((val: number) => {
    engineRef.current?.setSteeringSensitivity(val);
    setSaveData(saveSteeringSensitivity(val));
  }, []);

  const handleStartLevel = useCallback((level: LevelDefinition) => {
    engineRef.current?.audio.unlock();
    const latest = loadProgress();
    const bestGhost = latest.ghostRuns[level.id] ?? null;
    setActiveLevel(level);
    setVictoryInfo(null);
    setScreen('playing');
    engineRef.current?.startLevel(level, bestGhost);
  }, []);

  const handleOpenScreen = useCallback((next: ScreenMode) => {
    engineRef.current?.audio.unlock();
    engineRef.current?.setMode(next);
    setScreen(next);
  }, []);

  const handleTouchInput = useCallback((control: keyof InputState, active: boolean) => {
    engineRef.current?.audio.unlock();
    engineRef.current?.setTouchInput(control, active);
  }, []);

  const activeLevelIdx = LEVELS.findIndex((l) => l.id === activeLevel.id);
  const hasNextLevel = activeLevelIdx >= 0 && activeLevelIdx < LEVELS.length - 1;

  return (
    <div className="relative h-[100dvh] w-screen overflow-hidden bg-[#050508]">
      {/* Isolated WebGL Viewport Container */}
      <div ref={mountRef} className="absolute inset-0 h-full w-full" />

      {/* WebGL Context Lost Fallback */}
      {contextLost && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#050508]/95 p-6 text-center">
          <div className="max-w-md rounded-2xl border border-white/15 bg-[#0a0d18] p-6">
            <h2 className="font-display text-xl font-bold text-white">
              Graphics Context Interrupted
            </h2>
            <p className="mt-2 text-sm text-slate-400">
              WebGL rendering was temporarily suspended by the browser. Restore or reload to continue racing.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 rounded-xl bg-cyan-400 px-5 py-2.5 text-sm font-bold text-slate-950 hover:bg-cyan-300 cursor-pointer"
            >
              Reload Game
            </button>
          </div>
        </div>
      )}

      {/* Title Screen Overlay (leaves center 3D car showcase unobstructed) */}
      {screen === 'title' && (
        <div className="pointer-events-none fixed inset-0 z-20 flex flex-col justify-between p-4 sm:p-8">
          {/* Top Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="pointer-events-auto max-w-xl">
              <div className="text-[11px] sm:text-xs font-semibold tracking-wider text-cyan-300">
                Arcade Stunt Driving · 9 Circuits · 10 Vehicles
              </div>
              <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-white sm:text-5xl text-balance">
                Neon Challenge Legends
              </h1>
              <p className="mt-1.5 text-xs text-slate-300 sm:mt-2 sm:text-base">
                Defy gravity across cyber sky-tracks, 360-degree corkscrew loops, and laser gauntlets.
              </p>
            </div>

            <div className="pointer-events-auto flex items-center gap-2 shrink-0">
              <div className="flex h-10 sm:h-11 items-center gap-1.5 rounded-xl border border-amber-400/35 bg-[#070913]/85 px-3 text-xs sm:text-sm font-semibold text-amber-300 tabular-nums">
                <Coins className="h-4 w-4" />
                <span>{saveData.totalCoins}</span>
              </div>
              <button
                type="button"
                onClick={handleToggleMute}
                aria-label={saveData.muted ? 'Unmute audio' : 'Mute audio'}
                className="flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-xl border border-white/15 bg-[#070913]/85 text-slate-200 transition-colors hover:border-cyan-400/60 hover:text-white shrink-0 cursor-pointer"
              >
                {saveData.muted ? (
                  <VolumeX className="h-5 w-5 text-rose-400" />
                ) : (
                  <Volume2 className="h-5 w-5 text-cyan-300" />
                )}
              </button>
            </div>
          </div>

          {/* Bottom Unified Action Dock */}
          <div className="pointer-events-auto mx-auto flex w-full max-w-2xl flex-wrap items-center justify-center gap-2.5 rounded-2xl border border-white/15 bg-[#070913]/90 p-3 sm:justify-between sm:px-5 sm:py-3.5">
            <div className="flex w-full sm:w-auto flex-wrap items-center justify-center gap-2 sm:gap-2.5">
              <button
                type="button"
                onClick={() => handleStartLevel(activeLevel)}
                className="flex flex-1 sm:flex-none items-center justify-center gap-2 rounded-xl bg-cyan-400 px-4 sm:px-6 py-3 text-sm font-bold text-slate-950 transition-colors hover:bg-cyan-300 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Play className="h-4 w-4 fill-current" />
                <span>Play Level {activeLevel.number}</span>
              </button>

              <button
                type="button"
                onClick={() => handleOpenScreen('levels')}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-3.5 sm:px-4 py-3 text-sm font-semibold text-white transition-colors hover:border-cyan-400/60 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Map className="h-4 w-4 text-cyan-300" />
                <span>Levels</span>
              </button>

              <button
                type="button"
                onClick={() => handleOpenScreen('garage')}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-3.5 sm:px-4 py-3 text-sm font-semibold text-white transition-colors hover:border-fuchsia-400/60 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Wrench className="h-4 w-4 text-fuchsia-400" />
                <span>Garage</span>
              </button>
            </div>

            <div className="hidden sm:block text-xs text-slate-400">
              WASD / Arrows · Space Nitro
            </div>
          </div>
        </div>
      )}

      {/* Level Select Overlay */}
      {screen === 'levels' && (
        <LevelSelectModal
          bestTimes={saveData.bestTimes}
          onSelectLevel={handleStartLevel}
          onBack={() => handleOpenScreen('title')}
        />
      )}

      {/* Garage Customization Dock */}
      {screen === 'garage' && (
        <GarageDock
          garage={saveData.garage}
          steeringSensitivity={saveData.steeringSensitivity}
          totalCoins={saveData.totalCoins}
          onChangeGarage={handleChangeGarage}
          onChangeSensitivity={handleChangeSensitivity}
          onClose={() => handleOpenScreen('title')}
          onRace={() => handleStartLevel(activeLevel)}
        />
      )}

      {/* Active Racing HUD */}
      {screen === 'playing' && (
        <RacingHud
          level={activeLevel}
          hud={hud}
          muted={saveData.muted}
          ghostEnabled={saveData.ghostEnabled}
          onToggleMute={handleToggleMute}
          onToggleGhost={handleToggleGhost}
          onRespawn={() => engineRef.current?.respawnAtCheckpoint()}
          onRestart={() => engineRef.current?.restartLevel()}
          onPause={() => handleOpenScreen('paused')}
          onTouchInput={handleTouchInput}
        />
      )}

      {/* Pause Modal */}
      {screen === 'paused' && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-[#050508]/82 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-white/15 bg-[#090c17] p-6">
            <div className="text-xs text-slate-400">
              Level {activeLevel.number} · {activeLevel.name}
            </div>
            <h2 className="mt-1 font-display text-2xl font-bold text-white">
              Race Paused
            </h2>

            {/* Steering Sensitivity & Ghost Replay Controls */}
            <div className="mt-4 space-y-3 rounded-xl border border-white/10 bg-[#05070e] p-3.5">
              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-300">Steering Sensitivity</span>
                  <span className="font-mono-tabular font-semibold text-cyan-300">
                    {Math.round(saveData.steeringSensitivity * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0.4}
                  max={1.8}
                  step={0.05}
                  value={saveData.steeringSensitivity}
                  onChange={(e) => handleChangeSensitivity(parseFloat(e.target.value))}
                  aria-label="Steering Sensitivity"
                  className="h-2 w-full cursor-pointer accent-cyan-400"
                />
              </div>

              <div className="flex items-center justify-between border-t border-white/10 pt-2.5 text-xs">
                <span className="flex items-center gap-1.5 font-medium text-slate-300">
                  <Ghost className="h-3.5 w-3.5 text-cyan-300" />
                  Best Run Ghost
                </span>
                <button
                  type="button"
                  onClick={handleToggleGhost}
                  className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer ${
                    saveData.ghostEnabled
                      ? 'border-cyan-400/60 bg-cyan-500/20 text-cyan-200'
                      : 'border-white/15 bg-white/5 text-slate-400'
                  }`}
                >
                  {saveData.ghostEnabled ? 'Enabled' : 'Disabled'}
                </button>
              </div>
            </div>

            <div className="mt-5 flex flex-col gap-2.5">
              <button
                type="button"
                onClick={() => handleOpenScreen('playing')}
                className="flex items-center justify-center gap-2 rounded-xl bg-cyan-400 px-4 py-3 text-sm font-bold text-slate-950 transition-colors hover:bg-cyan-300 cursor-pointer"
              >
                <Play className="h-4 w-4 fill-current" />
                <span>Resume Race</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setScreen('playing');
                  engineRef.current?.restartLevel();
                }}
                className="flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition-colors hover:border-cyan-400/50 cursor-pointer"
              >
                <RotateCcw className="h-4 w-4" />
                <span>Restart Level</span>
              </button>

              <button
                type="button"
                onClick={() => handleOpenScreen('levels')}
                className="rounded-xl border border-white/15 bg-transparent px-4 py-3 text-sm font-medium text-slate-300 transition-colors hover:border-white/30 hover:text-white cursor-pointer"
              >
                Level Select
              </button>

              <button
                type="button"
                onClick={() => handleOpenScreen('title')}
                className="rounded-xl border border-white/10 bg-transparent px-4 py-2.5 text-sm font-medium text-slate-400 transition-colors hover:text-white cursor-pointer"
              >
                Main Menu
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Victory Summary Modal */}
      {screen === 'victory' && victoryInfo && (
        <VictoryModal
          level={activeLevel}
          timeMs={victoryInfo.timeMs}
          respawns={victoryInfo.respawns}
          coinsCollected={victoryInfo.coinsCollected}
          totalCoins={saveData.totalCoins}
          medal={victoryInfo.medal}
          isNewBest={victoryInfo.isNewBest}
          hasNextLevel={hasNextLevel}
          onNextLevel={() => handleStartLevel(LEVELS[activeLevelIdx + 1])}
          onRetry={() => handleStartLevel(activeLevel)}
          onLevelSelect={() => handleOpenScreen('levels')}
        />
      )}
    </div>
  );
}
