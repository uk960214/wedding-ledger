import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { addRecord, createLedger, emptyBills } from './domain';
import { clearAllLedgers, ConflictError, listLedgers, loadLedger, replaceLedger, saveLedger, setActiveLedger } from './store';

const create = (title = '결혼식') => createLedger({ title, date: '2026-10-10', side: 'groom' });
const input = { bills: { ...emptyBills(), 50000: 1 }, tickets: { adult: 1, child: 0 } };

beforeEach(() => clearAllLedgers());

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase('wedding-gift-ledger');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('테스트 데이터베이스 삭제가 차단되었습니다.'));
  });
}

describe('IndexedDB 장부 저장', () => {
  it('초기 장부를 저장하고 로드한 복사본 변경은 저장소를 변경하지 않는다', async () => {
    expect(await loadLedger()).toBeNull();
    const ledger = create();
    await saveLedger(ledger);
    const loaded = (await loadLedger())!;
    expect(loaded).toEqual(ledger);
    loaded.event.title = '변경';
    expect((await loadLedger())!.event.title).toBe('결혼식');
  });

  it('v1의 current 장부를 보존하면서 v2의 active ledger로 마이그레이션한다', async () => {
    await deleteDatabase();
    const legacy = create('기존 예식');
    const oldDatabase = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('wedding-gift-ledger', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('ledger');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = oldDatabase.transaction('ledger', 'readwrite');
      transaction.objectStore('ledger').put(legacy, 'current');
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
    });
    oldDatabase.close();

    expect(await loadLedger()).toEqual(legacy);
    expect(await listLedgers()).toEqual([legacy]);
    const migratedDatabase = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('wedding-gift-ledger', 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const preserved = await new Promise<unknown>((resolve, reject) => {
      const transaction = migratedDatabase.transaction('ledger', 'readonly');
      const request = transaction.objectStore('ledger').get('current');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    migratedDatabase.close();
    expect(preserved).toEqual(legacy);
  });

  it('revision 증가를 ledger id별로 확인하고 stale save는 기존 데이터를 보존한다', async () => {
    const ledger = create();
    const other = create('다른 예식');
    await saveLedger(ledger);
    await saveLedger(other);
    const updated = addRecord(ledger, input).ledger;
    await saveLedger(updated);
    await expect(saveLedger(updated)).rejects.toBeInstanceOf(ConflictError);
    await expect(saveLedger({ ...updated, revision: 3 })).rejects.toBeInstanceOf(ConflictError);
    expect(await listLedgers()).toHaveLength(2);
    expect(await loadLedger()).toEqual(updated);
    await setActiveLedger(other.id);
    expect(await loadLedger()).toEqual(other);
    await setActiveLedger(ledger.id);
    expect(await loadLedger()).toEqual(updated);
  });

  it('서로 다른 탭의 같은 revision 동시 저장 중 하나만 성공한다', async () => {
    const ledger = create();
    await saveLedger(ledger);
    const first = addRecord(ledger, input).ledger;
    const second = addRecord(ledger, input).ledger;
    const results = await Promise.allSettled([saveLedger(first), saveLedger(second)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    const failure = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
    expect(failure.reason).toBeInstanceOf(ConflictError);
    expect((await loadLedger())!.records).toHaveLength(1);
  });

  it('백업 import는 같은 ID를 upsert하고 다른 장부를 유지하면서 active를 바꾼다', async () => {
    const original = create('기존 예식');
    const other = create('남겨둘 예식');
    await saveLedger(original);
    await saveLedger(other);
    const incoming = { ...addRecord(original, input).ledger, revision: 17, event: { ...original.event, title: '복원한 예식' } };
    await replaceLedger(incoming);
    expect(await loadLedger()).toEqual(incoming);
    expect(await listLedgers()).toHaveLength(2);
    expect((await listLedgers()).find(item => item.id === other.id)).toEqual(other);
    await saveLedger(addRecord(incoming, input).ledger);
    expect((await loadLedger())!.revision).toBe(18);
  });

  it('새 ledger는 revision 0부터 만들고 잘못된 active ID는 바꾸지 않는다', async () => {
    await expect(saveLedger(addRecord(create(), input).ledger)).rejects.toBeInstanceOf(ConflictError);
    expect(await loadLedger()).toBeNull();
    const ledger = create();
    await saveLedger(ledger);
    await expect(setActiveLedger('missing')).rejects.toThrow('찾을 수 없습니다');
    expect(await loadLedger()).toEqual(ledger);
    await expect(setActiveLedger(' ')).rejects.toThrow('ID가 올바르지 않습니다');
  });

  it('명시적인 clearLedger는 active selection만 지우고 저장된 장부는 남긴다', async () => {
    const ledger = create();
    await saveLedger(ledger);
    const { clearLedger } = await import('./store');
    await clearLedger();
    expect(await loadLedger()).toBeNull();
    expect(await listLedgers()).toEqual([ledger]);
  });

  it('손상된 저장 데이터는 자동 삭제하지 않고 복원 안내 오류를 반환한다', async () => {
    const ledger = create();
    await saveLedger(ledger);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('wedding-gift-ledger', 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('ledgers', 'readwrite');
      transaction.objectStore('ledgers').put({ ...ledger, schemaVersion: 999 });
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
    await expect(loadLedger()).rejects.toThrow('기존 데이터는 보존');
    await expect(listLedgers()).rejects.toThrow('복원');
  });
});
