import type { VideoCrop } from '../../videoVersions.js';
import { cropRectangle } from '../../videoVersions.js';
import wasmLoaderPath from '../../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.js?url';
import wasmBinaryPath from '../../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm?url';

function waitFor(video: HTMLVideoElement, event: string, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); video.removeEventListener(event, done); video.removeEventListener('error', fail); signal.removeEventListener('abort', fail); };
    const done = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error('לא ניתן לנתח את הסרטון. אפשר לנסות שוב או לגרור את המסגרת.')); };
    const timer = window.setTimeout(fail, 20000);
    video.addEventListener(event, done, { once: true }); video.addEventListener('error', fail, { once: true }); signal.addEventListener('abort', fail, { once: true });
    if (signal.aborted) fail();
  });
}

// Analyze a separate decoder so preview playback and the user's playhead never move.
// All video pixels stay in the browser; model/wasm assets are served by this app.
export async function autoReframe(mediaUrl: string, crop: VideoCrop, signal: AbortSignal, progress: (value: number) => void): Promise<VideoCrop> {
  const { FaceDetector } = await import('@mediapipe/tasks-vision');
  if (signal.aborted) throw new Error('Cancelled');
  const detector = await FaceDetector.createFromOptions({ wasmLoaderPath, wasmBinaryPath }, {
    baseOptions: { modelAssetPath: `${import.meta.env.BASE_URL}models/blaze_face_short_range.tflite` }, runningMode: 'IMAGE', minDetectionConfidence: .6,
  });
  const video = document.createElement('video'); video.crossOrigin = 'anonymous'; video.muted = true; video.preload = 'auto';
  try {
    const ready = waitFor(video, 'loadeddata', signal); video.src = mediaUrl; await ready;
    if (!Number.isFinite(video.duration) || video.duration <= 0 || video.duration > 86400) throw new Error('משך הסרטון אינו מתאים לניתוח אוטומטי.');
    const source = { width: video.videoWidth, height: video.videoHeight }, rectangle = cropRectangle(source, crop);
    const canvas = document.createElement('canvas'); canvas.width = Math.min(640, source.width); canvas.height = Math.round(canvas.width * source.height / source.width);
    const context = canvas.getContext('2d')!;
    const points: NonNullable<VideoCrop['points']> = [];
    let center = .5, found = 0;
    const count = Math.min(600, Math.max(2, Math.ceil(video.duration * 2)));
    for (let index = 0; index < count; index++) {
      if (signal.aborted) throw new Error('Cancelled');
      const time = index * (video.duration - Math.min(.05, video.duration / 2)) / (count - 1);
      if (Math.abs(video.currentTime - time) > .001) { const seek = waitFor(video, 'seeked', signal); video.currentTime = time; await seek; }
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const faces = detector.detect(canvas).detections.filter(face => face.boundingBox);
      // Prefer a large face near the previous subject, reducing needless switches.
      const score = (face: typeof faces[number]) => { const b = face.boundingBox!; return b.width * b.height / (1 + 6 * Math.abs((b.originX + b.width / 2) / canvas.width - center)); };
      faces.sort((a, b) => score(b) - score(a));
      if (faces[0]) {
        const b = faces[0].boundingBox!, next = (b.originX + b.width / 2) / canvas.width;
        center = found ? center + (next - center) * .65 : next; found++;
      }
      const x = source.width === rectangle.width ? .5 : Math.max(0, Math.min(1, (center * source.width - rectangle.width / 2) / (source.width - rectangle.width)));
      points.push({ time: Number(time.toFixed(4)), x: Number(x.toFixed(4)), y: .5 });
      progress(Math.round((index + 1) / count * 100));
      await new Promise(resolve => window.setTimeout(resolve, 0));
    }
    if (!found) throw new Error('לא זוהו פנים למעקב. אפשר לבחור את האזור ידנית.');
    return { ...crop, points };
  } finally { detector.close(); video.removeAttribute('src'); video.load(); }
}
