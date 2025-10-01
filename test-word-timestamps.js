#!/usr/bin/env node

/**
 * WORD-LEVEL TIMESTAMP DETECTION TEST
 *
 * This script demonstrates the new word-level timestamp detection functionality
 * that uses OpenAI's Whisper API to detect the exact timing of each word in a video.
 *
 * IMPLEMENTATION:
 * - Added transcribeWithWordTimestamps() function in src/transcription.js
 * - Uses OpenAI Whisper API with timestamp_granularities: ["word", "segment"]
 * - Returns both segment-level and word-level timestamps
 * - Formats output as human-readable text file with precise timing for each word
 *
 * USAGE:
 *   node test-word-timestamps.js
 *
 * OUTPUT:
 * - Console output showing transcription progress and summary
 * - TXT file (word-timestamps-output.txt) with detailed word timing data
 *
 * The output file contains:
 * - Segments grouped by their timing ranges
 * - Each word within the segment with its exact start/end time
 * - Duration of each word in seconds
 * - Summary statistics (total segments, words, video duration)
 *
 * FUTURE USE:
 * This data can be used to highlight the currently spoken word on video during playback,
 * providing a karaoke-style subtitle experience.
 */

import { transcribeWithWordTimestamps } from "./src/transcription.js";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const inputPath = path.join(__dirname, "test.mp4");
  const outputPath = path.join(__dirname, "word-timestamps-output.txt");

  console.log("=".repeat(80));
  console.log("WORD-LEVEL TIMESTAMP DETECTION TEST");
  console.log("=".repeat(80));
  console.log(`Input video: ${inputPath}`);
  console.log(`Output file: ${outputPath}`);
  console.log("");

  try {
    const result = await transcribeWithWordTimestamps({
      inputPath,
      outputPath,
      logger: console,
    });

    console.log("\n" + "=".repeat(80));
    console.log("SUCCESS!");
    console.log("=".repeat(80));
    console.log(`Full text: ${result.text}`);
    console.log(`Total segments: ${result.segments.length}`);
    console.log(`Total words: ${result.words.length}`);
    console.log("");
    console.log("Sample of first 5 words:");
    result.words.slice(0, 5).forEach((word, index) => {
      console.log(
        `  ${index + 1}. [${word.start.toFixed(2)}s - ${word.end.toFixed(2)}s] "${word.word}"`
      );
    });
    console.log("");
    console.log(`Complete output saved to: ${outputPath}`);
  } catch (error) {
    console.error("\n" + "=".repeat(80));
    console.error("ERROR!");
    console.error("=".repeat(80));
    console.error(error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
