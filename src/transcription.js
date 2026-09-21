import fs from "fs";
import { promises as fsp } from "fs";
import { spawn } from "child_process";
import path from "path";
import OpenAI from "openai";
import "./loadAppEnv.js";
import { limitSubtitleCharacters } from "./subtitleSegmentation.js";
import { synchronizeWords, mergeCorrectedSegments, subtitleTokens } from "./wordAlignment.js";

const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac", ".opus"]);
const SUBTITLE_FORMATS = new Set([".txt", ".srt", ".vtt"]);
const OPENAI_UPLOAD_LIMIT_BYTES = 25 * 1024 * 1024; // 25 MB per upload

/**
 * Intelligently split a segment using AI with reasoning/thinking to find the best split point.
 * Considers sentence endings, joke punchlines (to avoid spoilers), and natural pauses.
 * Uses OpenAI reasoning models (o3, o4-mini) for deeper analysis.
 * @param {Object} segment - The segment to split {id, start, end, text}
 * @param {Array} words - Word-level timing data for the segment
 * @param {number} splitTime - The cursor position (approximate split time)
 * @returns {Promise<{segments: Array, splitIndex: number}>} Two new segments
 */
/**
 * AI-powered subtitle editor that modifies existing subtitles based on user instructions.
 * Can merge, split, rewrite, fix grammar, adjust timing, etc.
 * @param {Array} segments - Current subtitle segments
 * @param {Array} words - Word-level timing data
 * @param {string} instructions - User's instructions for how to modify the subtitles
 * @returns {Promise<{segments: Array}>} Modified segments
 */
export async function aiEditSubtitles(segments, words, instructions) {
  const client = createOpenAIClient();
  const model = process.env.OPENAI_EDIT_MODEL || "gpt-5.2";

  console.log(`AI editing subtitles with ${model} (reasoning enabled)...`);

  const segmentsData = segments.map((s, i) => ({
    index: i,
    id: s.id,
    start: s.start,
    end: s.end,
    text: s.text,
  }));

  // Include word timing data for reference
  const wordsData = words.map(w => ({
    word: w.word,
    start: w.start,
    end: w.end,
  }));

  const systemPrompt = `You are an expert Hebrew subtitle editor. The user will give you instructions on how to modify their subtitles.

You have access to:
1. The current subtitles with their timing (start/end in seconds)
2. Word-level timing data for precise adjustments

RULES:
- Follow the user's instructions carefully
- Preserve timing as much as possible - only adjust when necessary
- When splitting a subtitle, use the word timing to set accurate start/end times
- When merging subtitles, keep the first subtitle's start time and last subtitle's end time
- Keep the same segment IDs when modifying text (only change ID if splitting/merging)
- For new segments created by splitting, use timestamp-based IDs (Date.now() + index)
- If there's a joke or punchline, keep it in a separate subtitle to avoid spoilers
- Return valid JSON with a "segments" array

CAPABILITIES:
- Split long subtitles into shorter ones
- Merge short subtitles together
- Fix grammar and spelling
- Rewrite for clarity
- Adjust timing
- Remove or add subtitles
- Any other editing the user requests`;

  const userPrompt = `Current subtitles:
${JSON.stringify(segmentsData, null, 2)}

Word timing data (for reference when splitting):
${JSON.stringify(wordsData, null, 2)}

USER INSTRUCTIONS:
${instructions}

Return a JSON object with "segments" array containing the modified subtitles. Each segment must have: id, start, end, text`;

  const response = await client.responses.create({
    model: model,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: systemPrompt + "\n\n" + userPrompt,
          },
        ],
      },
    ],
    reasoning: {
      effort: "medium",
    },
    text: {
      format: {
        type: "json_object",
      },
    },
  });

  if (response.reasoning_summary) {
    console.log("AI reasoning summary:", response.reasoning_summary);
  }

  let result;
  try {
    result = JSON.parse(response.output_text);
  } catch (e) {
    throw new Error("Failed to parse AI response");
  }

  if (!result.segments || !Array.isArray(result.segments)) {
    throw new Error("AI response missing segments array");
  }

  // Validate and clean segments
  const validatedSegments = result.segments.map((s, i) => ({
    id: s.id ?? Date.now() + i,
    start: typeof s.start === "number" ? s.start : 0,
    end: typeof s.end === "number" ? s.end : 0,
    text: String(s.text || "").trim(),
  })).filter(s => s.text.length > 0);

  return {
    segments: validatedSegments,
    words: synchronizeWords(validatedSegments, words),
    reasoning: response.reasoning_summary || null,
  };
}

