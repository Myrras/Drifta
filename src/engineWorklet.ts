import { EngineDSP, type EngineProfile } from './engine';

// AudioWorkletGlobalScope members (not in the DOM lib)
declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: typeof AudioWorkletProcessor): void;

type Msg = { rpm: number; throttle: number } | { profile: EngineProfile };

class EngineProcessor extends AudioWorkletProcessor {
  private dsp = new EngineDSP(sampleRate);
  private profile?: EngineProfile;

  constructor() {
    super();
    // a car change rebuilds the DSP here, outside process(), so the audio loop never allocates
    this.port.onmessage = (e: MessageEvent<Msg>) => {
      if ('profile' in e.data) {
        this.profile = e.data.profile;
        this.dsp = new EngineDSP(sampleRate, this.profile);
      } else this.dsp.setParams(e.data);
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const [first, ...rest] = outputs[0];
    if (!first) return true;
    this.dsp.process(first);
    // a NaN would reach the master bus and mute every sound: drop the block and restart the engine
    if (!first.every(Number.isFinite)) {
      first.fill(0);
      this.dsp = new EngineDSP(sampleRate, this.profile);
    }
    for (const ch of rest) ch.set(first);
    return true;
  }
}

registerProcessor('engine', EngineProcessor);
