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
  | 'skip'
  | 'sold'
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
  | 'error'
  | 'back'
  | 'card-D'
  | 'card-C'
  | 'card-B'
  | 'card-A'
  | 'card-S'
  | 'card-apex';

const KEY = 'ae.sound';
let enabled = readStored(KEY) !== 'off';
const listeners = new Set<() => void>();

let context: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
/** Input of a hall reverb, made once, for the sounds that need space. */
let hall: GainNode | null = null;

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
  /** How much goes to the hall reverb, 0 to 1. */
  wet?: number;
  /** Seconds to reach full volume (default: a click-free 12 ms). */
  attack?: number;
  /** -1 (left) to 1 (right). */
  pan?: number;
}

/** A hall: a stereo impulse of decaying noise, about three seconds long. */
function space(ctx: AudioContext): GainNode {
  if (!hall) {
    const seconds = 3.2;
    const length = Math.floor(ctx.sampleRate * seconds);
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.6);
    }
    const convolver = ctx.createConvolver();
    convolver.buffer = impulse;
    const back = ctx.createGain();
    back.gain.value = 0.7;
    hall = ctx.createGain();
    hall.connect(convolver).connect(back).connect(master!);
  }
  return hall;
}

/** Sends a voice to the speakers, panned, and some of it to the hall. */
function out(ctx: AudioContext, node: AudioNode, { wet = 0, pan = 0 }: { wet?: number; pan?: number }): void {
  let last: AudioNode = node;
  if (pan && typeof ctx.createStereoPanner === 'function') {
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    last = node.connect(panner);
  }
  last.connect(master!);
  if (wet > 0) {
    const send = ctx.createGain();
    send.gain.value = wet;
    last.connect(send).connect(space(ctx));
  }
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
  gain.gain.exponentialRampToValueAtTime(peak, start + (n.attack ?? 0.012));
  gain.gain.exponentialRampToValueAtTime(0.0001, start + n.dur);
  osc.connect(gain);
  out(ctx, gain, n);
  osc.start(start);
  osc.stop(start + n.dur + 0.05);
}

/**
 * A struck glass bell: a few sine partials at the inharmonic ratios of a real
 * bell, the high ones dying away first.
 */
function bell(
  ctx: AudioContext,
  { freq, at = 0, dur = 2, gain = 0.1, wet = 0.5, pan = 0 }: Partial<Note> & { freq: number },
): void {
  const partials: Array<[number, number, number]> = [
    [1, 1, 1],
    [2, 0.45, 0.7],
    [2.76, 0.32, 0.5],
    [4.07, 0.18, 0.35],
    [5.4, 0.1, 0.25],
  ];
  for (const [ratio, level, life] of partials) {
    tone(ctx, { freq: freq * ratio, at, dur: dur * life, type: 'sine', gain: gain * level, attack: 0.004, wet, pan });
  }
}

/** A plucked string, for harp runs. */
function pluck(
  ctx: AudioContext,
  { freq, at = 0, gain = 0.1, wet = 0.45, pan = 0 }: Partial<Note> & { freq: number },
): void {
  tone(ctx, { freq, at, dur: 1.4, type: 'triangle', gain, attack: 0.003, wet, pan });
  tone(ctx, { freq: freq * 2, at, dur: 0.5, type: 'sine', gain: gain * 0.35, attack: 0.003, wet, pan });
}

/**
 * Sustained voices that swell in and fade out. `choir` shapes them into an
 * "aah" (the formants of the vowel) with a gentle vibrato; otherwise a warm
 * string pad whose filter opens as it swells.
 */