export async function intelligentSplitSegment(segment, words, splitTime) {
  const client = createOpenAIClient();
  const model = process.env.OPENAI_SPLIT_MODEL || "gpt-5.2";
  const useReasoning = true; // Always use reasoning API for better results

  // Filter words that belong to this segment
  const segmentWords = words.filter(
    (w) => w.start >= segment.start - 0.01 && w.end <= segment.end + 0.01
  );

  if (segmentWords.length < 2) {
    throw new Error("Segment must have at least 2 words to split");
  }

  // Create word list with indices for the AI
  const wordList = segmentWords.map((w, i) => ({
    index: i,
    word: w.word,
    start: w.start,
    end: w.end,
  }));

  // Find the approximate word index near the cursor
  const approximateIndex = segmentWords.findIndex(w => w.start >= splitTime) || Math.floor(segmentWords.length / 2);

  const systemPrompt = `You are an expert subtitle editor for Hebrew content. Your task is to find the BEST split point for a subtitle.

THINK CAREFULLY about:
1. Is there a complete sentence that ends before the suggested split point? If yes, split there.
2. Is this text a joke or has a punchline? If yes, identify the setup vs the punchline. The punchline MUST go in the SECOND subtitle to avoid spoiling the joke for viewers who read fast.
3. Are there natural pauses (commas, conjunctions like "ו", "אבל", "כי", "אז", "ש")?
4. Would splitting here break a phrase, idiom, or expression? If yes, find a better point.
5. Is the split balanced? Avoid very short segments (1-2 words) unless necessary.

The user suggested splitting around word index ${approximateIndex}, but you should analyze the content and adjust if there's a semantically better point.

Return a JSON object with:
- "splitAfterIndex": the index of the last word in the FIRST subtitle (0-based)
- "reason": your reasoning for choosing this split point`;

  const userPrompt = `Analyze this Hebrew subtitle and find the optimal split point.

Words with indices:
${JSON.stringify(wordList, null, 2)}

Full text: "${segment.text}"

Think about the meaning, any jokes/punchlines, and natural breaks. Then provide the best split point.`;

  let response;

  if (useReasoning) {
    // Use reasoning model with extended thinking
    console.log(`Using reasoning model ${model} for intelligent split...`);
    response = await client.responses.create({
      model: model,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: systemPrompt + "\n\n" + userPrompt,
            },
          ],
        },
      ],
      reasoning: {
        effort: "medium",  // Use medium reasoning effort for balance of speed and quality
      },
      text: {
        format: {
          type: "json_object",
        },
      },
    });

    // Log thinking summary if available
    if (response.reasoning_summary) {
      console.log("AI reasoning summary:", response.reasoning_summary);
    }

    let result;
    try {
      result = JSON.parse(response.output_text);
    } catch (e) {
      throw new Error("Failed to parse AI response for split point");
    }

    return processAISplitResult(result, segmentWords, segment);
  } else {
    // Fall back to regular chat completion for non-reasoning models
    response = await client.chat.completions.create({
      model: model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.1,
      response_format: { type: "json_object" },
    });

    let result;
    try {
      result = JSON.parse(response.choices[0].message.content);
    } catch (e) {
      throw new Error("Failed to parse AI response for split point");
    }

    return processAISplitResult(result, segmentWords, segment);
  }
}

