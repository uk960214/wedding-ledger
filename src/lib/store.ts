import type { Ledger } from '../types';
import { parseBackup } from './transfer';

const DATABASE = 'wedding-gift-ledger';
const STORE = 'ledger';
const KEY = 'current';

export class ConflictError extends Error {
  constructor() {
    super('다른 탭에서 장부가 변경되었습니다. 새로고침하여 최신 내역을 확인한 뒤 다시 입력해주세요.');
    this.name = 'ConflictError';
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    let settled = false;
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => {
      if (settled) { request.result.close(); return; }
      settled = true;
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => { settled = true; reject(request.error ?? new Error('장부 저장소를 열 수 없습니다.')); };
    request.onblocked = () => { settled = true; reject(new Error('다른 탭을 닫은 뒤 다시 시도해주세요.')); };
  });
}

export async function loadLedger(): Promise<Ledger | null> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readonly');
    const request = transaction.objectStore(STORE).get(KEY);
    transaction.oncomplete = () => {
      database.close();
      if (request.result === undefined) { resolve(null); return; }
      try { resolve(parseBackup(JSON.stringify(request.result))); }
      catch { reject(new Error('저장된 장부를 읽을 수 없습니다. 기존 데이터는 보존했습니다. 유효한 백업 파일로 복원해주세요.')); }
    };
    transaction.onabort = () => { database.close(); reject(transaction.error ?? new Error('장부를 불러오지 못했습니다.')); };
  });
}

async function write(ledger: Ledger | null, checkRevision: boolean): Promise<void> {
  if (ledger && (!Number.isSafeInteger(ledger.revision) || ledger.revision < 0)) throw new Error('장부 버전이 올바르지 않습니다.');
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readwrite');
    const objectStore = transaction.objectStore(STORE);
    let failure: Error | null = null;
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onabort = () => { database.close(); reject(failure ?? transaction.error ?? new Error('장부를 저장하지 못했습니다.')); };
    if (!checkRevision) {
      if (ledger) objectStore.put(ledger, KEY);
      else objectStore.delete(KEY);
      return;
    }
    const request = objectStore.get(KEY);
    request.onsuccess = () => {
      const previous: Ledger | undefined = request.result;
      if (!ledger || (previous ? ledger.id !== previous.id || ledger.revision !== previous.revision + 1 : ledger.revision !== 0)) {
        failure = new ConflictError();
        transaction.abort();
        return;
      }
      objectStore.put(ledger, KEY);
    };
  });
}

export function saveLedger(ledger: Ledger): Promise<void> { return write(ledger, true); }
export function replaceLedger(ledger: Ledger): Promise<void> { return write(ledger, false); }
export function clearLedger(): Promise<void> { return write(null, false); }