function pad(
  ctx: AudioContext,
  {
    freqs,
    at = 0,
    dur,
    attack = 0.5,
    gain = 0.05,
    wet = 0.6,
    choir = false,
    open = 2400,
  }: {
    freqs: number[];
    at?: number;
    dur: number;
    attack?: number;
    gain?: number;
    wet?: number;
    choir?: boolean;
    open?: number;
  },
): void {
  const start = ctx.currentTime + at;
  const end = start + dur;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, start);
  env.gain.linearRampToValueAtTime(gain, start + attack);
  env.gain.setValueAtTime(gain, Math.max(start + attack, end - dur * 0.45));
  env.gain.exponentialRampToValueAtTime(0.0001, end);

  const input = ctx.createGain();
  let shaped: AudioNode;
  if (choir) {
    const merge = ctx.createGain();
    const formants: Array<[number, number, number]> = [
      [800, 9, 1],
      [1150, 10, 0.6],
      [2900, 12, 0.25],
    ];
    for (const [f, q, level] of formants) {
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = f;
      band.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = level * 3;
      input.connect(band).connect(g).connect(merge);
    }
    shaped = merge;
  } else {
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.Q.value = 2;
    low.frequency.setValueAtTime(300, start);
    low.frequency.exponentialRampToValueAtTime(open, start + attack * 1.4);
    input.connect(low);
    shaped = low;
  }
  shaped.connect(env);
  out(ctx, env, { wet });

  // A slow vibrato shared by every voice.
  const lfo = ctx.createOscillator();
  const depth = ctx.createGain();
  lfo.frequency.value = choir ? 5.2 : 4.4;
  depth.gain.value = choir ? 14 : 6;
  lfo.connect(depth);
  lfo.start(start);
  lfo.stop(end + 0.1);

  for (const freq of freqs) {
    for (const cents of [-9, 0, 8]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      osc.detune.value = cents;
      depth.connect(osc.detune);
      osc.connect(input);
      osc.start(start);
      osc.stop(end + 0.1);
    }
  }
}

/** A deep hit: a falling sub tone and a muffled burst. */
function impact(ctx: AudioContext, at = 0, gain = 0.6): void {
  tone(ctx, { freq: 95, to: 38, at, dur: 0.9, type: 'sine', gain, attack: 0.004, wet: 0.25 });
  noise(ctx, { at, dur: 0.35, from: 900, to: 120, gain: gain * 0.5, q: 0.6 });
}

