import fs from 'fs';
import { promises as fsp } from 'fs';
import { spawn } from 'child_process';
import path from 'path';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const BURNABLE_FORMATS = new Set(['.srt', '.vtt']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.opus']);
const OPENAI_UPLOAD_LIMIT_BYTES = 25 * 1024 * 1024; // 25 MB per upload

async function main() {
  const [inputPath, outputPathArg] = process.argv.slice(2);

  if (!inputPath) {
    console.error('Usage: node transcribe.mjs <video-or-audio-file> [output-file]');
    process.exit(1);
  }

  const resolvedInput = path.resolve(process.cwd(), inputPath);
  const { format, outputPath } = buildOutputPath(resolvedInput, outputPathArg);

  const client = createOpenAIClient();
  const transcriptionOptions = getTranscriptionOptions();

  const audioPreparation = await prepareAudioForTranscription(resolvedInput);

  try {
    console.log(`Preparing transcription (${format.slice(1)} format) using ${transcriptionOptions.timedModel}...`);

    const timedResult = await transcribeWithTimedModel(
      client,
      audioPreparation.audioPath,
      transcriptionOptions
    );

    let highAccuracyResult = null;
    if (shouldRunHighAccuracy(transcriptionOptions.highAccuracyModel)) {
      try {
        highAccuracyResult = await transcribeWithHighAccuracyModel(
          client,
          audioPreparation.audioPath,
          transcriptionOptions
        );
      } catch (error) {
        console.warn('Warning: High-accuracy transcription failed:', error.message ?? error);
      }
    }

    const refinedResult = await refineTranscriptWithGPT(
      client,
      timedResult,
      highAccuracyResult,
      transcriptionOptions
    ).catch(error => {
      console.warn('Warning: Failed to refine transcript with GPT:', error.message ?? error);
      return timedResult;
    });

    await writeTranscriptFromSegments(refinedResult, format, outputPath);

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
  } finally {
    if (audioPreparation.cleanup) {
      await audioPreparation.cleanup().catch(() => {});
    }
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

async function transcribeWithTimedModel(client, audioPath, options) {
  const { timedModel, temperature, translate, language } = options;
  const responseFormat = timedModel.includes('whisper') ? 'verbose_json' : 'json';

  console.log(`Uploading audio to ${timedModel} for timestamped transcription...`);

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

async function transcribeWithHighAccuracyModel(client, audioPath, options) {
  const { highAccuracyModel, temperature, translate, language } = options;

  console.log(`Running high-accuracy transcription with ${highAccuracyModel}...`);

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

async function refineTranscriptWithGPT(client, baseResult, highAccuracyResult, options) {
  if (!baseResult?.segments?.length) {
    return baseResult;
  }

  const model = options.correctionModel;

  console.log(`Refining transcript with ${model} for improved accuracy...`);

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

  const outputText = response.output_text?.trim();
  if (!outputText) {
    throw new Error('Correction model returned no output.');
  }

  let parsed;
  try {
    parsed = JSON.parse(outputText);
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

async function prepareAudioForTranscription(inputPath) {
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
    audioPath: tempPath,
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
