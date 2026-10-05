export * from '../security/db.mjs';
export { default } from '../security/db.mjs';
const videos = new Map();
let nextId = 1;
export const getUserCredits = async () => 50;
export const deductCredits = async () => ({ success: true, newBalance: 50 });
export const saveVideo = async ({ userUid, originalFilename, storedPath, status = 'completed', mimeType, subtitleJson, wordsJson }) => {
  const id = nextId++;
  videos.set(id, { id, user_uid: userUid, original_filename: originalFilename, stored_path: storedPath, status, mime_type: mimeType,
    subtitle_json: subtitleJson, words_json: wordsJson });
  return id;
};
export const getVideoById = async ({ videoId, userUid }) => videos.get(videoId)?.user_uid === userUid ? structuredClone(videos.get(videoId)) : null;
export const getUserVideos = async ({ userUid }) => [...videos.values()].filter(video => video.user_uid === userUid).map(video => structuredClone(video));
