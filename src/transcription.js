import fs from "fs";
import { promises as fsp } from "fs";
import { spawn } from "child_process";
import path from "path";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac", ".opus"]);
const SUBTITLE_FORMATS = new Set([".txt", ".srt", ".vtt"]);
const OPENAI_UPLOAD_LIMIT_BYTES = 25 * 1024 * 1024; // 25 MB per upload

export async function transcribeMedia({
  inputPath,
  format = ".srt",
  logger = console,
  onStage,
} = {}) {
  if (!inputPath) {
    throw new Error("inputPath is required");
  }

  const resolvedInput = path.resolve(inputPath);
  const normalizedFormat = normalizeSubtitleFormat(format);
  await assertPathExists(resolvedInput);

  const client = createOpenAIClient();
  const options = getTranscriptionOptions();
  const warnings = [];
  const usage = {}; // Track API usage for billing

  const notify = (stage, status, message) => {
    try {
      onStage?.(stage, status, message);
    } catch (error) {
      logger.warn?.("Stage notifier failed", error);
    }
  };

  const audioPreparation = await prepareAudioForTranscription(resolvedInput, logger);

  try {
    notify("timed-transcription", "start");
    const timedResult = await transcribeWithTimedModel(
      client,
      audioPreparation.audioPath,
      options,
      logger,
    );
    if (timedResult.usage) {
      usage.timedTranscription = timedResult.usage;
    }
    notify("timed-transcription", "done");

    let highAccuracyResult = null;
    if (shouldRunHighAccuracy(options.highAccuracyModel)) {
      notify("high-accuracy", "start");
      try {
        highAccuracyResult = await transcribeWithHighAccuracyModel(
          client,
          audioPreparation.audioPath,
          options,
          logger,
        );
        if (highAccuracyResult.usage) {
          usage.highAccuracy = highAccuracyResult.usage;
        }
        notify("high-accuracy", "done");
      } catch (error) {
        warnings.push(`High accuracy transcription failed: ${error.message ?? error}`);
        logger.warn?.("High accuracy failed", error);
        notify("high-accuracy", "error", error.message ?? String(error));
      }
    } else {
      notify("high-accuracy", "skipped");
    }

    let refinedResult = timedResult;
    if (options.correctionModel) {
      notify("correction", "start");
      try {
        refinedResult = await refineTranscriptWithGPT(
          client,
          timedResult,
          highAccuracyResult,
          options,
          logger,
        );
        if (refinedResult.usage) {
          usage.correction = refinedResult.usage;
        }
        notify("correction", "done");
      } catch (error) {
        warnings.push(`Correction model failed: ${error.message ?? error}`);
        logger.warn?.("Correction model failed", error);
        notify("correction", "error", error.message ?? String(error));
        refinedResult = timedResult;
      }
    } else {
      notify("correction", "skipped");
    }

    const subtitleContent = renderSubtitleContent(refinedResult, normalizedFormat);

    return {
      text: refinedResult.text,
      segments: refinedResult.segments,
      words: refinedResult.words ?? timedResult.words ?? [],
      subtitle: {
        format: normalizedFormat,
        content: subtitleContent,
      },
      warnings,
      models: {
        timed: options.timedModel,
        highAccuracy: highAccuracyResult ? options.highAccuracyModel : null,
        correction: options.correctionModel ?? null,
      },
      usage, // Include API usage data
    };
  } finally {
    if (audioPreparation.cleanup) {
      await audioPreparation.cleanup().catch(() => {});
    }
  }
}

export function renderSubtitleContent(result, format) {
  const normalizedFormat = normalizeSubtitleFormat(format);

  if (normalizedFormat === ".txt") {
    return result.text;
  }

  if (!result?.segments?.length) {
    throw new Error("Cannot render structured subtitle without segment data.");
  }

  if (normalizedFormat === ".srt") {
    return buildSrtFromSegments(result.segments);
  }

  if (normalizedFormat === ".vtt") {
    return buildVttFromSegments(result.segments);
  }

  throw new Error(`Unsupported subtitle format ${format}`);
}

