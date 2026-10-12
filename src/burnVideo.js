import { spawn } from 'node:child_process';

export function buildBurnArguments(input, filter, output) {
  return ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-progress', 'pipe:1', '-nostats', '-i', input,
    // Photos needs a compatible video/audio combination, not just an .mp4
    // extension. Padding retains the full frame for odd-sized source videos.
    '-vf', `${filter},pad=ceil(iw/2)*2:ceil(ih/2)*2`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', output];
}

export function probeBurnDuration(input, { signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', input], { signal });
    let output = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.resume();
    child.on('error', reject);
    child.on('close', code => {
      const duration = Number(output.trim());
      if (code === 0 && Number.isFinite(duration) && duration > 0) resolve(duration);
      else resolve(null); // Unknown duration uses an indeterminate progress bar.
    });
  });
}

export function runBurnFfmpeg(args, { duration, onProgress = () => {}, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Burn cancelled'));
    const child = spawn('ffmpeg', args);
    let stderr = '', pending = '', percent = 0;
    let killTimer;
    const abort = () => {
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 3000);
      killTimer.unref();
    };
    signal?.addEventListener('abort', abort, { once: true });
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-8000); });
    child.stdout.on('data', data => {
      pending += data;
      const lines = pending.split('\n');
      pending = lines.pop();
      for (const line of lines) {
        const match = line.trim().match(/^out_time_us=(\d+)$/);
        if (!match || !duration) continue;
        percent = Math.max(percent, Math.min(99, Math.floor(Number(match[1]) / 1_000_000 / duration * 100)));
        onProgress(percent);
      }
    });
    const cleanup = () => {
      clearTimeout(killTimer);
      signal?.removeEventListener('abort', abort);
    };
    child.on('error', error => { cleanup(); reject(error); });
    child.on('close', code => {
      cleanup();
      if (code === 0 && !signal?.aborted) resolve();
      else reject(new Error(signal?.aborted ? 'Burn cancelled' : `FFmpeg exited with code ${code}: ${stderr.slice(-400)}`));
    });
  });
}
