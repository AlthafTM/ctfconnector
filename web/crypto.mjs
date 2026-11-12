const enc = new TextEncoder();
export function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
}
export function unb64(text) { return Uint8Array.from(atob(text), c => c.charCodeAt(0)); }
export async function keyFromSecret(secret) {
  if (!/^[a-zA-Z0-9_-]{43}$/.test(secret)) throw new Error('Pairing key harus 43 karakter dari setup agent.');
  const bytes = unb64(secret.replaceAll('-', '+').replaceAll('_', '/') + '=');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function seal(key, value, context) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(context) }, key, enc.encode(JSON.stringify(value)));
  return { v: 1, iv: b64(iv), data: b64(new Uint8Array(data)) };
}
export async function open(key, value, context) {
  if (value?.v !== 1 || typeof value.data !== 'string' || value.data.length > 8_000_000) throw new Error('Envelope tidak valid.');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(value.iv), additionalData: enc.encode(context) }, key, unb64(value.data));
  return JSON.parse(new TextDecoder().decode(plain));
}
