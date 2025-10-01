# Word-Level Timestamp Detection

## Overview

This feature uses OpenAI's Whisper API to detect the exact timing of each spoken word in a video, enabling karaoke-style subtitle highlighting during playback.

## Implementation

### New Function: `transcribeWithWordTimestamps()`

Location: `src/transcription.js`

This function processes a video/audio file and returns word-level timestamps for every spoken word.

**Key Features:**
- Uses OpenAI Whisper API with `timestamp_granularities: ["word", "segment"]`
- Returns both segment-level and word-level timing data
- Automatically handles audio conversion (same as regular transcription)
- Formats output as human-readable text file
- Groups words by their parent segments

**Parameters:**
```javascript
{
  inputPath: string,    // Path to video/audio file (required)
  outputPath: string,   // Path for output TXT file (optional)
  logger: object        // Logger object (optional, defaults to console)
}
```

**Returns:**
```javascript
{
  text: string,              // Full transcription text
  segments: Array,           // Segment-level timestamps
  words: Array,              // Word-level timestamps
  formattedOutput: string    // Formatted text output
}
```

### Word Object Structure

Each word in the `words` array contains:
```javascript
{
  word: string,    // The word text
  start: number,   // Start time in seconds
  end: number      // End time in seconds
}
```

## Testing

### Test Script: `test-word-timestamps.js`

Run the test with:
```bash
node test-word-timestamps.js
```

This will:
1. Process `test.mp4` in the root directory
2. Generate `word-timestamps-output.txt` with detailed timing data
3. Display summary in console

### Output Format

The generated TXT file contains:

```
WORD-LEVEL TIMESTAMPS
================================================================================

SEGMENT 0 [00:00:02,740 --> 00:00:04,920]
--------------------------------------------------------------------------------
Full text: תודה רבה לכם, תודה רבה

Words:
  [00:00:02,740 --> 00:00:03,260] (0.520s) "תודה"
  [00:00:03,260 --> 00:00:03,500] (0.240s) "רבה"
  [00:00:03,500 --> 00:00:03,820] (0.320s) "לכם"
  [00:00:03,820 --> 00:00:04,220] (0.400s) "תודה"
  [00:00:04,220 --> 00:00:04,920] (0.700s) "רבה"

...

================================================================================
SUMMARY
--------------------------------------------------------------------------------
Total segments: 33
Total words: 169
Video duration: 00:01:13,760
```

## Usage Examples

### Basic Usage

```javascript
import { transcribeWithWordTimestamps } from "./src/transcription.js";

const result = await transcribeWithWordTimestamps({
  inputPath: "./my-video.mp4",
  outputPath: "./word-timestamps.txt"
});

console.log(`Transcribed ${result.words.length} words`);
```

### Using Word Data for Real-time Highlighting

```javascript
const result = await transcribeWithWordTimestamps({
  inputPath: "./video.mp4"
});

// During video playback
function highlightActiveWord(currentTime) {
  const activeWord = result.words.find(
    word => currentTime >= word.start && currentTime <= word.end
  );

  if (activeWord) {
    console.log(`Currently speaking: "${activeWord.word}"`);
    // Update UI to highlight this word
  }
}
```

### Programmatic Usage (Without File Output)

```javascript
const result = await transcribeWithWordTimestamps({
  inputPath: "./video.mp4"
  // No outputPath - data only returned in memory
});

// Process word data as needed
result.words.forEach(word => {
  console.log(`${word.word}: ${word.start}s - ${word.end}s`);
});
```

## Integration with Existing System

### Current Transcription Flow

The existing `transcribeMedia()` function handles:
1. **Timed Transcription** - Whisper API with segment-level timestamps
2. **High Accuracy** (optional) - GPT model for better accuracy
3. **Correction Model** (optional) - GPT refinement

### Word-Level Timestamps

