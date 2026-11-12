const DATABASE_NAME = 'bishun-pinyin-recorder';
const STORE_NAME = 'recordings';

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('浏览器存储不可用'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('录音保存失败'));
    transaction.onabort = () => reject(transaction.error || new Error('录音保存已中止'));
  });
}

export async function openRecordingStore() {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'reading' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('无法打开录音存储'));
    request.onblocked = () => reject(new Error('请关闭其他拼音录音页面后重试'));
  });
  database.onversionchange = () => database.close();

  async function transaction(mode, operation) {
    const tx = database.transaction(STORE_NAME, mode);
    const [result] = await Promise.all([
      operation(tx.objectStore(STORE_NAME)),
      transactionDone(tx),
    ]);
    return result;
  }

  return {
    get: reading => transaction('readonly', store => requestResult(store.get(reading))),
    keys: () => transaction('readonly', store => requestResult(store.getAllKeys())),
    all: () => transaction('readonly', store => requestResult(store.getAll())),
    put: record => transaction('readwrite', store => requestResult(store.put(record))),
    close: () => database.close(),
  };
}
