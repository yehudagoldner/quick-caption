import path from 'path';
import { promises as fsp } from 'fs';
import { transcribeMedia, normalizeSubtitleFormat, burnSubtitles } from './src/transcription.mjs';

const BURNABLE_FORMATS = new Set(['.srt', '.vtt']);

async function main() {
  const [inputPath, outputPathArg] = process.argv.slice(2);

  if (!inputPath) {
    console.error('Usage: node transcribe.mjs <video-or-audio-file> [output-file]');
    process.exit(1);
  }

  const resolvedInput = path.resolve(process.cwd(), inputPath);
  const { subtitlePath, format } = resolveOutputPath(resolvedInput, outputPathArg);

  const result = await transcribeMedia({
    inputPath: resolvedInput,
    format,
    logger: console,
  });

  await fsp.writeFile(subtitlePath, result.subtitle.content, 'utf8');
  console.log(`Subtitle saved to ${subtitlePath}`);

  if (BURNABLE_FORMATS.has(format)) {
    try {
      const burnedPath = await burnSubtitles(resolvedInput, subtitlePath, { logger: console });
      console.log(`Video with burned subtitles saved to ${burnedPath}`);
    } catch (error) {
      console.error('Failed to burn subtitles:', error);
    }
  } else {
    console.log('Burning skipped: chosen format is not supported for hard subtitles.');
  }

  if (result.warnings.length) {
    console.warn('Warnings:');
    for (const warning of result.warnings) {
      console.warn(`- ${warning}`);
    }
  }
}

function resolveOutputPath(resolvedInput, outputPathArg) {
  if (outputPathArg) {
    const resolvedOutput = path.resolve(process.cwd(), outputPathArg);
    const ext = path.extname(resolvedOutput);
    const format = normalizeSubtitleFormat(ext || '.srt');
    const subtitlePath = ext ? resolvedOutput : `${resolvedOutput}${format}`;
    return { subtitlePath, format };
  }

  const baseName = path.basename(resolvedInput, path.extname(resolvedInput));
  const subtitlePath = path.join(path.dirname(resolvedInput), `${baseName}.srt`);
  return { subtitlePath, format: '.srt' };
}

main().catch(error => {
  console.error('Failed to transcribe:', error);
  process.exitCode = 1;
});
