// Keep the selection's already-rendered audio with the plugin's persistent data.
// Native graphics refer to this file after the temporary upload file is removed.
function completeWave(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.byteLength <= 44) return false;
  const tag = offset => String.fromCharCode(...bytes.slice(offset, offset + 4));
  return tag(0) === 'RIFF' && tag(8) === 'WAVE' && new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(4,true) + 8 === bytes.byteLength;
}
async function retainReferenceAudio(uxp, file, id, snapshot) {
  if (!file || !/^[a-zA-Z0-9:_-]{1,160}$/.test(id || '')) throw new Error('האודיו לעריכת ההדגשות אינו זמין');
  const fs = uxp.storage.localFileSystem;
  const root = await fs.getDataFolder();
  let folder;
  try { folder = await root.getEntry('reference-audio'); }
  catch { folder = await root.createFolder('reference-audio'); }
  const name = `selection-${encodeURIComponent(id)}.wav`;
  // Job IDs are unique; never overwrite a file already referenced by a project.
  let saved;
  try { saved = await folder.getEntry(name); }
  catch {
    const bytes = await file.read({ format: uxp.storage.formats.binary });
    if (!completeWave(bytes)) throw new Error('קובץ האודיו לעריכה אינו שלם');
    saved = await folder.createFile(name, { overwrite: false });
    try { await saved.write(bytes, { format: uxp.storage.formats.binary }); }
    catch (error) { await saved.delete(); throw error; }
  }
  if (!completeWave(await saved.read({format:uxp.storage.formats.binary}))) throw new Error('קובץ האודיו לעריכה אינו שלם');
  return { sourcePath: saved.nativePath, token: await fs.createPersistentToken(saved), durationSeconds: snapshot.duration, ranges: snapshot.ranges };
}
async function referenceAudioExists(uxp, reference) {
  if (!reference?.token) return false;
  try {
    const entry = await uxp.storage.localFileSystem.getEntryForPersistentToken(reference.token);
    return entry.nativePath === reference.sourcePath && completeWave(await entry.read({format:uxp.storage.formats.binary}));
  } catch { return false; }
}
module.exports = { retainReferenceAudio, referenceAudioExists };
