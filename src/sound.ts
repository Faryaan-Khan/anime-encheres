/**
 * Sound effects, synthesized with the Web Audio API.
 *
 * Every sound is generated in code from oscillators and filtered noise: there
 * are no audio files to download or license. Browsers only allow audio after
 * the player has touched the page, so the context is created on the first
 * pointer or key press. Sound can be switched off; the choice is remembered.
 */
import { useSyncExternalStore } from 'react';
import { readStored, writeStored } from './storage';

export type Sound =
  | 'tap'
  | 'draw'
  | 'flip'
  | 'bid'
  | 'outbid'
  | 'pass'
  | 'won'
  | 'lost'
  | 'discard'
  | 'tick'
  | 'urgent'
  | 'found'
  | 'search'
  | 'victory'
  | 'defeat'
  | 'tie'
  | 'trophy'
  | 'error';

const KEY = 'ae.sound';
let enabled = readStored(KEY) !== 'off';
const listeners = new Set<() => void>();

let context: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;

function audio(): AudioContext | null {
  if (!enabled || typeof window === 'undefined') return null;
  if (!context) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      context = new Ctor();
    } catch {
      return null;
    }
    master = context.createGain();
    master.gain.value = 0.55;
    master.connect(context.destination);
  }
  if (context.state === 'suspended') void context.resume().catch(() => undefined);
  return context;
}

/** Call once at start-up: unlocks audio on the first interaction. */
export function initSound(): void {
  const unlock = () => {
    audio();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  // A light tap for every button press, wherever it is.
  document.addEventListener(
    'click',
    (e) => {
      const target = e.target as Element | null;
      if (target?.closest('.btn, .link, .option, .modes__choice, .avatars__choice')) play('tap');
    },
    true,
  );
}

export function isSoundOn(): boolean {
  return enabled;
}

export function setSoundOn(on: boolean): void {
  enabled = on;
  writeStored(KEY, on ? 'on' : 'off');
  if (!on && context) void context.suspend().catch(() => undefined);
  listeners.forEach((l) => l());
  if (on) play('tap');
}

export function useSoundOn(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => enabled,
    () => enabled,
  );
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

interface Note {
  freq: number;
  /** Frequency at the end, for slides. */
  to?: number;
  at?: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
}

function tone(ctx: AudioContext, n: Note): void {
  const start = ctx.currentTime + (n.at ?? 0);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = n.type ?? 'triangle';
  osc.frequency.setValueAtTime(n.freq, start);
  if (n.to) osc.frequency.exponentialRampToValueAtTime(n.to, start + n.dur);
  const peak = n.gain ?? 0.3;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + n.dur);
  osc.connect(gain).connect(master!);
  osc.start(start);
  osc.stop(start + n.dur + 0.05);
}

function noise(
  ctx: AudioContext,
  { at = 0, dur, from, to, gain = 0.25, q = 1.2 }: { at?: number; dur: number; from: number; to: number; gain?: number; q?: number },
): void {
  if (!noiseBuffer) {
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const start = ctx.currentTime + at;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = q;
  filter.frequency.setValueAtTime(from, start);
  filter.frequency.exponentialRampToValueAtTime(to, start + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + dur * 0.25);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  src.connect(filter).connect(g).connect(master!);
  src.start(start);
  src.stop(start + dur + 0.05);
}

const arpeggio = (ctx: AudioContext, notes: number[], step: number, extra: Partial<Note> = {}) =>
  notes.forEach((freq, i) => tone(ctx, { freq, at: i * step, dur: 0.25, ...extra }));

// ---------------------------------------------------------------------------
// The sounds
// ---------------------------------------------------------------------------

const SOUNDS: Record<Sound, (ctx: AudioContext) => void> = {
  tap: (ctx) => tone(ctx, { freq: 660, to: 520, dur: 0.06, type: 'square', gain: 0.06 }),
  draw: (ctx) => noise(ctx, { dur: 0.28, from: 600, to: 4200, gain: 0.3 }),
  flip: (ctx) => {
    noise(ctx, { dur: 0.18, from: 2500, to: 900, gain: 0.25 });
    arpeggio(ctx, [880, 1320], 0.06, { at: 0.12, type: 'sine', gain: 0.18 });
  },
  bid: (ctx) => {
    tone(ctx, { freq: 988, dur: 0.08, type: 'square', gain: 0.12 });
    tone(ctx, { freq: 1319, at: 0.07, dur: 0.22, type: 'square', gain: 0.12 });
  },
  outbid: (ctx) => {
    tone(ctx, { freq: 330, to: 660, dur: 0.16, type: 'sawtooth', gain: 0.12 });
    tone(ctx, { freq: 660, to: 990, at: 0.12, dur: 0.18, type: 'sawtooth', gain: 0.1 });
  },
  pass: (ctx) => tone(ctx, { freq: 220, to: 140, dur: 0.22, type: 'sine', gain: 0.3 }),
  won: (ctx) => arpeggio(ctx, [523, 659, 784, 1047], 0.07, { type: 'triangle', gain: 0.25 }),
  lost: (ctx) => arpeggio(ctx, [392, 330, 262], 0.09, { type: 'triangle', gain: 0.22 }),
  discard: (ctx) => noise(ctx, { dur: 0.35, from: 1800, to: 300, gain: 0.22 }),
  tick: (ctx) => tone(ctx, { freq: 1500, dur: 0.04, type: 'square', gain: 0.07 }),
  urgent: (ctx) => {
    tone(ctx, { freq: 880, dur: 0.07, type: 'square', gain: 0.12 });
    tone(ctx, { freq: 880, at: 0.12, dur: 0.07, type: 'square', gain: 0.12 });
  },
  found: (ctx) => {
    arpeggio(ctx, [523, 784, 1047, 1568], 0.08, { type: 'square', gain: 0.12 });
    noise(ctx, { at: 0.25, dur: 0.4, from: 3000, to: 8000, gain: 0.08 });
  },
  search: (ctx) => tone(ctx, { freq: 1046, to: 1100, dur: 0.5, type: 'sine', gain: 0.07 }),
  victory: (ctx) => {
    arpeggio(ctx, [523, 659, 784], 0.11, { type: 'square', gain: 0.13 });
    tone(ctx, { freq: 1047, at: 0.36, dur: 0.6, type: 'square', gain: 0.14 });
    tone(ctx, { freq: 1319, at: 0.36, dur: 0.6, type: 'triangle', gain: 0.12 });
    noise(ctx, { at: 0.36, dur: 0.8, from: 4000, to: 9000, gain: 0.06 });
  },
  defeat: (ctx) => {
    arpeggio(ctx, [392, 370, 349], 0.22, { type: 'sawtooth', gain: 0.09, dur: 0.3 });
    tone(ctx, { freq: 330, to: 220, at: 0.66, dur: 0.7, type: 'sawtooth', gain: 0.1 });
  },
  tie: (ctx) => arpeggio(ctx, [523, 523, 659], 0.12, { type: 'triangle', gain: 0.18 }),
  trophy: (ctx) => arpeggio(ctx, [1319, 1568, 2093], 0.05, { type: 'sine', gain: 0.12, dur: 0.18 }),
  error: (ctx) => tone(ctx, { freq: 140, dur: 0.18, type: 'square', gain: 0.12 }),
};

export function play(sound: Sound): void {
  const ctx = audio();
  if (!ctx || !master) return;
  try {
    SOUNDS[sound](ctx);
  } catch {
    /* audio is a nicety; never break the game for it */
  }
}
