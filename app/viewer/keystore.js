// Keeps a course's key in this browser when the student checks
// "Remember on this device". The key is stored as a CryptoKey that the page
// cannot export. sw.js reads the same database and store.
const DB_NAME = 'course-backup';
const STORE = 'keys';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, action) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = action(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
  });
}

export async function remember(base, key) {
  await run('readwrite', (store) => store.put(key, base));
}

export async function recall(base) {
  try {
    return (await run('readonly', (store) => store.get(base))) || null;
  } catch {
    return null;
  }
}

export async function forget(base) {
  try {
    await run('readwrite', (store) => store.delete(base));
  } catch {
    // Nothing was stored.
  }
}

// Private windows and blocked storage refuse to save; the course still opens.
export async function rememberSafely(store, base, key) {
  try {
    await store(base, key);
    return true;
  } catch {
    return false;
  }
}
