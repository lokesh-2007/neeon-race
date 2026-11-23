export class AudioSynth {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private engineOsc1: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private muted = false;
  private musicActive = false;
  private schedulerTimer: number | null = null;
  private nextNoteTime = 0;
  private stepIndex = 0;

  // 128 BPM synthwave driving 16th notes
  private readonly stepDuration = 60 / 128 / 4;
  // Bassline pattern (MIDI notes across 4 bars of 16 steps = 64 steps)
  // Progression: A1 -> F1 -> G1 -> E1
  private readonly bassRoots = [33, 29, 31, 28];
  private readonly arpOffsets = [12, 19, 24, 27, 24, 19, 15, 19];

  constructor(initialMuted = false) {
    this.muted = initialMuted;
  }

  public unlock(): void {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : 0.72;
      this.masterGain.connect(this.ctx.destination);

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.24;
      this.musicGain.connect(this.masterGain);

      this.setupEngineVoice();
      this.noiseBuffer = this.createNoiseBuffer();
    }

    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  private setupEngineVoice(): void {
    if (!this.ctx || !this.masterGain) return;

    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 180;
    this.engineFilter.Q.value = 3.2;

    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0.0;

    this.engineOsc1 = this.ctx.createOscillator();
    this.engineOsc1.type = 'sawtooth';
    this.engineOsc1.frequency.value = 55;

    this.engineOsc2 = this.ctx.createOscillator();
    this.engineOsc2.type = 'triangle';
    this.engineOsc2.frequency.value = 110;

    this.engineOsc1.connect(this.engineFilter);
    this.engineOsc2.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.masterGain);

    this.engineOsc1.start();
    this.engineOsc2.start();
  }

  private createNoiseBuffer(): AudioBuffer | null {
    if (!this.ctx) return null;
    const length = Math.floor(this.ctx.sampleRate * 0.6);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.72, this.ctx.currentTime, 0.04);
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public startMusic(): void {
    this.unlock();
    if (this.musicActive || !this.ctx) return;
    this.musicActive = true;
    this.nextNoteTime = this.ctx.currentTime + 0.05;
    this.stepIndex = 0;

    const tick = () => {
      if (!this.musicActive || !this.ctx) return;
      while (this.nextNoteTime < this.ctx.currentTime + 0.14) {
        this.scheduleStep(this.stepIndex, this.nextNoteTime);
        this.nextNoteTime += this.stepDuration;
        this.stepIndex = (this.stepIndex + 1) % 64;
      }
      this.schedulerTimer = window.setTimeout(tick, 35);
    };
    tick();
  }

  public stopMusic(): void {
    this.musicActive = false;
    if (this.schedulerTimer !== null) {
      window.clearTimeout(this.schedulerTimer);
      this.schedulerTimer = null;
    }
  }

  public suspend(): void {
    if (this.ctx && this.ctx.state === 'running') {
      void this.ctx.suspend();
    }
  }

  public resume(): void {
    if (this.ctx && this.ctx.state === 'suspended' && !this.muted) {
      void this.ctx.resume();
    }
  }

  private midiToFreq(midi: number): number {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  private scheduleStep(step: number, time: number): void {
    if (!this.ctx || !this.musicGain || this.muted) return;

    const bar = Math.floor(step / 16);
    const stepInBar = step % 16;
    const root = this.bassRoots[bar];

    // Driving 16th-note synthwave bassline (octave pulse on off-beats)
    const bassMidi = stepInBar % 4 === 2 ? root + 12 : root;
    const bassFreq = this.midiToFreq(bassMidi);

    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(bassFreq, time);

    filter.type = 'lowpass';
    filter.Q.value = 4.0;
    filter.frequency.setValueAtTime(950, time);
    filter.frequency.exponentialRampToValueAtTime(190, time + this.stepDuration * 0.9);

    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(0.32, time + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, time + this.stepDuration * 0.92);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicGain);

    osc.start(time);
    osc.stop(time + this.stepDuration);

    // Punchy synth kick on quarter notes (0, 4, 8, 12)
    if (stepInBar % 4 === 0) {
      const kickOsc = this.ctx.createOscillator();
      const kickGain = this.ctx.createGain();
      kickOsc.type = 'sine';
      kickOsc.frequency.setValueAtTime(135, time);
      kickOsc.frequency.exponentialRampToValueAtTime(40, time + 0.12);
      kickGain.gain.setValueAtTime(0.45, time);
      kickGain.gain.exponentialRampToValueAtTime(0.001, time + 0.14);
      kickOsc.connect(kickGain);
      kickGain.connect(this.musicGain);
      kickOsc.start(time);
      kickOsc.stop(time + 0.15);
    }

    // Crisp synth snare on beats 2 & 4 (steps 4 & 12)
    if ((stepInBar === 4 || stepInBar === 12) && this.noiseBuffer) {
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      const hp = this.ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1200;
      const nGain = this.ctx.createGain();
      nGain.gain.setValueAtTime(0.18, time);
      nGain.gain.exponentialRampToValueAtTime(0.001, time + 0.14);
      noise.connect(hp);
      hp.connect(nGain);
      nGain.connect(this.musicGain);
      noise.start(time);
      noise.stop(time + 0.15);
    }

    // Shimmering 8th-note lead arp
    if (step % 2 === 0) {
      const arpNote = root + 12 + this.arpOffsets[(step / 2) % this.arpOffsets.length];
      const arpOsc = this.ctx.createOscillator();
      const arpGain = this.ctx.createGain();
      arpOsc.type = 'triangle';
      arpOsc.frequency.setValueAtTime(this.midiToFreq(arpNote), time);
      arpGain.gain.setValueAtTime(0.001, time);
      arpGain.gain.linearRampToValueAtTime(0.11, time + 0.01);
      arpGain.gain.exponentialRampToValueAtTime(0.001, time + this.stepDuration * 1.8);
      arpOsc.connect(arpGain);
      arpGain.connect(this.musicGain);
      arpOsc.start(time);
      arpOsc.stop(time + this.stepDuration * 1.85);
    }
  }

  public updateEngine(speedRatio: number, boosting: boolean, active: boolean): void {
    if (!this.ctx || !this.engineOsc1 || !this.engineOsc2 || !this.engineFilter || !this.engineGain) {
      return;
    }
    const now = this.ctx.currentTime;
    if (!active || this.muted) {
      this.engineGain.gain.setTargetAtTime(0, now, 0.08);
      return;
    }

    const clamped = Math.max(0, Math.min(1.4, speedRatio));
    const baseFreq = 48 + clamped * 125 + (boosting ? 34 : 0);
    const filterCutoff = 180 + clamped * 1100 + (boosting ? 900 : 0);
    const vol = 0.055 + Math.min(1, clamped) * 0.085 + (boosting ? 0.03 : 0);

    this.engineOsc1.frequency.setTargetAtTime(baseFreq, now, 0.04);
    this.engineOsc2.frequency.setTargetAtTime(baseFreq * 1.995, now, 0.04);
    this.engineFilter.frequency.setTargetAtTime(filterCutoff, now, 0.05);
    this.engineGain.gain.setTargetAtTime(vol, now, 0.05);
  }

  public playBoost(): void {
    this.unlock();
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;

    if (this.noiseBuffer) {
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 2.4;
      bp.frequency.setValueAtTime(320, now);
      bp.frequency.exponentialRampToValueAtTime(3200, now + 0.35);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.01, now);
      gain.gain.linearRampToValueAtTime(0.28, now + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.42);

      noise.connect(bp);
      bp.connect(gain);
      gain.connect(this.masterGain);
      noise.start(now);
      noise.stop(now + 0.45);
    }

    const osc = this.ctx.createOscillator();
    const oGain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(640, now + 0.28);
    oGain.gain.setValueAtTime(0.11, now);
    oGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc.connect(oGain);
    oGain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.32);
  }

  public playCheckpoint(): void {
    this.unlock();
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const freqs = [523.25, 659.25, 783.99, 1046.5];

    freqs.forEach((f, idx) => {
      if (!this.ctx || !this.masterGain) return;
      const t = now + idx * 0.055;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, t);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.16, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.34);
    });
  }

  public playCoin(): void {
    this.unlock();
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;

    const notes = [987.77, 1318.51]; // B5 -> E6 crisp arcade coin chime
    notes.forEach((freq, idx) => {
      if (!this.ctx || !this.masterGain) return;
      const t = now + idx * 0.055;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.18, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.19);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.21);
    });
  }

  public playRing(): void {
    this.unlock();
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const notes = [587.33, 880, 1174.66, 1567.98];
    notes.forEach((freq, idx) => {
      if (!this.ctx || !this.masterGain) return;
      const t = now + idx * 0.04;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.16, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.28);
    });
  }

  public playJumpPad(): void {
    this.unlock();
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(760, now + 0.26);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.16, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.3);
  }

  public playImpact(): void {
    this.unlock();
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(210, now);
    osc.frequency.exponentialRampToValueAtTime(48, now + 0.22);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.25);
  }

  public playCrashExplosion(): void {
    this.unlock();
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;

    // Sub-bass crunch drop
    const osc = this.ctx.createOscillator();
    const oGain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(26, now + 0.55);
    oGain.gain.setValueAtTime(0.32, now);
    oGain.gain.exponentialRampToValueAtTime(0.001, now + 0.58);
    osc.connect(oGain);
    oGain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.6);

    // Debris noise burst
    if (this.noiseBuffer) {
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(2800, now);
      lp.frequency.exponentialRampToValueAtTime(160, now + 0.52);

      const nGain = this.ctx.createGain();
      nGain.gain.setValueAtTime(0.36, now);
      nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.54);

      noise.connect(lp);
      lp.connect(nGain);
      nGain.connect(this.masterGain);
      noise.start(now);
      noise.stop(now + 0.56);
    }
  }

  public playVictory(): void {
    this.unlock();
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const chord = [440, 554.37, 659.25, 880, 1108.73];
    chord.forEach((freq, idx) => {
      if (!this.ctx || !this.masterGain) return;
      const t = now + idx * 0.07;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.2, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.75);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.8);
    });
  }

  public dispose(): void {
    this.stopMusic();
    try {
      this.engineOsc1?.stop();
      this.engineOsc2?.stop();
      void this.ctx?.close();
    } catch {
      // Ignore close errors
    }
    this.ctx = null;
  }
}
