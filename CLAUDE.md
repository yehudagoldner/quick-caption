# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Hebrew subtitle generation application that transcribes audio/video using OpenAI's Whisper API, then refines the transcription with GPT models. The app supports subtitle editing, preview with video playback, and burning subtitles directly onto videos.

## Architecture

### Frontend (React + TypeScript + Vite)
- **Entry**: `src/client/main.tsx`
- **Root Component**: `src/client/App.tsx` - Material-UI themed RTL interface
- **Workflow Hook**: `src/client/hooks/useTranscriptionWorkflow.ts` - Central state management for the entire transcription flow (upload → transcribe → preview → edit → burn)
- **Auth**: `src/client/contexts/AuthContext.tsx` - Firebase authentication with automatic user sync to MySQL
- **Components**: `src/client/components/` - MUI-based RTL components for workflow steps
- **Real-time Updates**: Socket.io client connects to backend for live transcription progress

### Backend (Express + Node.js)
- **Entry**: `server.js` - Main Express server with Socket.io for real-time stage updates
- **Transcription**: `src/transcription.js` - Multi-stage OpenAI transcription pipeline
- **Database**: `db.js` - MySQL connection pool with user/video schema management
- **Routes**: `routes/burnSubtitles.js` - FFmpeg-based subtitle burning endpoint

### Transcription Pipeline (3-stage refinement)
1. **Timed Transcription** (`whisper-1` or similar): Generates segments with timestamps
2. **High Accuracy** (`gpt-4o-transcribe` or similar): Optionally re-transcribes for better accuracy
3. **Correction Model** (`gpt-5` or similar): Uses GPT to refine text while preserving timestamps

Configure models via environment variables:
- `OPENAI_TIMED_MODEL` (default: `whisper-1`)
- `OPENAI_HIGH_ACCURACY_MODEL` (default: `gpt-4o-transcribe`, set to `none`/`skip`/`false` to disable)
- `OPENAI_CORRECTION_MODEL` (default: `gpt-5`)

### Database Schema (MySQL)
- **users**: Firebase auth users synced from frontend
- **videos**: Stores video metadata and subtitle segments as JSON
- Schema auto-created on server start via `ensureSchema()` in `db.js`

### Stage System
Frontend displays live progress through stages defined in `useTranscriptionWorkflow.ts`:
- `upload` → `timed-transcription` → `high-accuracy` → `correction` → `complete`
- Backend emits Socket.io events (`transcribe-status`) with stage updates
- Each stage can be: idle, active, done, skipped, error

## Common Development Commands

```bash
# Start both frontend and backend concurrently
npm start

# Start development server (Vite frontend only)
npm run dev

# Start backend server (Express with nodemon auto-reload)
npm run server

# Build for production (TypeScript compilation + Vite build)
npm run build

# Preview production build
npm run preview
```

## Environment Variables

Required in `.env`:
- `OPENAI_API_KEY` - OpenAI API key for transcription
- `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` - MySQL connection
- `PORT` (optional, default: 3000)
- `CORS_ORIGIN` (optional, comma-separated allowed origins)

Frontend environment (optional):
- `VITE_API_BASE_URL` - Backend API URL (if different from Vite proxy)

## Key Technical Notes

- **RTL Support**: App uses MUI `direction: "rtl"` theme and Hebrew UI text
- **Video Preview**: Client creates local object URLs for uploaded media preview
- **FFmpeg Required**: Backend requires `ffmpeg` in PATH for audio conversion and subtitle burning
- **Audio Conversion**: Videos/large audio files are converted to mono 16kHz MP3 for OpenAI compliance (25MB limit)
- **TypeScript**: Frontend only (`tsconfig.json` includes `src/client`). Backend is plain JS with ES modules.
- **Vite Proxy**: Dev server proxies `/api`, `/health`, `/socket.io` to backend (port 3000)
- **Subtitle Formats**: Supports `.srt`, `.vtt`, `.txt` output formats
- **Segment Editing**: Users can edit subtitle segments in the timeline UI, saved back to database

## Important Patterns

- **Stage Notifications**: Use `onStage(stage, status, message)` callback in transcription functions to emit progress
- **Socket.io**: Backend emits to specific socket ID (`io.to(socketId).emit(...)`) received from client in request body
- **File Cleanup**: All temp files (uploads, converted audio, burned videos) are cleaned up in `finally` blocks or response callbacks
- **Error Handling**: Transcription errors in secondary stages (high-accuracy, correction) are logged as warnings but don't fail the request