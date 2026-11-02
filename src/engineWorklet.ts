import { EngineDSP } from './engine';

// AudioWorkletGlobalScope members (not in the DOM lib)
declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: typeof AudioWorkletProcessor): void;

class EngineProcessor extends AudioWorkletProcessor {
  private readonly dsp = new EngineDSP(sampleRate);

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<{ rpm: number; throttle: number }>) =>
      this.dsp.setParams(e.data);
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const [first, ...rest] = outputs[0];
    if (!first) return true;
    this.dsp.process(first);
    for (const ch of rest) ch.set(first);
    return true;
  }
}

registerProcessor('engine', EngineProcessor);
