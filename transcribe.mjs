import fs from 'fs';
import { promises as fsp } from 'fs';
import { spawn } from 'child_process';
import path from 'path';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const BURNABLE_FORMATS = new Set(['.srt', '.vtt']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.opus']);
const OPENAI_UPLOAD_LIMIT_BYTES = 25 * 1024 * 1024; // 25 MB

async function main() {
  const [inputPath, outputPathArg] = process.argv.slice(2);

  if (!inputPath) {
    console.error('Usage: node transcribe.mjs <video-or-audio-file> [output-file]');
    process.exit(1);
  }

  const resolvedInput = path.resolve(process.cwd(), inputPath);
  const { format, outputPath } = buildOutputPath(resolvedInput, outputPathArg);

  const client = createOpenAIClient();

  console.log(`Preparing transcription (${format.slice(1)} format) using OpenAI Whisper...`);

  const result = await transcribeWithOpenAI(client, resolvedInput);
  await writeTranscriptFromSegments(result, format, outputPath);

  console.log(`Transcript saved to ${outputPath}`);

  if (BURNABLE_FORMATS.has(format)) {
    try {
      const burnedPath = await burnSubtitles(resolvedInput, outputPath);
      console.log(`Video with burned subtitles saved to ${burnedPath}`);
    } catch (error) {
      console.error('Failed to burn subtitles:', error);
      console.warn('The transcript file is still available for manual muxing.');
    }
  } else {
    console.log('Burning skipped: chosen format is not supported for hard subtitles.');
  }
}

function createOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is required for OpenAI transcription.');
  }
  return new OpenAI({ apiKey });
}

function buildOutputPath(resolvedInput, outputPathArg) {
  const parsedArg = outputPathArg ? path.resolve(process.cwd(), outputPathArg) : undefined;
  const defaultBase = path.basename(resolvedInput, path.extname(resolvedInput));
  const defaultPath = path.join(path.dirname(resolvedInput), `${defaultBase}.srt`);

  const finalPath = parsedArg ?? defaultPath;
  let ext = path.extname(finalPath).toLowerCase();

  if (!ext) {
    ext = '.srt';
  }

  if (!['.txt', '.srt', '.vtt'].includes(ext)) {
    throw new Error('Unsupported output format. Supported: .txt, .srt, .vtt');
  }

  const normalizedPath = path.extname(finalPath).toLowerCase() === ext
    ? finalPath
    : `${finalPath}${ext}`;

  return { format: ext, outputPath: normalizedPath };
}

async function transcribeWithOpenAI(client, filePath) {
  const model = process.env.OPENAI_WHISPER_MODEL ?? 'whisper-1';
  const temperature = Number.parseFloat(process.env.OPENAI_TEMPERATURE ?? '0');
  const translate = /^true$/i.test(process.env.OPENAI_TRANSLATE ?? 'false');
  const language = process.env.OPENAI_LANGUAGE ?? undefined;

  const { preparedPath, cleanup } = await ensureAudioForOpenAI(filePath);

  console.log('Uploading media to OpenAI Whisper...');

  try {
    const transcription = await client.audio.transcriptions.create({
      file: fs.createReadStream(preparedPath),
      model,
      temperature: Number.isFinite(temperature) ? temperature : 0,
      response_format: 'verbose_json',
      translate,
      language,
    });

    const segments = (transcription.segments ?? []).map(segment => ({
      id: segment.id,
      start: segment.start,
      end: segment.end,
      text: segment.text?.trim() ?? '',
    }));

    const combinedText = transcription.text?.trim()
      ?? segments.map(segment => segment.text).join(' ').trim();

    if (!combinedText) {
      throw new Error('No text returned from OpenAI transcription.');
    }

    return { text: combinedText, segments };
  } finally {
    if (cleanup) {
      await cleanup().catch(() => {});
    }
  }
}

