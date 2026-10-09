// Premiere 25.6's UXP runtime has no global TextDecoder. secureStorage returns
// UTF-8 bytes even when setItem received a string; decode without that global.
function readStoredJson(bytes) {
  const text = Array.from(bytes, byte => `%${byte.toString(16).padStart(2, '0')}`).join('');
  return JSON.parse(decodeURIComponent(text));
}
module.exports = { readStoredJson };