export async function burnSubtitles(inputVideoPath, subtitlePath, { logger = console } = {}) {
  logger?.log?.("Burning subtitles into video with ffmpeg...");

  await assertFfmpeg();

  const outputPath = buildBurnedVideoPath(inputVideoPath);
  const filterArg = `subtitles='${escapeForSubtitleFilter(subtitlePath)}'`;
  const args = [
    "-y",
    "-i",
    inputVideoPath,
    "-vf",
    filterArg,
    "-c:v",
    "libx264",
    "-crf",
    "18",
    "-preset",
    "medium",
    "-c:a",
    "copy",
    outputPath,
  ];

  await runCommand("ffmpeg", args, { logger });
  return outputPath;
}

export function normalizeSubtitleFormat(format) {
  if (!format) {
    return ".srt";
  }
  const lower = format.trim().toLowerCase();
  const normalized = lower.startsWith(".") ? lower : `.${lower}`;
  if (!SUBTITLE_FORMATS.has(normalized)) {
    throw new Error(
      `Unsupported subtitle format ${format}. Supported formats: ${Array.from(SUBTITLE_FORMATS).join(", ")}`,
    );
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
    throw new Error("OPENAI_API_KEY environment variable is required for OpenAI transcription.");
  }
  return new OpenAI({ apiKey });
}

function getTranscriptionOptions() {
  const temperature = Number.parseFloat(process.env.OPENAI_TEMPERATURE ?? "0");
  const translate = /^true$/i.test(process.env.OPENAI_TRANSLATE ?? "false");
  const language = process.env.OPENAI_LANGUAGE ?? undefined;
  const timedModel = process.env.OPENAI_TIMED_MODEL ?? "whisper-1";
  const highAccuracyModel = process.env.OPENAI_HIGH_ACCURACY_MODEL ?? "gpt-4o-transcribe";
  const correctionModel = process.env.OPENAI_CORRECTION_MODEL ?? "gpt-5";

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
  const responseFormat = timedModel.includes("whisper") ? "verbose_json" : "json";

  logger?.log?.(`Uploading audio to ${timedModel} for timestamped transcription...`);

  const transcription = await client.audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model: timedModel,
    temperature,
    response_format: responseFormat,
    translate,
    language,
    timestamp_granularities: ["word", "segment"],
  });

  const segments = extractSegmentsFromTranscription(transcription);
  const words = Array.isArray(transcription.words) ? transcription.words : [];
  const combinedText =
    transcription.text?.trim() ?? segments.map((segment) => segment.text).join(" ").trim();

  if (!segments.length) {
    throw new Error(`No segments returned by model ${timedModel}; cannot proceed without timestamps.`);
  }

  // Extract usage data for billing (duration in seconds)
  const duration = segments.length > 0 ? segments[segments.length - 1].end : 0;

  return {
    text: combinedText,
    segments,
    words,
    usage: {
      model: timedModel,
      durationSeconds: duration,
      durationMinutes: duration / 60,
    },
  };
}

function shouldRunHighAccuracy(modelName) {
  if (!modelName) {
    return false;
  }
  const normalized = modelName.trim().toLowerCase();
  return normalized !== "none" && normalized !== "skip" && normalized !== "false";
}

async function transcribeWithHighAccuracyModel(client, audioPath, options, logger) {
  const { highAccuracyModel, temperature, translate, language } = options;

  const transcription = await client.audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model: highAccuracyModel,
    temperature,
    response_format: "json",
    translate,
    language,
    timestamp_granularities: ["segment"],
  });

  const segments = extractSegmentsFromTranscription(transcription);
  const combinedText =
    transcription.text?.trim() ?? segments.map((segment) => segment.text).join(" ").trim();

  if (!combinedText) {
    throw new Error(`High-accuracy model ${highAccuracyModel} returned no text.`);
  }

  // Extract usage data for billing
  const duration = segments.length > 0 ? segments[segments.length - 1].end : 0;

  return {
    text: combinedText,
    segments: segments.length ? segments : null,
    usage: {
      model: highAccuracyModel,
      durationSeconds: duration,
      durationMinutes: duration / 60,
    },
  };
}

function extractSegmentsFromTranscription(transcription) {
  const rawSegments = Array.isArray(transcription.segments) ? transcription.segments : [];
  return rawSegments
    .map((segment) => ({
      id: segment.id,
      start: Number(segment.start ?? segment.begin ?? segment.timing?.start ?? 0),
      end: Number(segment.end ?? segment.timing?.end ?? 0),
      text: String(segment.text ?? segment.content ?? "").trim(),
    }))
    .filter((segment) => Number.isFinite(segment.start) && Number.isFinite(segment.end));
}

