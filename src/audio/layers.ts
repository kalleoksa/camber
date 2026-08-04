import type { Params } from '../sim/params.ts';
import type { RiderView } from '../render/scene.ts';

const NOISE_SECONDS = 2;

/**
 * Everything is synthesised — no asset pipeline. Three continuous layers off one noise
 * buffer: edge bite pitched by speed and gated by scrub, base chatter on snow, wind by
 * speed. Design §11 treats this as a mechanic, not decoration: it carries more of the
 * carve than the visuals do.
 */
export type AudioLayers = {
  running: boolean;
  start(): void;
  update(view: RiderView, params: Params): void;
  thump(impact: number, params: Params): void;
};

function noiseBuffer(ctx: AudioContext): AudioBuffer {
  const length = ctx.sampleRate * NOISE_SECONDS;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function loopSource(ctx: AudioContext, buffer: AudioBuffer): AudioBufferSourceNode {
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.start();
  return source;
}

export function createAudioLayers(): AudioLayers {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let edgeGain: GainNode | null = null;
  let edgeFilter: BiquadFilterNode | null = null;
  let baseGain: GainNode | null = null;
  let baseFilter: BiquadFilterNode | null = null;
  let windGain: GainNode | null = null;
  let windFilter: BiquadFilterNode | null = null;
  let noise: AudioBuffer | null = null;

  const layers: AudioLayers = {
    running: false,

    start() {
      if (ctx) {
        void ctx.resume();
        return;
      }
      ctx = new AudioContext();
      noise = noiseBuffer(ctx);

      master = ctx.createGain();
      master.gain.value = 0;
      master.connect(ctx.destination);

      edgeFilter = ctx.createBiquadFilter();
      edgeFilter.type = 'bandpass';
      edgeGain = ctx.createGain();
      edgeGain.gain.value = 0;
      loopSource(ctx, noise).connect(edgeFilter).connect(edgeGain).connect(master);

      baseFilter = ctx.createBiquadFilter();
      baseFilter.type = 'lowpass';
      baseGain = ctx.createGain();
      baseGain.gain.value = 0;
      loopSource(ctx, noise).connect(baseFilter).connect(baseGain).connect(master);

      windFilter = ctx.createBiquadFilter();
      windFilter.type = 'highpass';
      windFilter.frequency.value = 900;
      windGain = ctx.createGain();
      windGain.gain.value = 0;
      loopSource(ctx, noise).connect(windFilter).connect(windGain).connect(master);

      layers.running = true;
    },

    update(view, params) {
      if (!ctx || !master || !edgeGain || !edgeFilter || !baseGain || !baseFilter || !windGain) return;

      const a = params.audio;
      const now = ctx.currentTime;
      const ramp = 0.05; // s — short enough to track a carve, long enough not to click
      const grounded = view.mode === 'grounded';
      const scrub = Math.min(view.scrub / params.spray.scrubRef, 1);
      const speedFraction = Math.min(view.speed / a.windSpeedRef, 1);

      master.gain.setTargetAtTime(a.master, now, ramp);

      // Edge bite: pitch tracks speed, level tracks how hard the edge is working.
      edgeFilter.frequency.setTargetAtTime(a.edgeFilterBase + view.speed * a.edgeFilterGain, now, ramp);
      edgeFilter.Q.setTargetAtTime(a.edgeQ, now, ramp);
      edgeGain.gain.setTargetAtTime(grounded ? scrub * a.edgeGain : 0, now, ramp);

      // Base chatter: present whenever the board is on snow and moving at all.
      baseFilter.frequency.setTargetAtTime(a.baseFilter, now, ramp);
      baseGain.gain.setTargetAtTime(grounded ? speedFraction * a.baseGain : 0, now, ramp);

      // Wind rises with speed and is the only layer that survives going airborne.
      windGain.gain.setTargetAtTime(speedFraction * speedFraction * a.windGain, now, ramp);
    },

    /** One-shot on touchdown. Scaled by impact so a drop reads differently from a tap. */
    thump(impact, params) {
      if (!ctx || !master || !noise) return;
      const a = params.audio;
      const now = ctx.currentTime;
      const level = Math.min(impact / a.thumpRef, 1);
      if (level <= 0.01) return;

      const source = ctx.createBufferSource();
      source.buffer = noise;
      source.loop = true;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = a.thumpFilter;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(level * a.thumpGain, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + a.thumpDecay);

      source.connect(filter).connect(gain).connect(master);
      source.start(now);
      source.stop(now + a.thumpDecay);
    },
  };

  return layers;
}
