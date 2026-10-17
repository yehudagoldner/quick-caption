import { spawn } from 'node:child_process';
import { audiogramWaveBox } from './audiogram.js';

const ENCODE_ARGUMENTS = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'];

export function buildBurnArguments(input, filter, output, filterScript) {
  return ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-progress', 'pipe:1', '-nostats', '-i', input,
    // Photos needs a compatible video/audio combination, not just an .mp4
    // extension. Padding retains the full frame for odd-sized source videos.
    ...(filterScript ? ['-filter_script:v', filterScript] : ['-vf', `${filter},pad=ceil(iw/2)*2:ceil(ih/2)*2`]), ...ENCODE_ARGUMENTS, output];
}

export function probeVideoDimensions(input, { signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,sample_aspect_ratio:stream_side_data=rotation', '-of', 'json', input], { signal });
    let output = '';
    child.stdout.on('data', data => { output += data; }); child.stderr.resume(); child.on('error', reject);
    child.on('close', code => {
      try {
        const stream = JSON.parse(output).streams?.[0];
        if (code !== 0 || !stream?.width || !stream?.height) throw new Error('Invalid video dimensions');
        const rotation = Math.abs(Number(stream.side_data_list?.find(data => data.rotation != null)?.rotation ?? 0)) % 180;
        const [numerator, denominator] = (stream.sample_aspect_ratio || '1:1').split(':').map(Number);
        const width = Math.round(stream.width * (numerator > 0 && denominator > 0 ? numerator / denominator : 1)), height = stream.height;
        resolve(rotation === 90 ? { width: height, height: width } : { width, height });
      } catch (error) { reject(error); }
    });
  });
}

export function buildAudiogramArguments(audio, { width, height, background, image, imageFit, waveform, waveColor, duration }, filter, output) {
  const hex = value => `0x${value.slice(1)}`;
  // A bounded background ends the video with the audio even if -shortest overshoots.
  const length = Number.isFinite(duration) && duration > 0 ? `:d=${duration.toFixed(3)}` : '';
  const inputs = ['-i', audio, '-f', 'lavfi', '-i', `color=c=${hex(background)}:s=${width}x${height}:r=30${length}`];
  const graph = [];
  let frame = '[1:v]';
  if (image) {
    inputs.push('-loop', '1', '-framerate', '30', '-i', image);
    graph.push(imageFit === 'cover'
      ? `[2:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1[image]`
      : `[2:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,setsar=1[image]`);
    graph.push(`${frame}[image]overlay=(W-w)/2:(H-h)/2:shortest=1[pictured]`);
    frame = '[pictured]';
  }
  if (waveform) {
    const band = audiogramWaveBox(width, height);
    graph.push(`[0:a]aformat=channel_layouts=mono,showwaves=s=${band.width}x${band.height}:mode=cline:draw=full:rate=30:scale=sqrt:colors=${hex(waveColor)},format=rgba[wave]`);
    graph.push(`${frame}[wave]overlay=0:${band.top}:eof_action=pass[waved]`);
    frame = '[waved]';
  }
  graph.push(`${frame}${filter}[captioned]`);
  return ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-progress', 'pipe:1', '-nostats', ...inputs,
    '-filter_complex', graph.join(';'), '-map', '[captioned]', '-map', '0:a:0', '-shortest', '-r', '30', ...ENCODE_ARGUMENTS, output];
}

// Cover art in MP3/M4A files is a still "video" stream; it does not make the source a video.
export function probeHasVideo(input, { signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=index:stream_disposition=attached_pic', '-of', 'json', input], { signal });
    let output = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.resume();
    child.on('error', reject);
    child.on('close', code => {
      try {
        if (code !== 0) throw new Error('probe failed');
        resolve((JSON.parse(output).streams ?? []).some(stream => !stream.disposition?.attached_pic));
      } catch { resolve(true); } // An unreadable source fails in FFmpeg with the usual error.
    });
  });
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
