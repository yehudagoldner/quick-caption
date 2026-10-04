import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createDownloadStore } from '../src/downloadStore.js';
import { createDownloadsRouter } from '../routes/downloads.js';
import { createAdminRouter } from '../routes/admin.js';

function memoryPool() {
  const downloads = new Map(), feedback = new Map();
  const uploads = new Map([42, 43, 44].map(id => [id, { video_id: id, user_uid: 'owner', media_type: id === 44 ? 'audio' : 'video' }]));
  let unavailable = false;
  return { downloads, feedback, setUnavailable: value => { unavailable = value; },
    async execute(sql, params) {
      if (unavailable) throw new Error('Database unavailable');
      if (sql.includes('FROM media_upload_activity')) {
        const row = uploads.get(params[0]); return [row?.user_uid === params[1] ? [row] : []];
      }
      if (sql.startsWith('INSERT INTO media_downloads')) {
        const [id, user_uid, video_id, kind, format] = params;
        if (!downloads.has(id)) downloads.set(id, { user_uid, video_id, kind, format });
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('FROM media_downloads')) {
        const row = downloads.get(params[0]); return [row && (params.length === 1 || row.user_uid === params[1]) ? [row] : []];
      }
      if (sql.startsWith('INSERT INTO download_feedback')) {
        feedback.set(params[0], { rating: params[1], feedback: params[2] }); return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected test query: ${sql}`);
    },
  };
}

test('download and rating APIs authenticate ownership, validate inputs and deduplicate retries', async t => {
  const pool = memoryPool();
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { const uid = req.headers.authorization; if (['owner', 'stranger'].includes(uid)) req.identity = { uid }; next(); });
  app.use('/api/downloads', createDownloadsRouter({ store: createDownloadStore(pool) }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = (path, body, identity = 'owner') => fetch(`http://127.0.0.1:${server.address().port}/api/downloads${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(identity ? { Authorization: identity } : {}) }, body: JSON.stringify(body),
  });
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const body = { id, videoId: 42, kind: 'video', format: 'mp4', userUid: 'stranger' };
  assert.equal((await request('', body, null)).status, 401);
  assert.equal((await request('', body, 'stranger')).status, 404);
  for (const invalid of [{ id: 'invalid' }, { videoId: 0 }, { videoId: '42' }, { kind: 'other' }, { format: 'exe' }, { kind: 'subtitles', format: 'mp4' }]) {
    assert.equal((await request('', { ...body, ...invalid })).status, 400);
  }
  assert.equal((await request('', { ...body, videoId: 44 })).status, 404); // Audio is not a burned-video download.
  const first = await request('', body); assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { success: true, downloadId: id });
  assert.equal((await request('', body)).status, 200);
  assert.equal(pool.downloads.size, 1); assert.equal(pool.downloads.get(id).user_uid, 'owner');
  assert.equal((await request('', { ...body, videoId: 43 })).status, 409);
  const subtitlesId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  assert.equal((await request('', { ...body, id: subtitlesId, kind: 'subtitles', format: 'srt' })).status, 200);
  assert.equal((await request(`/${subtitlesId}/feedback`, { rating: 5 })).status, 404);
  assert.equal((await request(`/${id}/feedback`, { rating: 5 }, 'stranger')).status, 404);
  for (const rating of [0, 6, 3.5, '5', null]) assert.equal((await request(`/${id}/feedback`, { rating })).status, 400);
  assert.equal((await request(`/${id}/feedback`, { rating: 4, feedback: 'x'.repeat(2001) })).status, 400);
  assert.equal((await request(`/${id}/feedback`, { rating: 4, feedback: {} })).status, 400);
  for (let i = 0; i < 2; i++) assert.equal((await request(`/${id}/feedback`, { rating: 4, feedback: '  חוויה טובה\nתודה  ' })).status, 200);
  assert.deepEqual(pool.feedback.get(id), { rating: 4, feedback: 'חוויה טובה\nתודה' });
  assert.equal(pool.feedback.size, 1);
  pool.setUnavailable(true);
  assert.equal((await request('', { ...body, id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' })).status, 503);
  assert.equal(pool.downloads.size, 2);
});

test('admin feedback is private and paginated with validated bounds', async t => {
  const pages = [];
  const app = express();
  app.use('/api/admin', createAdminRouter({
    authenticate: (req, res, next) => {
      if (!req.headers.authorization) return res.sendStatus(401);
      req.identity = { email: req.headers.authorization, emailVerified: true }; next();
    },
    store: { isAdmin: async email => email === 'admin' },
    downloadStore: { feedback: async page => { pages.push(page); return { feedback: [], total: 0, page, pageSize: 25 }; } },
  }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = (query = '', identity = 'admin') => fetch(`http://127.0.0.1:${server.address().port}/api/admin/feedback${query}`, { headers: identity ? { Authorization: identity } : {} });
  assert.equal((await request('', null)).status, 401);
  assert.equal((await request('', 'member')).status, 403);
  for (const page of ['-1', '0.5', 'bad', '100001']) assert.equal((await request(`?page=${page}`)).status, 400);
  assert.equal((await request('?page=2')).status, 200); assert.deepEqual(pages, [2]);
});
