import type { Ledger } from '../types';
import { parseBackup } from './transfer';

const DATABASE = 'wedding-gift-ledger';
const DATABASE_VERSION = 2;
const LEGACY_STORE = 'ledger';
const LEDGERS_STORE = 'ledgers';
const META_STORE = 'meta';
const LEGACY_KEY = 'current';
const ACTIVE_KEY = 'activeId';

export class ConflictError extends Error {
  constructor() {
    super('다른 탭에서 장부가 변경되었습니다. 새로고침하여 최신 내역을 확인한 뒤 다시 입력해주세요.');
    this.name = 'ConflictError';
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, DATABASE_VERSION);
    let settled = false;
    request.onupgradeneeded = event => {
      const database = request.result;
      const transaction = request.transaction!;
      if (!database.objectStoreNames.contains(LEGACY_STORE)) database.createObjectStore(LEGACY_STORE);
      if (!database.objectStoreNames.contains(LEDGERS_STORE)) database.createObjectStore(LEDGERS_STORE, { keyPath: 'id' });
      if (!database.objectStoreNames.contains(META_STORE)) database.createObjectStore(META_STORE);

      // Preserve the v1 value verbatim. Validation happens when the ledger is read,
      // so malformed data is never silently discarded during the schema upgrade.
      if (event.oldVersion < 2) {
        const legacy = transaction.objectStore(LEGACY_STORE).get(LEGACY_KEY);
        legacy.onsuccess = () => {
          const value: unknown = legacy.result;
          if (value && typeof value === 'object' && !Array.isArray(value) && typeof (value as { id?: unknown }).id === 'string') {
            const id = (value as { id: string }).id;
            transaction.objectStore(LEDGERS_STORE).put(value);
            transaction.objectStore(META_STORE).put(id, ACTIVE_KEY);
          }
        };
      }
    };
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

function validId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= 200 && id.trim() === id && !/[\u0000-\u001f\u007f]/.test(id);
}

function validated(value: unknown): Ledger {
  if (!value || typeof value !== 'object' || !validId((value as { id?: unknown }).id)) {
    throw new Error('저장된 장부를 읽을 수 없습니다. 기존 데이터는 보존했습니다. 유효한 백업 파일로 복원해주세요.');
  }
  try { return parseBackup(JSON.stringify(value)); }
  catch { throw new Error('저장된 장부를 읽을 수 없습니다. 기존 데이터는 보존했습니다. 유효한 백업 파일로 복원해주세요.'); }
}

function readFailure(error?: DOMException | null): Error {
  return error ?? new Error('장부를 불러오지 못했습니다.');
}

export async function listLedgers(): Promise<Ledger[]> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(LEDGERS_STORE, 'readonly');
    const request = transaction.objectStore(LEDGERS_STORE).getAll();
    transaction.oncomplete = () => {
      database.close();
      try {
        const ledgers = (request.result as unknown[]).map(validated);
        ledgers.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        resolve(ledgers);
      } catch (error) { reject(error); }
    };
    transaction.onabort = () => { database.close(); reject(readFailure(transaction.error)); };
  });
}

export async function loadLedger(): Promise<Ledger | null> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([LEDGERS_STORE, META_STORE], 'readonly');
    const activeRequest = transaction.objectStore(META_STORE).get(ACTIVE_KEY);
    let ledgerRequest: IDBRequest | undefined;
    activeRequest.onsuccess = () => {
      const activeId: unknown = activeRequest.result;
      if (activeId !== undefined && validId(activeId)) ledgerRequest = transaction.objectStore(LEDGERS_STORE).get(activeId);
    };
    transaction.oncomplete = () => {
      database.close();
      if (!ledgerRequest) { resolve(null); return; }
      if (ledgerRequest.result === undefined) { resolve(null); return; }
      try { resolve(validated(ledgerRequest.result)); }
      catch (error) { reject(error); }
    };
    transaction.onabort = () => { database.close(); reject(readFailure(transaction.error)); };
  });
}

export async function setActiveLedger(id: string): Promise<Ledger> {
  if (!validId(id)) throw new Error('장부 ID가 올바르지 않습니다.');
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([LEDGERS_STORE, META_STORE], 'readwrite');
    const request = transaction.objectStore(LEDGERS_STORE).get(id);
    let result: Ledger | undefined;
    let failure: Error | null = null;
    request.onsuccess = () => {
      try {
        if (request.result === undefined) throw new Error('선택한 장부를 찾을 수 없습니다.');
        result = validated(request.result);
        transaction.objectStore(META_STORE).put(id, ACTIVE_KEY);
      } catch (error) {
        failure = error as Error;
        transaction.abort();
      }
    };
    transaction.oncomplete = () => { database.close(); resolve(result!); };
    transaction.onabort = () => { database.close(); reject(failure ?? readFailure(transaction.error)); };
  });
}

async function writeLedger(ledger: Ledger, checkRevision: boolean, activate: boolean): Promise<void> {
  if (!validId(ledger.id)) throw new Error('장부 ID가 올바르지 않습니다.');
  const checked = validated(ledger);
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([LEDGERS_STORE, META_STORE], 'readwrite');
    const objectStore = transaction.objectStore(LEDGERS_STORE);
    let failure: Error | null = null;
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onabort = () => { database.close(); reject(failure ?? transaction.error ?? new Error('장부를 저장하지 못했습니다.')); };

    const commit = () => {
      objectStore.put(checked);
      if (activate) transaction.objectStore(META_STORE).put(checked.id, ACTIVE_KEY);
    };
    if (!checkRevision) { commit(); return; }

    const request = objectStore.get(checked.id);
    request.onsuccess = () => {
      const previous: unknown = request.result;
      let previousRevision: number | undefined;
      try {
        if (previous !== undefined) previousRevision = validated(previous).revision;
      } catch (error) {
        failure = error as Error;
        transaction.abort();
        return;
      }
      const matches = previous === undefined ? checked.revision === 0 : checked.revision === previousRevision! + 1;
      if (!matches) {
        failure = new ConflictError();
        transaction.abort();
        return;
      }
      commit();
      if (previous === undefined) {
        const active = transaction.objectStore(META_STORE).get(ACTIVE_KEY);
        active.onsuccess = () => {
          if (active.result === undefined) transaction.objectStore(META_STORE).put(checked.id, ACTIVE_KEY);
        };
      }
    };
  });
}

export function saveLedger(ledger: Ledger): Promise<void> { return writeLedger(ledger, true, false); }
export function replaceLedger(ledger: Ledger): Promise<void> { return writeLedger(ledger, false, true); }

/** Clear only the active selection, retaining every ledger in IndexedDB. */
export async function clearLedger(): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(META_STORE, 'readwrite');
    transaction.objectStore(META_STORE).delete(ACTIVE_KEY);
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onabort = () => { database.close(); reject(transaction.error ?? new Error('장부를 초기화하지 못했습니다.')); };
  });
}

/** Test helper for isolated cases; application flows should clear only the active selection. */
export async function clearAllLedgers(): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([LEDGERS_STORE, META_STORE], 'readwrite');
    transaction.objectStore(LEDGERS_STORE).clear();
    transaction.objectStore(META_STORE).clear();
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onabort = () => { database.close(); reject(transaction.error ?? new Error('장부를 초기화하지 못했습니다.')); };
  });
}
