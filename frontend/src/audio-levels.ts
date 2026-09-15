const BANDS = 24;
const LOW_HZ = 100;
const HIGH_HZ = 5000;
const spectra = new WeakMap<AnalyserNode, Float32Array<ArrayBuffer>>();
/** Fills `levels` with 0–1 loudness across the speech range of what the analyser hears now. */
export function readSpeechLevels(analyser: AnalyserNode, levels: Float32Array) {
  let spectrum = spectra.get(analyser);
  if (!spectrum) {
    spectrum = new Float32Array(analyser.frequencyBinCount);
    spectra.set(analyser, spectrum);
  }
  analyser.getFloatFrequencyData(spectrum);
  const binHz = analyser.context.sampleRate / analyser.fftSize;
  const bands = new Float32Array(BANDS);
  for (let band = 0; band < BANDS; band++) {
    const lowHz = LOW_HZ * (HIGH_HZ / LOW_HZ) ** (band / BANDS);
    const highHz = LOW_HZ * (HIGH_HZ / LOW_HZ) ** ((band + 1) / BANDS);
    const from = Math.floor(lowHz / binHz);
    const to = Math.max(from + 1, Math.ceil(highHz / binHz));
    let sum = 0;
    for (let bin = from; bin < to; bin++) sum += spectrum[bin];
    // Speech energy falls off with pitch; tilt it back so high bands still move.
    const db = sum / (to - from) + 3 * Math.log2(lowHz / LOW_HZ);
    bands[band] = Math.min(1, Math.max(0, (db + 80) / 50));
  }
  // Neighbouring bars read different bands so the wave never looks like a slope.
  for (let i = 0; i < levels.length; i++)
    levels[i] = bands[(i * 7 + (i >> 3) * 5) % BANDS];
}
