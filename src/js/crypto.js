'use strict';
const SALT = new TextEncoder().encode('peerdrop-aes-gcm-v1');
let roomKey = null;
export function hasKey() { return !!roomKey; }
export async function deriveKey(roomCode) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(roomCode), 'PBKDF2', false, ['deriveKey']);
  roomKey = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: SALT, iterations: 100000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return roomKey;
}
export function clearKey() { roomKey = null; }
export async function encrypt(data) {
  if (!roomKey) return data;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, roomKey, data);
  const out = new Uint8Array(iv.byteLength + enc.byteLength);
  out.set(iv); out.set(new Uint8Array(enc), iv.length);
  return out;
}
export async function decrypt(data) {
  if (!roomKey || data.byteLength < 13) return data;
  const iv = data.slice(0, 12); const enc = data.slice(12);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, roomKey, enc);
}
export async function encryptText(text) {
  if (!roomKey) return text;
  const enc = await encrypt(new TextEncoder().encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(enc)));
}
export async function decryptText(cipher) {
  if (!roomKey || !cipher || cipher.length < 20) return cipher;
  try {
    const raw = Uint8Array.from(atob(cipher), c => c.charCodeAt(0));
    const dec = await decrypt(raw);
    return new TextDecoder().decode(dec);
  } catch { return cipher; }
}