/**
 * Aligns corrected segment text with original word-level timestamps
 * Uses fuzzy matching to map corrected words to their original timestamps
 */
function alignWordsToSegments(originalWords, originalSegments, correctedSegments) {
  const alignedWords = [];

  for (const correctedSegment of correctedSegments) {
    const originalSegment = originalSegments.find(seg => seg.id === correctedSegment.id);
    if (!originalSegment) continue;

    // Get words that fall within this segment's time range (with small buffer for boundary issues)
    const segmentWords = originalWords.filter(
      word => word.start >= originalSegment.start - 0.01 && word.start <= originalSegment.end + 0.01
    );

    if (segmentWords.length === 0) continue;

    // Tokenize corrected text (split by whitespace and punctuation)
    const correctedTokens = tokenizeText(correctedSegment.text);

    if (correctedTokens.length === 0) {
      // No corrected text, just use original words
      alignedWords.push(...segmentWords);
      continue;
    }

    const originalTokens = segmentWords.map(w => normalizeWord(w.word));

    // Align corrected tokens to original words using sequence alignment
    const alignment = alignTokenSequences(originalTokens, correctedTokens, segmentWords);

    // Map aligned tokens back to timestamps
    for (const item of alignment) {
      if (item.originalIndex !== null && item.originalIndex < segmentWords.length) {
        const originalWord = segmentWords[item.originalIndex];
        alignedWords.push({
          word: item.correctedToken || originalWord.word,
          start: originalWord.start,
          end: originalWord.end,
        });
      } else if (item.correctedToken) {
        // New word with no original match - estimate timing
        const prevWord = alignedWords[alignedWords.length - 1];
        if (prevWord) {
          const estimatedDuration = 0.3; // Default word duration
          alignedWords.push({
            word: item.correctedToken,
            start: prevWord.end,
            end: prevWord.end + estimatedDuration,
          });
        }
      }
    }
  }

  return alignedWords;
}

/**
 * Tokenize text into words, preserving Hebrew and handling punctuation
 */
function tokenizeText(text) {
  // Split on whitespace and separate punctuation
  return text
    .trim()
    .split(/\s+/)
    .flatMap(token => {
      // Keep Hebrew/alphanumeric together, split off trailing punctuation
      const match = token.match(/^([\u0590-\u05FF\w]+)(.*?)$/);
      if (match) {
        return [match[1], ...(match[2] ? [match[2]] : [])].filter(Boolean);
      }
      return [token];
    })
    .filter(t => t.length > 0);
}

/**
 * Normalize word for comparison (remove punctuation, lowercase)
 */
function normalizeWord(word) {
  return word.replace(/[^\u0590-\u05FF\w]/g, '').toLowerCase();
}

/**
 * Align two token sequences using improved dynamic programming approach
 * Returns array of {originalIndex, correctedToken} mappings
 */
