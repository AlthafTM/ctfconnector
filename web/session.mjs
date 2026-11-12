const database = 'ctf-connector-device', store = 'session';
async function access(mode, operation) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(database, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(store, mode);
      const request = operation(transaction.objectStore(store));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('Penyimpanan koneksi dibatalkan.'));
    });
  } finally { db.close(); }
}
export const savedSession = () => access('readonly', s => s.get('device'));
export const rememberSession = connection => access('readwrite', s => s.put({ repo: connection.repo, token: connection.token, key: connection.key }, 'device'));
export const forgetSession = () => access('readwrite', s => s.delete('device'));