/**
 * Process the AI's split result and create the two new segments
 */
function processAISplitResult(result, segmentWords, segment) {
  const splitAfterIndex = result.splitAfterIndex;

  // Validate the split index
  if (typeof splitAfterIndex !== "number" || splitAfterIndex < 0 || splitAfterIndex >= segmentWords.length - 1) {
    throw new Error(`Invalid split index: ${splitAfterIndex}`);
  }

  // Create two new segments based on the AI's recommendation
  const firstHalfWords = segmentWords.slice(0, splitAfterIndex + 1);
  const secondHalfWords = segmentWords.slice(splitAfterIndex + 1);

  const firstSegment = {
    id: Date.now(),
    start: segment.start,
    end: firstHalfWords[firstHalfWords.length - 1].end,
    text: firstHalfWords.map(w => w.word).join(" "),
  };

  const secondSegment = {
    id: Date.now() + 1,
    start: secondHalfWords[0].start,
    end: segment.end,
    text: secondHalfWords.map(w => w.word).join(" "),
  };

  return {
    segments: [firstSegment, secondSegment],
    splitIndex: splitAfterIndex,
    reason: result.reason || "AI-determined optimal split point",
  };
}

export async function resegmentWithGPT(words, maxWords, options = {}) {
  const client = createOpenAIClient();
  const model = process.env.OPENAI_RESEGMENT_MODEL || "gpt-5.2";
  const customInstructions = options.customInstructions || "";

  // Prepare the text content
  const fullText = words.map(w => w.word).join(" ");

  // Build system prompt with optional custom instructions
  let systemPrompt = `You are a subtitle segmentation expert for Hebrew content. Your task is to split the provided text into subtitle segments.

THINK CAREFULLY about:
1. Each segment should have at most ${maxWords} words (but can be fewer for natural breaks)
2. ALWAYS split at sentence endings (periods, question marks, exclamation marks)
3. If there's a joke or punchline, keep the punchline in a SEPARATE segment to avoid spoilers
4. Split at natural pauses (commas, conjunctions like "ו", "אבל", "כי", "אז")
5. Never split in the middle of a phrase or idiom
6. Keep segments balanced - avoid very short (1-2 words) or very long segments

Do NOT change any words. Only insert newlines to separate segments.
Return ONLY the text with newlines separating segments. No JSON, no markdown, no numbering.`;

  if (customInstructions) {
    systemPrompt += `\n\nADDITIONAL USER INSTRUCTIONS:\n${customInstructions}`;
  }

  // Use reasoning API for better segmentation
  console.log(`Resegmenting with ${model} (reasoning enabled)...`);
  const response = await client.responses.create({
    model: model,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: systemPrompt + "\n\nText to segment:\n" + fullText,
          },
        ],
      },
    ],
    reasoning: {
      effort: "medium",
    },
  });

  if (response.reasoning_summary) {
    console.log("AI reasoning summary:", response.reasoning_summary);
  }

  const segmentedText = response.output_text.trim();

  const segmentLines = segmentedText.split("\n").map(l => l.trim()).filter(Boolean);

  // Re-align original words to the new segments
  const newSegments = [];
  let currentWordIndex = 0;

  for (let i = 0; i < segmentLines.length; i++) {
    const lineText = segmentLines[i];
    // simple tokenization to count words in the line for alignment
    // This is a naive approach; for strict safety we should match word-for-word.
    // Given we asked GPT *not* to change text, we can try to walk forward in the words array.

    const lineTokens = subtitleTokens(lineText);
    const segmentWords = [];

    let matchCount = 0;
    // Try to match tokens to original words
    while (currentWordIndex < words.length && matchCount < lineTokens.length) {
      segmentWords.push(words[currentWordIndex]);
      currentWordIndex++;
      matchCount++;

      // Heuristic updates could go here if GPT changed punctuation, but we assume strict adherence.
    }

    if (segmentWords.length > 0) {
      newSegments.push({
        id: Date.now() + i,
        start: segmentWords[0].start,
        end: segmentWords[segmentWords.length - 1].end,
        text: segmentWords.map(w => w.word).join(" "),
      });
    }
  }

  // Catch any remaining words and append to last segment or create new one
  if (currentWordIndex < words.length) {
    const remainingWords = words.slice(currentWordIndex);
    newSegments.push({
      id: Date.now() + segmentLines.length,
      start: remainingWords[0].start,
      end: remainingWords[remainingWords.length - 1].end,
      text: remainingWords.map(w => w.word).join(" "),
    });
  }

  return newSegments;
}

