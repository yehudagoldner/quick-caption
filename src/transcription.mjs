import fs from 'fs';
import { promises as fsp } from 'fs';
import { spawn } from 'child_process';
import path from 'path';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.opus']);
const SUBTITLE_FORMATS = new Set(['.txt', '.srt', '.vtt']);
const OPENAI_UPLOAD_LIMIT_BYTES = 25 * 1024 * 1024; // 25 MB per upload

export async function transcribeMedia({
  inputPath,
  format = '.srt',
  logger = console,
} = {}) {
  if (!inputPath) {
    throw new Error('inputPath is required');
  }

  const resolvedInput = path.resolve(inputPath);
  const normalizedFormat = normalizeSubtitleFormat(format);

  await assertPathExists(resolvedInput);

  const client = createOpenAIClient();
  const transcriptionOptions = getTranscriptionOptions();
  const warnings = [];

  const audioPreparation = await prepareAudioForTranscription(resolvedInput, logger);

  try {
    logger?.log?.(`Preparing transcription using ${transcriptionOptions.timedModel}...`);

    const timedResult = await transcribeWithTimedModel(
      client,
      audioPreparation.audioPath,
      transcriptionOptions,
      logger
    );

    let highAccuracyResult = null;
    if (shouldRunHighAccuracy(transcriptionOptions.highAccuracyModel)) {
      logger?.log?.(`Running high-accuracy transcription with ${transcriptionOptions.highAccuracyModel}...`);
      try {
        highAccuracyResult = await transcribeWithHighAccuracyModel(
          client,
          audioPreparation.audioPath,
          transcriptionOptions,
          logger
        );
      } catch (error) {
        warnings.push(`High-accuracy transcription failed: ${error.message ?? error}`);
        logger?.warn?.('High-accuracy transcription failed:', error);
      }
    }

    let refinedResult = timedResult;
    if (transcriptionOptions.correctionModel) {
      logger?.log?.(`Refining transcript with ${transcriptionOptions.correctionModel}...`);
      try {
        refinedResult = await refineTranscriptWithGPT(
          client,
          timedResult,
          highAccuracyResult,
          transcriptionOptions,
          logger
        );
      } catch (error) {
        warnings.push(`Correction model failed: ${error.message ?? error}`);
        logger?.warn?.('Correction model failed:', error);
      }
    }

    const subtitleContent = renderSubtitleContent(refinedResult, normalizedFormat);

    return {
      text: refinedResult.text,
      segments: refinedResult.segments,
      subtitle: {
        format: normalizedFormat,
        content: subtitleContent,
      },
      models: {
        timed: transcriptionOptions.timedModel,
        highAccuracy: highAccuracyResult ? transcriptionOptions.highAccuracyModel : null,
        correction: transcriptionOptions.correctionModel ?? null,
      },
      warnings,
    };
  } finally {
    if (audioPreparation.cleanup) {
      await audioPreparation.cleanup().catch(() => {});
    }
  }
}

export function renderSubtitleContent(result, format) {
  const normalizedFormat = normalizeSubtitleFormat(format);

  if (normalizedFormat === '.txt') {
    return result.text;
  }

  if (!result?.segments?.length) {
    throw new Error('Cannot render structured subtitle without segment data.');
  }

  if (normalizedFormat === '.srt') {
    return buildSrtFromSegments(result.segments);
  }

  if (normalizedFormat === '.vtt') {
    return buildVttFromSegments(result.segments);
  }

  throw new Error(`Unsupported subtitle format ${format}`);
}

export async function burnSubtitles(inputVideoPath, subtitlePath, { logger = console } = {}) {
  logger?.log?.('Burning subtitles into video with ffmpeg...');

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

  await runCommand('ffmpeg', args, { logger });
  return outputPath;
}

export function normalizeSubtitleFormat(format) {
  if (!format) {
    return '.srt';
  }
  const lower = format.trim().toLowerCase();
  const normalized = lower.startsWith('.') ? lower : `.${lower}`;
  if (!SUBTITLE_FORMATS.has(normalized)) {
    throw new Error(`Unsupported subtitle format ${format}. Supported formats: ${
      Array.from(SUBTITLE_FORMATS).join(', ')
    }`);
  }
  return normalized;
}

async function assertPathExists(filePath) {
  try {
    await fsp.access(filePath);
  } catch (error) {
    throw new Error(`File not found: ${filePath}`);
  }
}

function createOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is required for OpenAI transcription.');
  }
  return new OpenAI({ apiKey });
}

function getTranscriptionOptions() {
  const temperature = Number.parseFloat(process.env.OPENAI_TEMPERATURE ?? '0');
  const translate = /^true$/i.test(process.env.OPENAI_TRANSLATE ?? 'false');
  const language = process.env.OPENAI_LANGUAGE ?? undefined;
  const timedModel = process.env.OPENAI_TIMED_MODEL ?? 'whisper-1';
  const highAccuracyModel = process.env.OPENAI_HIGH_ACCURACY_MODEL ?? 'gpt-4o-transcribe';
  const correctionModel = process.env.OPENAI_CORRECTION_MODEL ?? 'gpt-5';

  return {
    temperature: Number.isFinite(temperature) ? temperature : 0,
    translate,
    language,
    timedModel,
    highAccuracyModel,
    correctionModel,
  };
}

async function transcribeWithTimedModel(client, audioPath, options, logger) {
  const { timedModel, temperature, translate, language } = options;
  const responseFormat = timedModel.includes('whisper') ? 'verbose_json' : 'json';

  logger?.log?.(`Uploading audio to ${timedModel} for timestamped transcription...`);

  const transcription = await client.audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model: timedModel,
    temperature,
    response_format: responseFormat,
    translate,
    language,
    timestamp_granularities: ['segment'],
  });

  const segments = extractSegmentsFromTranscription(transcription);
  const combinedText = transcription.text?.trim()
    ?? segments.map(segment => segment.text).join(' ').trim();

  if (!segments.length) {
    throw new Error(`No segments returned by model ${timedModel}; cannot proceed without timestamps.`);
  }

  return { text: combinedText, segments };
}