function noise(
  ctx: AudioContext,
  {
    at = 0,
    dur,
    from,
    to,
    gain = 0.25,
    q = 1.2,
    wet = 0,
    pan = 0,
  }: { at?: number; dur: number; from: number; to: number; gain?: number; q?: number; wet?: number; pan?: number },
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
  src.connect(filter).connect(g);
  out(ctx, g, { wet, pan });
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
  // A card skipped, one of the three passes gone: a talent-show buzzer.
  skip: (ctx) => {
    tone(ctx, { freq: 98, dur: 0.6, type: 'sawtooth', gain: 0.2 });
    tone(ctx, { freq: 147, dur: 0.6, type: 'square', gain: 0.09 });
    tone(ctx, { freq: 104, dur: 0.6, type: 'sawtooth', gain: 0.12 });
    noise(ctx, { dur: 0.25, from: 600, to: 200, gain: 0.12 });
  },
  // An auctioneer's gavel: two light knocks and a heavy one.
  sold: (ctx) => {
    [0, 0.16, 0.38].forEach((at, i) => {
      const heavy = i === 2;
      noise(ctx, { at, dur: heavy ? 0.12 : 0.06, from: heavy ? 1400 : 2200, to: 500, gain: heavy ? 0.55 : 0.35, q: 3 });
      tone(ctx, { at, freq: heavy ? 150 : 210, to: heavy ? 70 : 120, dur: heavy ? 0.22 : 0.09, type: 'sine', gain: heavy ? 0.6 : 0.35 });
    });
  },
  // You bought it: a cash-register bell and a short fanfare.
  won: (ctx) => {
    tone(ctx, { freq: 2637, dur: 0.5, type: 'sine', gain: 0.16 });
    tone(ctx, { freq: 3520, at: 0.03, dur: 0.45, type: 'sine', gain: 0.1 });
    noise(ctx, { at: 0, dur: 0.12, from: 5000, to: 8000, gain: 0.1 });
    arpeggio(ctx, [784, 988, 1175, 1568], 0.08, { at: 0.18, type: 'square', gain: 0.11, dur: 0.2 });
    tone(ctx, { freq: 1568, at: 0.5, dur: 0.45, type: 'triangle', gain: 0.18 });
  },
  // The rival bought it: a deflating horn.
  lost: (ctx) => {
    [466, 440, 415].forEach((freq, i) => tone(ctx, { freq, at: i * 0.24, dur: 0.22, type: 'sawtooth', gain: 0.1 }));
    tone(ctx, { freq: 392, to: 330, at: 0.72, dur: 0.6, type: 'sawtooth', gain: 0.11 });
  },
  // Nobody wanted it: a paper swipe and a soft thud.
  discard: (ctx) => {
    noise(ctx, { dur: 0.35, from: 1800, to: 300, gain: 0.22 });
    tone(ctx, { freq: 120, to: 70, at: 0.2, dur: 0.2, type: 'sine', gain: 0.3 });
  },
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
  // Going back a page: a soft swipe and a low click.
  back: (ctx) => {
    noise(ctx, { dur: 0.16, from: 2600, to: 700, gain: 0.1 });
    tone(ctx, { freq: 520, to: 360, at: 0.02, dur: 0.09, type: 'sine', gain: 0.14 });
  },

  // Opening a card up close: the stronger the card, the bigger the moment.
  // D: a card flicked onto the table.
  'card-D': (ctx) => {
    noise(ctx, { dur: 0.12, from: 2200, to: 900, gain: 0.14 });
    tone(ctx, { freq: 440, dur: 0.12, type: 'sine', gain: 0.12 });
  },
  // C: the flick and a two-note chime.
  'card-C': (ctx) => {
    noise(ctx, { dur: 0.12, from: 2200, to: 900, gain: 0.14 });
    arpeggio(ctx, [523, 659], 0.07, { type: 'sine', gain: 0.14, dur: 0.22 });
  },
  // B: a rising three-note arpeggio.
  'card-B': (ctx) => {
    noise(ctx, { dur: 0.16, from: 1800, to: 3600, gain: 0.14 });
    arpeggio(ctx, [523, 659, 784], 0.07, { type: 'triangle', gain: 0.16, dur: 0.26 });
  },
  // A: a soft swell and a cascade of glass bells, in a hall.
  'card-A': (ctx) => {
    noise(ctx, { dur: 0.5, from: 1500, to: 7000, gain: 0.07, wet: 0.4 });
    pad(ctx, { freqs: [330, 415, 494, 740], dur: 1.8, attack: 0.25, gain: 0.035, wet: 0.5, open: 3200 });
    [1319, 1661, 1976, 2637, 2960].forEach((freq, i) =>
      bell(ctx, { freq, at: 0.08 + i * 0.085, dur: 1.6, gain: 0.07, wet: 0.55, pan: -0.6 + i * 0.3 }),
    );
  },
  // S: a rush, a deep hit, strings swelling into a big major chord and bells
  // ringing out on top.
  'card-S': (ctx) => {
    noise(ctx, { dur: 0.45, from: 300, to: 6000, gain: 0.14, wet: 0.3 });
    impact(ctx, 0.36, 0.55);
    pad(ctx, { freqs: [73, 147, 220, 294, 370, 440], at: 0.36, dur: 2.6, attack: 0.18, gain: 0.04, wet: 0.55, open: 3000 });
    bell(ctx, { freq: 1175, at: 0.5, dur: 2.4, gain: 0.09, wet: 0.6, pan: -0.3 });
    bell(ctx, { freq: 1760, at: 0.62, dur: 2.2, gain: 0.07, wet: 0.6, pan: 0.3 });
    bell(ctx, { freq: 2349, at: 0.78, dur: 2, gain: 0.05, wet: 0.65 });
    noise(ctx, { at: 0.5, dur: 1.6, from: 7000, to: 11000, gain: 0.04, wet: 0.6 });
  },
  // A universe's number one: heaven opens. A choir swells on a bright chord, a
  // harp sweeps up, celestial bells ring in a vast hall, and light shimmers
  // over the top.
  'card-apex': (ctx) => {
    tone(ctx, { freq: 65, dur: 3.4, type: 'sine', gain: 0.22, attack: 0.8, wet: 0.3 });
    pad(ctx, { freqs: [262, 330, 392, 494, 587], dur: 3.6, attack: 0.7, gain: 0.07, wet: 0.75, choir: true });
    pad(ctx, { freqs: [784, 1047], at: 0.4, dur: 3.1, attack: 0.9, gain: 0.045, wet: 0.8, choir: true });
    [523, 587, 659, 784, 880, 1047, 1175, 1319, 1568, 1760, 2093].forEach((freq, i) =>
      pluck(ctx, { freq, at: 0.12 + i * 0.05, gain: 0.07, wet: 0.5, pan: -0.8 + i * 0.16 }),
    );
    bell(ctx, { freq: 2093, at: 0.75, dur: 3, gain: 0.07, wet: 0.75, pan: -0.4 });
    bell(ctx, { freq: 3136, at: 0.95, dur: 2.6, gain: 0.05, wet: 0.8, pan: 0.4 });
    bell(ctx, { freq: 2637, at: 1.2, dur: 2.6, gain: 0.05, wet: 0.8 });
    noise(ctx, { at: 0.3, dur: 3, from: 8000, to: 12000, gain: 0.035, wet: 0.7 });
  },
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

// ---------------------------------------------------------------------------
// Shimmer: a sound that follows a finger or the mouse across a card
// ---------------------------------------------------------------------------

export interface Shimmer {
  /** Where the pointer is on the card (0–1 each way) and how fast it moves (card widths per second). */
  move(x: number, y: number, speed: number): void;
  stop(): void;
}

/** A pentatonic scale, for sparkles that always sound right together. */
const SPARKLE = [4186, 3520, 3136, 2637, 2349, 2093, 1760, 1568];

/**
 * The shimmer of a card held up close: glittering air whose pitch follows the
 * height on the card and which pans with the pointer. It swells with speed and
 * fades when the pointer rests. S cards add a singing-glass tone; a universe's
 * number one adds more, and brighter, sparkling bells.
 */
export function startShimmer(level: 'A' | 'S' | 'apex'): Shimmer | null {
  const ctx = audio();
  if (!ctx || !master) return null;
  try {
    if (!noiseBuffer) noise(ctx, { dur: 0.01, from: 1000, to: 1000, gain: 0.0001 });
    const loud = level === 'apex' ? 0.16 : level === 'S' ? 0.12 : 0.09;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 7;
    band.frequency.value = 6000;
    const air = ctx.createGain();
    air.gain.value = 0;
    const panner = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;
    const bus = ctx.createGain();
    if (panner) bus.connect(panner).connect(master);
    else bus.connect(master);
    const send = ctx.createGain();
    send.gain.value = 0.6;
    bus.connect(send).connect(space(ctx));
    src.connect(band).connect(air).connect(bus);
    src.start();

    let glass: OscillatorNode | null = null;
    const glassGain = ctx.createGain();
    glassGain.gain.value = 0;
    if (level !== 'A') {
      glass = ctx.createOscillator();
      glass.type = 'sine';
      glass.frequency.value = 1500;
      glass.connect(glassGain).connect(bus);
      glass.start();
    }

    let lastSparkle = 0;
    let stopped = false;
    return {
      move(x, y, speed) {
        if (stopped) return;
        const now = ctx.currentTime;
        const amount = Math.min(1, speed / 2.2);
        band.frequency.setTargetAtTime(3500 + (1 - y) * 7500, now, 0.05);
        panner?.pan.setTargetAtTime(x * 1.6 - 0.8, now, 0.05);
        air.gain.cancelScheduledValues(now);
        air.gain.setTargetAtTime(loud * (0.25 + amount), now, 0.03);
        air.gain.setTargetAtTime(0, now + 0.12, 0.18);
        if (glass) {
          glass.frequency.setTargetAtTime(1200 + (1 - y) * 1800, now, 0.08);
          glassGain.gain.cancelScheduledValues(now);
          glassGain.gain.setTargetAtTime((level === 'apex' ? 0.03 : 0.022) * amount, now, 0.05);
          glassGain.gain.setTargetAtTime(0, now + 0.15, 0.2);
        }
        // Sparkles: more of them the faster the pointer moves, higher near the top.
        const gap = level === 'apex' ? 0.07 : level === 'S' ? 0.12 : 0.2;
        if (now - lastSparkle > gap && Math.random() < 0.25 + amount) {
          lastSparkle = now;
          const freq = SPARKLE[Math.min(SPARKLE.length - 1, Math.floor(y * SPARKLE.length))];
          bell(ctx, {
            freq,
            dur: level === 'apex' ? 1.4 : 0.8,
            gain: level === 'apex' ? 0.035 : 0.022,
            wet: 0.7,
            pan: x * 1.6 - 0.8,
          });
        }
      },
      stop() {
        if (stopped) return;
        stopped = true;
        const now = ctx.currentTime;
        air.gain.cancelScheduledValues(now);
        air.gain.setTargetAtTime(0, now, 0.08);
        glassGain.gain.cancelScheduledValues(now);
        glassGain.gain.setTargetAtTime(0, now, 0.08);
        src.stop(now + 0.6);
        glass?.stop(now + 0.6);
      },
    };
  } catch {
    return null;
  }
}
