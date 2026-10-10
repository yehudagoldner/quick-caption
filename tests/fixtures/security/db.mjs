export const fixture = { uid: 'qa-owner-fixture', video: { id: 424242, user_uid: 'qa-owner-fixture', original_filename: 'private-QA-demo.mp4', subtitle_json: [{ id: 1, start: 0, end: 2, text: 'תוכן פרטי פיקטיבי' }], words_json: [], stored_path: process.env.TEST_MEDIA_FILE, status: 'completed', format: '.srt' }, credits: 50 };
// Match the connection queries introduced with browser-login revocation. The
// security fixture stays isolated from deployment configuration and real MySQL.
const logins = new Map();
const execute = async (sql, params = []) => {
  if (sql.startsWith('SELECT revoked_before')) return [[{ revoked_before: 0 }], []];
  if (sql.startsWith('INSERT IGNORE INTO browser_connections')) {
    const [id, uid, authTime] = params;
    if (!logins.has(`${uid}:${authTime}`)) logins.set(`${uid}:${authTime}`, { id, uid, authTime, revoked_at: null });
  }
  if (sql.startsWith('SELECT id, revoked_at FROM browser_connections')) {
    const login = logins.get(`${params[0]}:${params[1]}`);
    return [login ? [login] : [], []];
  }
  if (sql.startsWith('SELECT b.id FROM browser_connections')) {
    return [[...logins.values()].filter(login => login.id === params[0] && login.uid === params[1] && !login.revoked_at), []];
  }
  return [[], []];
};
export default { execute, query: async () => [[], []], getConnection: async () => ({ execute,
  beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {} }) };
export const ensureSchema = async () => {};
export const ensureDevDummyUser = async () => {};
export const getUserCredits = async uid => uid === fixture.uid ? fixture.credits : null;
export const getVideoById = async ({ videoId, userUid }) => +videoId === fixture.video.id && userUid === fixture.uid ? structuredClone(fixture.video) : null;
export const getUserVideos = async ({ userUid, limit = 50, offset = 0 }) => userUid === fixture.uid ? [structuredClone(fixture.video)].slice(offset, offset+limit) : [];
export const updateVideoSubtitles = async ({ videoId, userUid, subtitleJson, wordsJson }) => {
  if (+videoId !== fixture.video.id || userUid !== fixture.uid) return { affectedRows: 0 };
  fixture.video.subtitle_json = JSON.parse(subtitleJson); if (wordsJson) fixture.video.words_json = JSON.parse(wordsJson);
  return { affectedRows: 1 };
};
export const upsertUser = async () => {};
export const saveVideo = async () => 424242;
export const deductCredits = async () => {};
export const createTranscriptionJob = async () => {};
export const getTranscriptionJob = async () => null;
export const finishTranscriptionJob = async () => {};
export const updateTranscriptionProgress = async () => {};
export const completeTranscriptionJob = async () => {};
export const creditCapturedOrder = async () => {};
export const getRecordedPayment = async () => null;