function shouldRunHighAccuracy(modelName) {
  if (!modelName) {
    return false;
  }
  const normalized = modelName.trim().toLowerCase();
  return normalized !== 'none' && normalized !== 'skip' && normalized !== 'false';
}

async function transcribeWithHighAccuracyModel(client, audioPath, options, logger) {
  const { highAccuracyModel, temperature, translate, language } = options;

  const transcription = await client.audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model: highAccuracyModel,
    temperature,
    response_format: 'json',
    translate,
    language,
    timestamp_granularities: ['segment'],
  });

  const segments = extractSegmentsFromTranscription(transcription);
  const combinedText = transcription.text?.trim()
    ?? segments.map(segment => segment.text).join(' ').trim();

  if (!combinedText) {
    throw new Error(`High-accuracy model ${highAccuracyModel} returned no text.`);
  }

  return {
    text: combinedText,
    segments: segments.length ? segments : null,
  };
}

function extractSegmentsFromTranscription(transcription) {
  const rawSegments = Array.isArray(transcription.segments) ? transcription.segments : [];
  return rawSegments.map(segment => ({
    id: segment.id,
    start: Number(segment.start ?? segment.begin ?? segment.timing?.start ?? 0),
    end: Number(segment.end ?? segment.timing?.end ?? 0),
    text: String(segment.text ?? segment.content ?? '').trim(),
  })).filter(segment => Number.isFinite(segment.start) && Number.isFinite(segment.end));
}

async function refineTranscriptWithGPT(client, baseResult, highAccuracyResult, options, logger) {
  const model = options.correctionModel;
  if (!model) {
    return baseResult;
  }

  const payload = {
    base_segments: baseResult.segments.map(segment => ({
      id: segment.id,
      start: segment.start,
      end: segment.end,
      text: segment.text,
    })),
    base_text: baseResult.text,
    high_accuracy: highAccuracyResult
      ? {
          text: highAccuracyResult.text,
          segments: highAccuracyResult.segments?.map(segment => ({
            id: segment.id,
            start: segment.start,
            end: segment.end,
            text: segment.text,
          })) ?? null,
        }
      : null,
  };

  const response = await client.responses.create({
    model,
    input: [
      {
        role: 'system',
        content: [
          {
            type: 'input_text',
            text: 'You are an expert Hebrew transcription editor. Improve accuracy and grammar while preserving meaning, speaker intent, and timestamps.'
          }
        ]
      },
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: `Using the JSON payload provided, return JSON with a "segments" array. Each segment must retain the same id, start, and end fields from base_segments, but you should improve the text field using all provided context (base_text and high_accuracy data). Avoid merging or splitting segments.`
          }
        ]
      },
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: JSON.stringify(payload)
          }
        ]
      }
    ]
  });

  if (!response.output_text) {
    throw new Error('Correction model returned no output.');
  }

  let parsed;
  try {
    parsed = JSON.parse(response.output_text);
  } catch (error) {
    throw new Error(`Failed to parse correction model output: ${error.message ?? error}`);
  }

  if (!parsed?.segments || !Array.isArray(parsed.segments)) {
    throw new Error('Correction model response missing "segments" array.');
  }

  const refinedSegments = parsed.segments.map(original => {
    const reference = baseResult.segments.find(seg => seg.id === original.id);
    if (!reference) {
      throw new Error(`Correction output references unknown segment id ${original.id}`);
    }
    return {
      id: reference.id,
      start: reference.start,
      end: reference.end,
      text: String(original.text ?? '').trim() || reference.text,
    };
  });

  const refinedText = refinedSegments.map(segment => segment.text).join(' ').trim();

  return {
    text: refinedText || baseResult.text,
    segments: refinedSegments,
  };
}

async function prepareAudioForTranscription(inputPath, logger) {
  const stats = await fsp.stat(inputPath);
  const ext = path.extname(inputPath).toLowerCase();

  const isAudio = AUDIO_EXTENSIONS.has(ext);
  const withinLimit = stats.size <= OPENAI_UPLOAD_LIMIT_BYTES;

  if (isAudio && withinLimit) {
    return { audioPath: inputPath, cleanup: null };
  }

  await assertFfmpeg();

  const tempPath = path.join(
    path.dirname(inputPath),
    `${path.basename(inputPath, path.extname(inputPath))}_openai_tmp.mp3`
  );

  logger?.log?.('Converting media to OpenAI-friendly audio (mono 16 kHz)...');

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
  ], { logger });

  const convertedStats = await fsp.stat(tempPath);
  if (convertedStats.size > OPENAI_UPLOAD_LIMIT_BYTES) {
    throw new Error(
      `Converted audio (${(convertedStats.size / (1024 * 1024)).toFixed(1)} MB) still exceeds the 25 MB OpenAI limit.`
    );
  }

  return {
    audioPath: tempPath,
    cleanup: () => fsp.unlink(tempPath),
  };
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

async function assertFfmpeg() {
  try {
    await runCommand('ffmpeg', ['-version'], { stdio: 'ignore' });
  } catch (error) {
    throw new Error('ffmpeg is required but was not found in PATH.');
  }
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

async function runCommand(command, args, { stdio = 'inherit', cwd, logger } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio, cwd, shell: false });

    child.on('error', error => {
      logger?.error?.(error);
      reject(error);
    });

    child.on('close', code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
  });
}