/**
 * Simple resegmentation by word count without GPT.
 * Splits words into segments where each has at most maxWords words.
 */
function resegmentByWordCount(words, maxWords) {
  if (!words || words.length === 0 || !maxWords || maxWords < 1) {
    return [];
  }

  const segments = [];
  let currentWords = [];

  for (let i = 0; i < words.length; i++) {
    currentWords.push(words[i]);

    if (currentWords.length >= maxWords || i === words.length - 1) {
      const start = currentWords[0].start;
      const end = currentWords[currentWords.length - 1].end;
      const text = currentWords.map(w => w.word).join(" ");

      segments.push({
        id: Date.now() + segments.length,
        start,
        end,
        text,
      });

      currentWords = [];
    }
  }

  return segments;
}

export async function transcribeMedia({
  inputPath,
  format = ".srt",
  maxWordsPerSubtitle = 5,
  maxCharactersPerSubtitle = null,
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

    // Apply word limit resegmentation if words are available and maxWords is specified
    let words = synchronizeWords(refinedResult.segments, refinedResult.words?.length ? refinedResult.words : timedResult.words);
    let finalSegments = refinedResult.segments;

    if (maxCharactersPerSubtitle !== null) {
      finalSegments = limitSubtitleCharacters(finalSegments, words, maxCharactersPerSubtitle);
    } else if (words.length > 0 && maxWordsPerSubtitle > 0) {
      finalSegments = resegmentByWordCount(words, maxWordsPerSubtitle);
      logger.log?.(`Resegmented ${refinedResult.segments?.length ?? 0} segments into ${finalSegments.length} segments (max ${maxWordsPerSubtitle} words each)`);
    }

    words = synchronizeWords(finalSegments, words);
    if (words.some(word => word.timingSource === "estimated")) {
      warnings.push("לחלק מהמילים שהשתנו או שלא קיבלו תזמון מהמודל הותאם תזמון משוער. אפשר לדייק אותו בציר המילים.");
    }
    const resultForRender = {
      ...refinedResult,
      segments: finalSegments,
    };
    const subtitleContent = renderSubtitleContent(resultForRender, normalizedFormat);

    return {
      text: finalSegments.map(segment => segment.text).join(" "),
      segments: finalSegments,
      words,
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
      await audioPreparation.cleanup().catch(() => { });
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

/**
 * Tokenize text into words, preserving Hebrew and handling punctuation
 * (Exported for resegmentation usage if needed intra-module, though defined below)
 */

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

  const refinedSegments = mergeCorrectedSegments(baseResult.segments, parsed.segments);

  const refinedText = refinedSegments.map((segment) => segment.text).join(" ").trim();

  // Align corrected words with original timestamps
  const refinedWords = synchronizeWords(refinedSegments, baseResult.words);

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
      await audioPreparation.cleanup().catch(() => { });
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
  output += "=".repeat(80) + "\n\n";

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
  output += "=".repeat(80) + "\n";
  output += `SUMMARY\n`;
  output += "-".repeat(80) + "\n";
  output += `Total segments: ${segments.length}\n`;
  output += `Total words: ${words.length}\n`;
  output += `Video duration: ${formatTimestamp(segments[segments.length - 1]?.end || 0, ",")}\n`;

  return output;
}
