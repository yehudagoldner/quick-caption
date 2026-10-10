// Valid PCM fixture; SDK calls remain intercepted. No decoder mocking needed.
export function pcmFixture(seconds = 2, audible = [[0, seconds]]) {
  const frames = Math.round(seconds * 16000), bytes = Buffer.alloc(44 + frames * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) {
    if (audible.some(([start, end]) => i / 16000 >= start && i / 16000 < end)) bytes.writeInt16LE(Math.round(Math.sin(i * Math.PI * 2 * 517 / 16000) * 4000), 44 + i * 2);
  }
  return bytes;
}
