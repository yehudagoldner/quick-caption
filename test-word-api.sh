#!/bin/bash

echo "================================================================================"
echo "TESTING WORD-LEVEL TIMESTAMP API"
echo "================================================================================"
echo "API Endpoint: http://localhost:3000/api/transcribe-words"
echo "Test Video: test.mp4"
echo ""
echo "📤 Uploading video for word-level transcription..."
echo ""

curl -X POST http://localhost:3000/api/transcribe-words \
  -F "media=@test.mp4" \
  -H "Accept: application/json" \
  | jq '{
      text: .text[0:100] + "...",
      segmentCount: (.segments | length),
      wordCount: (.words | length),
      firstFiveWords: .words[0:5]
    }'

echo ""
echo "================================================================================"
echo "✅ API TEST COMPLETED!"
echo "================================================================================"
