/* Mono linear resampling to 24 kHz, independent of the hardware AudioContext rate. */
class TalkdeckPCM extends AudioWorkletProcessor {
  constructor() {
    super(); this.samples = []; this.position = 0; this.output = []; this.emitted = 0;
    this.port.onmessage = event => { if (event.data === 'flush') { this.emit(); this.port.postMessage({ flushed: true }); } };
  }
  emit() {
    if (!this.output.length) return;
    const pcm = new Int16Array(this.output.length); let energy = 0;
    for (let i = 0; i < pcm.length; i++) { const value = Math.max(-1, Math.min(1, this.output[i])); pcm[i] = Math.round(value * (value < 0 ? 32768 : 32767)); energy += value * value; }
    this.port.postMessage({ pcm: pcm.buffer, startSample: this.emitted, rms: Math.sqrt(energy / pcm.length) }, [pcm.buffer]);
    this.emitted += this.output.length; this.output = [];
  }
  process(inputs) {
    const channels = inputs[0]; if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) { let value = 0; for (const channel of channels) value += channel[i]; this.samples.push(value / channels.length); }
    const step = sampleRate / 24000;
    while (this.position + 1 < this.samples.length) {
      const at = Math.floor(this.position), fraction = this.position - at;
      this.output.push(this.samples[at] * (1 - fraction) + this.samples[at + 1] * fraction); this.position += step;
      if (this.output.length >= 6000) this.emit();
    }
    const consumed = Math.floor(this.position); this.samples.splice(0, consumed); this.position -= consumed;
    return true;
  }
}
registerProcessor('talkdeck-pcm', TalkdeckPCM);