async function ensureAudioForOpenAI(inputPath) {
  const stats = await fsp.stat(inputPath);
  const ext = path.extname(inputPath).toLowerCase();

  const isAudio = AUDIO_EXTENSIONS.has(ext);
  const withinLimit = stats.size <= OPENAI_UPLOAD_LIMIT_BYTES;

  if (isAudio && withinLimit) {
    return { preparedPath: inputPath, cleanup: null };
  }

  await assertFfmpeg();

  const tempPath = path.join(
    path.dirname(inputPath),
    `${path.basename(inputPath, path.extname(inputPath))}_openai_tmp.mp3`
  );

  console.log('Converting media to OpenAI-friendly audio (mono 16 kHz)...');

  await runCommand('ffmpeg', [
    '-y',
    '-i',
    inputPath,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-b:a',
    '128k',
    tempPath,
  ]);

  const convertedStats = await fsp.stat(tempPath);
  if (convertedStats.size > OPENAI_UPLOAD_LIMIT_BYTES) {
    throw new Error(
      `Converted audio (${(convertedStats.size / (1024 * 1024)).toFixed(1)} MB) still exceeds the 25 MB OpenAI limit.`
    );
  }

  return {
    preparedPath: tempPath,
    cleanup: () => fsp.unlink(tempPath),
  };
}

async function writeTranscriptFromSegments(result, format, outputPath) {
  const { text, segments } = result;

  if (format === '.txt') {
    await fsp.writeFile(outputPath, text, 'utf8');
    return;
  }

  if (!segments?.length) {
    throw new Error('Segment data missing from transcription response; cannot build structured subtitle file.');
  }

  if (format === '.srt') {
    const srt = buildSrtFromSegments(segments);
    await fsp.writeFile(outputPath, srt, 'utf8');
    return;
  }

  if (format === '.vtt') {
    const vtt = buildVttFromSegments(segments);
    await fsp.writeFile(outputPath, vtt, 'utf8');
    return;
  }

  throw new Error(`Unhandled format ${format}`);
}

function buildSrtFromSegments(segments) {
  return segments
    .map((segment, index) => {
      const start = formatTimestamp(segment.start, ',');
      const end = formatTimestamp(segment.end, ',');
      const text = segment.text.replace(/\s+/g, ' ').trim();
      return `${index + 1}\n${start} --> ${end}\n${text}\n`;
    })
    .join('\n');
}

function buildVttFromSegments(segments) {
  const body = segments
    .map(segment => {
      const start = formatTimestamp(segment.start, '.');
      const end = formatTimestamp(segment.end, '.');
      const text = segment.text.replace(/\s+/g, ' ').trim();
      return `${start} --> ${end}\n${text}`;
    })
    .join('\n\n');

  return `WEBVTT\n\n${body}\n`;
}

function formatTimestamp(seconds, millisecondSeparator) {
  const totalMilliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((totalMilliseconds % 60_000) / 1000);
  const millis = totalMilliseconds % 1000;

  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  const ms = String(millis).padStart(3, '0');

  return `${hh}:${mm}:${ss}${millisecondSeparator}${ms}`;
}

async function burnSubtitles(inputVideoPath, subtitlePath) {
  console.log('Burning subtitles into video with ffmpeg...');

  await assertFfmpeg();

  const outputPath = buildBurnedVideoPath(inputVideoPath);
  const filterArg = `subtitles='${escapeForSubtitleFilter(subtitlePath)}'`;
  const args = [
    '-y',
    '-i',
    inputVideoPath,
    '-vf',
    filterArg,
    '-c:v',
    'libx264',
    '-crf',
    '18',
    '-preset',
    'medium',
    '-c:a',
    'copy',
    outputPath,
  ];

  await runCommand('ffmpeg', args);
  return outputPath;
}

function buildBurnedVideoPath(inputVideoPath) {
  const directory = path.dirname(inputVideoPath);
  const baseName = path.basename(inputVideoPath, path.extname(inputVideoPath));
  return path.join(directory, `${baseName}_burned.mp4`);
}

function escapeForSubtitleFilter(filePath) {
  return path.resolve(filePath)
    .replace(/\\/g, '/')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'");
}

async function assertFfmpeg() {
  try {
    await runCommand('ffmpeg', ['-version'], { stdio: 'ignore' });
  } catch (error) {
    throw new Error('ffmpeg is required but was not found in PATH.');
  }
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const stdio = options.stdio ?? 'inherit';
    const cwd = options.cwd;
    const child = spawn(command, args, { stdio, cwd, shell: false });

    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
  });
}

main().catch(error => {
  console.error('Failed to transcribe:', error);
  process.exitCode = 1;
});