function alignTokenSequences(originalTokens, correctedTokens, segmentWords) {
  const alignment = [];
  let origIdx = 0;
  let corrIdx = 0;

  while (origIdx < originalTokens.length || corrIdx < correctedTokens.length) {
    // If we've exhausted corrected tokens, add remaining original words
    if (corrIdx >= correctedTokens.length) {
      if (origIdx < originalTokens.length) {
        alignment.push({
          originalIndex: origIdx,
          correctedToken: segmentWords[origIdx].word
        });
        origIdx++;
      }
      continue;
    }

    // If we've exhausted original tokens, add remaining corrected words without timestamps
    if (origIdx >= originalTokens.length) {
      alignment.push({
        originalIndex: null,
        correctedToken: correctedTokens[corrIdx]
      });
      corrIdx++;
      continue;
    }

    const origNorm = originalTokens[origIdx];
    const corrNorm = normalizeWord(correctedTokens[corrIdx]);

    // Exact match
    if (origNorm === corrNorm) {
      alignment.push({ originalIndex: origIdx, correctedToken: correctedTokens[corrIdx] });
      origIdx++;
      corrIdx++;
    }
    // Prefix match (corrected word is longer - e.g., "hello" -> "hello!")
    else if (corrNorm.startsWith(origNorm) && origNorm.length >= 2) {
      alignment.push({ originalIndex: origIdx, correctedToken: correctedTokens[corrIdx] });
      origIdx++;
      corrIdx++;
    }
    // Prefix match (original word is longer - e.g., "hello!" -> "hello")
    else if (origNorm.startsWith(corrNorm) && corrNorm.length >= 2) {
      alignment.push({ originalIndex: origIdx, correctedToken: correctedTokens[corrIdx] });
      origIdx++;
      corrIdx++;
    }
    // Check if next corrected token matches current original (insertion in corrected)
    else if (corrIdx + 1 < correctedTokens.length &&
             originalTokens[origIdx] === normalizeWord(correctedTokens[corrIdx + 1])) {
      // Corrected has an insertion - add it without timestamp
      alignment.push({ originalIndex: null, correctedToken: correctedTokens[corrIdx] });
      corrIdx++;
    }
    // Check if next original token matches current corrected (deletion in corrected)
    else if (origIdx + 1 < originalTokens.length &&
             originalTokens[origIdx + 1] === corrNorm) {
      // Corrected deleted a word - skip original but keep timestamp for context
      alignment.push({ originalIndex: origIdx, correctedToken: segmentWords[origIdx].word });
      origIdx++;
    }
    // Fuzzy similarity match
    else {
      const similarity = computeSimilarity(origNorm, corrNorm);
      if (similarity > 0.5) {
        // Similar enough - map them
        alignment.push({ originalIndex: origIdx, correctedToken: correctedTokens[corrIdx] });
        origIdx++;
        corrIdx++;
      } else {
        // No match at all - check lookahead for better match
        let foundBetterMatch = false;

        // Look ahead 2 positions in both directions
        for (let lookAhead = 1; lookAhead <= 2 && !foundBetterMatch; lookAhead++) {
          // Check if current corrected matches a future original
          if (origIdx + lookAhead < originalTokens.length &&
              corrNorm === originalTokens[origIdx + lookAhead]) {
            // Skip original words that were deleted
            for (let skip = 0; skip < lookAhead; skip++) {
              alignment.push({
                originalIndex: origIdx + skip,
                correctedToken: segmentWords[origIdx + skip].word
              });
            }
            origIdx += lookAhead;
            foundBetterMatch = true;
          }
          // Check if current original matches a future corrected
          else if (corrIdx + lookAhead < correctedTokens.length &&
                   origNorm === normalizeWord(correctedTokens[corrIdx + lookAhead])) {
            // Skip corrected words that were inserted
            for (let skip = 0; skip < lookAhead; skip++) {
              alignment.push({
                originalIndex: null,
                correctedToken: correctedTokens[corrIdx + skip]
              });
            }
            corrIdx += lookAhead;
            foundBetterMatch = true;
          }
        }

        if (!foundBetterMatch) {
          // No better match found - assume they correspond
          alignment.push({ originalIndex: origIdx, correctedToken: correctedTokens[corrIdx] });
          origIdx++;
          corrIdx++;
        }
      }
    }
  }

  return alignment;
}

/**
 * Compute similarity between two strings (0-1)
 * Using simple character overlap ratio
 */
function computeSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;
  const set1 = new Set(str1.split(''));
  const set2 = new Set(str2.split(''));
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  return union.size > 0 ? intersection.size / union.size : 0;
}

