import { execFileSync } from 'node:child_process';

export function probeAudio(file) {
  const result = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0',
    '-show_entries', 'format=duration:stream=codec_name,sample_rate,channels', '-of', 'json', file], { encoding: 'utf8' }));
  return { ...result.streams[0], duration: Number(result.format.duration) };
}

export function decodeAudio(file, channels = 1) {
  const bytes = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vn', '-ac', String(channels),
    '-ar', '16000', '-f', 'f32le', '-'], { maxBuffer: 100 * 1024 * 1024 });
  const samples = new Float64Array(bytes.length / 4);
  for (let i = 0; i < samples.length; i++) samples[i] = bytes.readFloatLE(i * 4);
  return samples;
}

export function compareSamples(reference, candidate, { rate = 16000, start = 0, end = Infinity, maxLag = 160 } = {}) {
  // Normalized cross-correlation at sample resolution separates a missing head
  // from a small decoder/resampler delay; envelope similarity alone cannot.
  const begin = Math.round(start * rate);
  const finish = Math.min(reference.length, Math.round(end * rate));
  let best = null;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let xy = 0, xx = 0, yy = 0, n = 0;
    for (let i = begin; i < finish; i += 4) {
      const j = i + lag;
      if (j < 0 || j >= candidate.length) continue;
      const x = reference[i], y = candidate[j];
      xy += x * y; xx += x * x; yy += y * y; n++;
    }
    const correlation = xx && yy ? xy / Math.sqrt(xx * yy) : 0;
    if (!best || correlation > best.correlation) {
      best = { correlation, lagSeconds: lag / rate, gainDb: xx && yy ? 10 * Math.log10(yy / xx) : null,
        referenceRmsDb: xx ? 10 * Math.log10(xx / n) : null, candidateRmsDb: yy ? 10 * Math.log10(yy / n) : null };
    }
  }
  return { ...best, referenceSeconds: reference.length / rate, candidateSeconds: candidate.length / rate };
}

export function coverageSummary(result, boundary = 27.3) {
  const segments = (result.segments || []).filter(s => Number.isFinite(s.start) && Number.isFinite(s.end));
  return { firstStart: segments.length ? Math.min(...segments.map(s => s.start)) : null,
    lastEnd: segments.length ? Math.max(...segments.map(s => s.end)) : null,
    segments: segments.length, words: result.words?.length || 0,
    wordsBeforeBoundary: (result.words || []).filter(w => w.start < boundary).length,
    prefixText: segments.filter(s => s.start < boundary).map(s => s.text).join(' ').trim() };
}

// Audit evidence, not a production acceptance/retry policy. A long repeated
// letter and extreme compression expose the observed decoding loop. Silence
// probabilities alone cannot distinguish the successful and failing samples.
export function qualitySummary(result) {
  return (result.segments || []).map(segment => {
    const text = (segment.text || '').normalize('NFC');
    const repeatedLetter = /(\p{L})\1{19,}/u.test(text);
    const compressionRatio = Number.isFinite(segment.compression_ratio) ? segment.compression_ratio : null;
    return { start: segment.start, end: segment.end, repeatedLetter, compressionRatio,
      noSpeechProbability: segment.no_speech_prob ?? null,
      suspicious: repeatedLetter || (compressionRatio !== null && compressionRatio > 2.4) };
  });
}
