#!/usr/bin/env node

/**
 * Test script for word-level timestamp API endpoint
 * Tests the /api/transcribe-words route
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import FormData from "form-data";
import fetch from "node-fetch";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_URL = "http://localhost:3000/api/transcribe-words";
const TEST_VIDEO_PATH = path.join(__dirname, "test.mp4");

async function testWordLevelAPI() {
  console.log("=".repeat(80));
  console.log("TESTING WORD-LEVEL TIMESTAMP API");
  console.log("=".repeat(80));
  console.log(`API Endpoint: ${API_URL}`);
  console.log(`Test Video: ${TEST_VIDEO_PATH}`);
  console.log("");

  // Check if test file exists
  if (!fs.existsSync(TEST_VIDEO_PATH)) {
    console.error("❌ Test video file not found:", TEST_VIDEO_PATH);
    process.exit(1);
  }

  try {
    // Create form data
    const formData = new FormData();
    formData.append("media", fs.createReadStream(TEST_VIDEO_PATH));

    console.log("📤 Uploading video for word-level transcription...");
    console.log("");

    // Make API request
    const response = await fetch(API_URL, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API request failed: ${response.status} - ${error}`);
    }

    const result = await response.json();

    console.log("=".repeat(80));
    console.log("✅ SUCCESS!");
    console.log("=".repeat(80));
    console.log(`Full Text: ${result.text.substring(0, 100)}...`);
    console.log(`Total Segments: ${result.segments.length}`);
    console.log(`Total Words: ${result.words.length}`);
    console.log("");

    // Show first 5 words
    console.log("Sample of first 5 words:");
    result.words.slice(0, 5).forEach((word, index) => {
      console.log(
        `  ${index + 1}. [${word.start.toFixed(2)}s - ${word.end.toFixed(2)}s] "${word.word}"`
      );
    });
    console.log("");

    // Show formatted output preview
    console.log("Formatted Output Preview (first 500 chars):");
    console.log("-".repeat(80));
    console.log(result.formattedOutput.substring(0, 500) + "...");
    console.log("");

    console.log("=".repeat(80));
    console.log("✅ API TEST COMPLETED SUCCESSFULLY!");
    console.log("=".repeat(80));

    return result;
  } catch (error) {
    console.error("\n" + "=".repeat(80));
    console.error("❌ API TEST FAILED!");
    console.error("=".repeat(80));
    console.error("Error:", error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run the test
testWordLevelAPI();
