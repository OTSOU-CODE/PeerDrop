'use strict';
const DB_NAME = 'PeerDropStore';
const DB_VER = 1;
let _db = null;
function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('store')) db.createObjectStore('store');
    };
    req.onsuccess = () => { _db = req.result; res(_db); };
    req.onerror = () => { _db = null; res(null); };
  });
}
export async function dbGet(key) {
  const db = await openDB();
  if (!db) return null;
  return new Promise(res => {
    const tx = db.transaction('store', 'readonly');
    const req = tx.objectStore('store').get(key);
    req.onsuccess = () => res(req.result || null);
    req.onerror = () => res(null);
  });
}
export async function dbSet(key, val) {
  const db = await openDB();
  if (!db) return;
  try { db.transaction('store', 'readwrite').objectStore('store').put(val, key); } catch (e) { console.warn('IndexedDB put failed:', e); }
}
export async function dbDel(key) {
  const db = await openDB();
  if (!db) return;
  try { db.transaction('store', 'readwrite').objectStore('store').delete(key); } catch (e) { console.warn('IndexedDB del failed:', e); }
}
