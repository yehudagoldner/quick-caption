import test from 'node:test';
import assert from 'node:assert/strict';
import { completeJob, trackTranscriptionProgress } from '../src/transcriptionJobs.js';

function database(failSave = false) {
  let state = { credits: 50, job: { status: 'processing', result_json: null } };
  let snapshot;
  return {
    get state() { return state; },
    beginTransaction: async () => { snapshot = structuredClone(state); },
    commit: async () => {},
    rollback: async () => { state = snapshot; },
    async execute(sql, args) {
      if (sql.startsWith('SELECT status')) return [[structuredClone(state.job)]];
      if (sql.startsWith('SELECT credits')) return [[{ credits: state.credits }]];
      if (sql.startsWith('UPDATE users')) state.credits -= args[0];
      if (sql.startsWith('UPDATE transcription_jobs')) {
        if (failSave) throw new Error('Database disconnected');
        state.job = { status: 'completed', result_json: args[0] };
      }
      return [{ affectedRows: 1 }];
    },
  };
}
const options = { jobId: 'job', userUid: 'buyer', result: { videoId: 42 }, credits: 3 };
test('completion replay returns the original result and deducts only once', async () => {
  const db = database();
  assert.equal((await completeJob(db, options)).creditsRemaining, 47);
  assert.equal((await completeJob(db, options)).creditsRemaining, 47);
  assert.equal(db.state.credits, 47);
});
test('result storage failure rolls back the credit deduction', async () => {
  const db = database(true);
  await assert.rejects(completeJob(db, options));
  assert.equal(db.state.credits, 50);
  assert.equal(db.state.job.status, 'processing');
});
test('progress snapshots preserve stages in order and stop writing on completion', async () => {
  const updates = [];
  const tracker = trackTranscriptionProgress({ update: async stages => updates.push(stages), emit: () => {}, heartbeatMs: 10 });
  tracker.emit('upload', 'done');
  tracker.emit('timed-transcription', 'start');
  tracker.emit('timed-transcription', 'done');
  tracker.emit('correction', 'start');
  await tracker.stop();
  assert.deepEqual(updates.at(-1).map(s => [s.stage, s.status]), [['upload', 'done'], ['timed-transcription', 'done'], ['correction', 'start']]);
  const count = updates.length;
  tracker.emit('complete', 'done');
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(updates.length, count);
});