async function refineTranscriptWithGPT(client, baseResult, highAccuracyResult, options, logger) {
  const model = options.correctionModel;
  if (!model) {
    return baseResult;
  }

  const payload = {
    base_segments: baseResult.segments.map((segment) => ({
      id: segment.id,
      start: segment.start,
      end: segment.end,
      text: segment.text,
    })),
    base_text: baseResult.text,
    high_accuracy: highAccuracyResult
      ? {
          text: highAccuracyResult.text,
          segments:
            highAccuracyResult.segments?.map((segment) => ({
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
        role: "system",
        content: [
          {
            type: "input_text",
            text: "You are an expert Hebrew transcription editor. Improve accuracy and grammar while preserving meaning, speaker intent, and timestamps.",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: "Using the JSON payload provided, return JSON with a \"segments\" array. Each segment must retain the same id, start, and end fields from base_segments, but you should improve the text field using all provided context (base_text and high_accuracy data). Avoid merging or splitting segments.",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify(payload),
          },
        ],
      },
    ],
  });

  if (!response.output_text) {
    throw new Error("Correction model returned no output.");
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

  const refinedSegments = parsed.segments.map((original) => {
    const reference = baseResult.segments.find((seg) => seg.id === original.id);
    if (!reference) {
      throw new Error(`Correction output references unknown segment id ${original.id}`);
    }
    return {
      id: reference.id,
      start: reference.start,
      end: reference.end,
      text: String(original.text ?? "").trim() || reference.text,
    };
  });

  const refinedText = refinedSegments.map((segment) => segment.text).join(" ").trim();

  // Align corrected words with original timestamps
  const refinedWords = baseResult.words ? alignWordsToSegments(baseResult.words, baseResult.segments, refinedSegments) : [];

  // Extract token usage for billing
  const usage = {
    model: model,
    inputTokens: response.usage?.input_tokens || 0,
    outputTokens: response.usage?.output_tokens || 0,
    cachedTokens: response.usage?.cached_tokens || 0,
  };

  return {
    text: refinedText || baseResult.text,
    segments: refinedSegments,
    words: refinedWords,
    usage,
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
    `${path.basename(inputPath, path.extname(inputPath))}_openai_tmp.mp3`,
  );

  logger?.log?.("Converting media to OpenAI-friendly audio (mono 16 kHz)...");

  await runCommand(
    "ffmpeg",
    [
      "-y",
      "-i",
      inputPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-b:a",
      "128k",
      tempPath,
    ],
    { logger },
  );

  const convertedStats = await fsp.stat(tempPath);
  if (convertedStats.size > OPENAI_UPLOAD_LIMIT_BYTES) {
    throw new Error(
      `Converted audio (${(convertedStats.size / (1024 * 1024)).toFixed(1)} MB) still exceeds the 25 MB OpenAI limit.`,
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
      const start = formatTimestamp(segment.start, ",");
      const end = formatTimestamp(segment.end, ",");
      const text = segment.text.replace(/\s+/g, " ").trim();
      return `${index + 1}\n${start} --> ${end}\n${text}\n`;
    })
    .join("\n");
}

function buildVttFromSegments(segments) {
  const body = segments
    .map((segment) => {
      const start = formatTimestamp(segment.start, ".");
      const end = formatTimestamp(segment.end, ".");
      const text = segment.text.replace(/\s+/g, " ").trim();
      return `${start} --> ${end}\n${text}`;
    })
    .join("\n\n");

  return `WEBVTT\n\n${body}\n`;
}

function formatTimestamp(seconds, millisecondSeparator) {
  const totalMilliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((totalMilliseconds % 60_000) / 1000);
  const millis = totalMilliseconds % 1000;

  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  const ss = String(secs).padStart(2, "0");
  const ms = String(millis).padStart(3, "0");

  return `${hh}:${mm}:${ss}${millisecondSeparator}${ms}`;
}

async function assertFfmpeg() {
  try {
    await runCommand("ffmpeg", ["-version"], { stdio: "ignore" });
  } catch (error) {
    throw new Error("ffmpeg is required but was not found in PATH.");
  }
}

/**
 * Get media duration in seconds using ffprobe
 * @param {string} filePath - Path to media file
 * @returns {Promise<number>} Duration in seconds
 */
export async function getMediaDuration(filePath) {
  return new Promise((resolve, reject) => {
    const args = [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath
    ];

    const child = spawn("ffprobe", args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let errorOutput = "";

    child.stdout.on("data", (data) => {
      output += data.toString();
    });

    child.stderr.on("data", (data) => {
      errorOutput += data.toString();
    });

    child.on("error", (error) => {
      reject(new Error(`ffprobe not found: ${error.message}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        const duration = parseFloat(output.trim());
        if (Number.isFinite(duration) && duration > 0) {
          resolve(duration);
        } else {
          reject(new Error("Could not parse media duration"));
        }
      } else {
        reject(new Error(`ffprobe failed: ${errorOutput}`));
      }
    });
  });
}

function buildBurnedVideoPath(inputVideoPath) {
  const directory = path.dirname(inputVideoPath);
  const baseName = path.basename(inputVideoPath, path.extname(inputVideoPath));
  return path.join(directory, `${baseName}_burned.mp4`);
}

function escapeForSubtitleFilter(filePath) {
  return path
    .resolve(filePath)
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");
}

async function runCommand(command, args, { stdio = "inherit", cwd, logger } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio, cwd, shell: false });

    child.on("error", (error) => {
      logger?.error?.(error);
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
  });
}

/**
 * Transcribe media with word-level timestamps using OpenAI Whisper API
 * @param {Object} params - Parameters
 * @param {string} params.inputPath - Path to media file
 * @param {string} params.outputPath - Path for output TXT file (optional)
 * @param {Object} params.logger - Logger object
 * @returns {Promise<Object>} Object with text, segments, and words array
 */
export async function transcribeWithWordTimestamps({
  inputPath,
  outputPath = null,
  logger = console,
} = {}) {
  if (!inputPath) {
    throw new Error("inputPath is required");
  }

  const resolvedInput = path.resolve(inputPath);
  await assertPathExists(resolvedInput);

  const client = createOpenAIClient();
  const options = getTranscriptionOptions();

  logger?.log?.("Preparing audio for word-level transcription...");
  const audioPreparation = await prepareAudioForTranscription(resolvedInput, logger);

  try {
    logger?.log?.(`Uploading audio to ${options.timedModel} for word-level transcription...`);

    // Request word-level timestamps from Whisper API
    const transcription = await client.audio.transcriptions.create({
      file: fs.createReadStream(audioPreparation.audioPath),
      model: options.timedModel,
      temperature: options.temperature,
      response_format: "verbose_json",
      language: options.language,
      timestamp_granularities: ["word", "segment"],
    });

    logger?.log?.("Processing word-level timestamps...");

    // Extract word-level data
    const words = Array.isArray(transcription.words) ? transcription.words : [];
    const segments = extractSegmentsFromTranscription(transcription);

    if (!words.length) {
      throw new Error("No word-level timestamps returned by the API");
    }

    // Format output text
    const outputText = formatWordTimestampsAsText(words, segments);

    // Save to file if output path specified
    if (outputPath) {
      const resolvedOutput = path.resolve(outputPath);
      await fsp.writeFile(resolvedOutput, outputText, "utf-8");
      logger?.log?.(`Word-level timestamps saved to: ${resolvedOutput}`);
    }

    return {
      text: transcription.text,
      segments,
      words,
      formattedOutput: outputText,
    };
  } finally {
    if (audioPreparation.cleanup) {
      await audioPreparation.cleanup().catch(() => {});
    }
  }
}

/**
 * Format word timestamps as readable text
 * @param {Array} words - Array of word objects with start, end, and word properties
 * @param {Array} segments - Array of segment objects
 * @returns {string} Formatted text output
 */
function formatWordTimestampsAsText(words, segments) {
  let output = "WORD-LEVEL TIMESTAMPS\n";
  output += "=" .repeat(80) + "\n\n";

  // Group words by segments
  for (const segment of segments) {
    output += `SEGMENT ${segment.id} [${formatTimestamp(segment.start, ",")} --> ${formatTimestamp(segment.end, ",")}]\n`;
    output += "-".repeat(80) + "\n";
    output += `Full text: ${segment.text}\n\n`;

    // Find words that belong to this segment
    const segmentWords = words.filter(
      (word) => word.start >= segment.start && word.end <= segment.end
    );

    if (segmentWords.length > 0) {
      output += "Words:\n";
      for (const word of segmentWords) {
        const startTime = formatTimestamp(word.start, ",");
        const endTime = formatTimestamp(word.end, ",");
        const duration = (word.end - word.start).toFixed(3);
        output += `  [${startTime} --> ${endTime}] (${duration}s) "${word.word}"\n`;
      }
    } else {
      output += "No word-level timestamps available for this segment\n";
    }

    output += "\n";
  }

  // Add summary
  output += "=" .repeat(80) + "\n";
  output += `SUMMARY\n`;
  output += "-".repeat(80) + "\n";
  output += `Total segments: ${segments.length}\n`;
  output += `Total words: ${words.length}\n`;
  output += `Video duration: ${formatTimestamp(segments[segments.length - 1]?.end || 0, ",")}\n`;

  return output;
}