The new `transcribeWithWordTimestamps()` function:
- Works independently of the main transcription flow
- Uses the same audio preparation utilities
- Can be called alongside regular transcription
- Does NOT include high-accuracy or correction stages (single Whisper API call)

## Next Steps for UI Integration

To display active words during video playback:

1. **Store word timestamps** in the database alongside segment data
2. **Create React hook** `useActiveWord(words, currentTime)` to track current word
3. **Update VideoPlayer overlay** to highlight active word within current segment
4. **Visual design** - highlight/bold/color the currently spoken word

Example implementation:
```typescript
// In VideoPlayer component
const activeWord = useMemo(() => {
  return words.find(
    w => currentTime >= w.start && currentTime < w.end
  );
}, [words, currentTime]);

// In subtitle overlay
<Box>
  {segment.text.split(' ').map((word, i) => (
    <span
      key={i}
      style={{
        color: word === activeWord?.word ? 'yellow' : 'white',
        fontWeight: word === activeWord?.word ? 'bold' : 'normal'
      }}
    >
      {word}
    </span>
  ))}
</Box>
```

## Performance Notes

- Word-level transcription takes the same time as segment-level transcription
- No additional API calls required (single Whisper API request)
- Audio conversion is identical to regular transcription
- Output file size is moderate (~10-20KB for 1-minute video)

## Testing Results

✅ Successfully tested with `test.mp4` (1:15 duration, Hebrew audio)
✅ Detected 169 words across 33 segments
✅ Accurate timing with millisecond precision
✅ Proper Hebrew text handling
✅ Consistent results across multiple runs

## API Endpoint

### POST `/api/transcribe-words`

Transcribes a media file and returns word-level timestamps.

**Request:**
- Method: `POST`
- Content-Type: `multipart/form-data`
- Body:
  - `media` (file): Video or audio file to transcribe

**Response:**
```json
{
  "text": "Full transcription text...",
  "segments": [
    {
      "id": 0,
      "start": 2.74,
      "end": 4.92,
      "text": "תודה רבה לכם, תודה רבה"
    }
  ],
  "words": [
    {
      "word": "תודה",
      "start": 2.74,
      "end": 3.26
    },
    {
      "word": "רבה",
      "start": 3.26,
      "end": 3.5
    }
  ],
  "formattedOutput": "WORD-LEVEL TIMESTAMPS\n..."
}
```

**Example Usage:**

```bash
# Using curl
curl -X POST http://localhost:3000/api/transcribe-words \
  -F "media=@video.mp4" \
  | jq .

# Using JavaScript fetch
const formData = new FormData();
formData.append('media', videoFile);

const response = await fetch('/api/transcribe-words', {
  method: 'POST',
  body: formData
});

const result = await response.json();
console.log(`Transcribed ${result.words.length} words`);
```

## Files Modified

1. **src/transcription.js** - Added `transcribeWithWordTimestamps()` and `formatWordTimestampsAsText()`
2. **server.js** - Added `/api/transcribe-words` endpoint
3. **test-word-timestamps.js** - Created test script for direct function usage
4. **test-word-api.sh** - Created test script for API endpoint
5. **word-timestamps-output.txt** - Generated output file (example)

## Environment Variables

Uses the same environment variables as regular transcription:
- `OPENAI_API_KEY` - Required
- `OPENAI_TIMED_MODEL` - Model for transcription (default: `whisper-1`)
- `OPENAI_TEMPERATURE` - Temperature setting (default: 0)
- `OPENAI_LANGUAGE` - Language code (optional)

## Limitations

- Word timestamps may not be 100% accurate for very fast speech
- Some words may have zero duration (0.000s) if spoken extremely quickly
- Hebrew word boundaries may occasionally be imprecise
- Relies on OpenAI Whisper API accuracy

## Support

For issues or questions about word-level timestamps:
1. Check the generated TXT file for data accuracy
2. Verify OpenAI API key is valid
3. Ensure video has clear audio
4. Review console output for errors during processing
