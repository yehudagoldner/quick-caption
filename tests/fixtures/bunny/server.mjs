import { registerHooks } from 'node:module';
import { randomUUID } from 'node:crypto';
globalThis.__appEnvLoaded = true;
const remote = new Map();
// Run the real server and real storage adapter against an isolated provider.
// No deployment secrets, database connections or paid AI requests are used.
globalThis.fetch = async (url, options = {}) => {
  const parsed = new URL(url);
  if (parsed.hostname === 'video.bunnycdn.com') {
    const id = parsed.pathname.split('/')[4];
    if (options.method === 'POST') { const guid = randomUUID(); remote.set(guid, null); return Response.json({ guid }); }
    if (options.method === 'PUT') {
      const chunks = []; for await (const chunk of options.body) chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      if (bytes.toString().includes('FAIL_UPLOAD')) return new Response(null, { status: 503 });
      remote.set(id, bytes); return Response.json({ success: true });
    }
    if (options.method === 'DELETE') { remote.delete(id); return new Response(null, { status: 204 }); }
    if (remote.has(id)) return Response.json({ thumbnailFileName: 'thumbnail.jpg' });
    return new Response(null, { status: 404 });
  }
  if (parsed.hostname === 'fixture.b-cdn.net') {
    if (parsed.pathname.endsWith('/thumbnail.jpg') && remote.has(parsed.pathname.split('/')[1])) {
      const image = Buffer.from([255, 216, 255, 217]);
      return new Response(options.method === 'HEAD' ? null : image, { headers: { 'Content-Type': 'image/jpeg', 'Content-Length': String(image.length) } });
    }
    const bytes = remote.get(parsed.pathname.split('/')[1]);
    if (!bytes) return new Response(null, { status: 404 });
    const match = options.headers?.Range?.match(/^bytes=(\d+)-(\d*)$/);
    const from = match ? Number(match[1]) : 0, to = match?.[2] ? Number(match[2]) : bytes.length - 1;
    const body = bytes.subarray(from, to + 1);
    return new Response(options.method === 'HEAD' ? null : body, { status: match ? 206 : 200,
      headers: { 'Content-Length': String(body.length), 'Accept-Ranges': 'bytes', ...(match ? { 'Content-Range': `bytes ${from}-${to}/${bytes.length}` } : {}) } });
  }
  throw new Error('External network disabled in fixture');
};
registerHooks({ resolve(specifier, context, nextResolve) {
  const fixtures = { '/db.js': 'db.mjs', '/transcription.js': 'transcription.mjs' };
  for (const [suffix, file] of Object.entries(fixtures)) if (specifier.endsWith(suffix)) return { url: new URL(file, import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
await import('../../../server.js');
