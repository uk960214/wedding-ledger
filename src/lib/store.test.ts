import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { addRecord, createLedger, emptyBills } from './domain';
import { clearLedger, ConflictError, loadLedger, replaceLedger, saveLedger } from './store';

const create = () => createLedger({ title: '결혼식', date: '2026-10-10', side: 'groom' });
const input = { bills: { ...emptyBills(), 50000: 1 }, tickets: { adult: 1, child: 0 } };

beforeEach(() => clearLedger());

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
  it('revision 증가를 확인하고 충돌 시 기존 데이터를 보존한다', async () => {
    const ledger = create();
    await saveLedger(ledger);
    const updated = addRecord(ledger, input).ledger;
    await saveLedger(updated);
    await expect(saveLedger(updated)).rejects.toBeInstanceOf(ConflictError);
    await expect(saveLedger({ ...updated, revision: 3 })).rejects.toBeInstanceOf(ConflictError);
    await expect(saveLedger(create())).rejects.toBeInstanceOf(ConflictError);
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
  it('명시적인 교체는 백업 revision을 보존하고 교체 전 장부의 저장을 차단한다', async () => {
    const old = create();
    await saveLedger(old);
    const incoming = { ...create(), revision: 17 };
    await replaceLedger(incoming);
    expect(await loadLedger()).toEqual(incoming);
    await expect(saveLedger(addRecord(old, input).ledger)).rejects.toBeInstanceOf(ConflictError);
    await saveLedger(addRecord(incoming, input).ledger);
    expect((await loadLedger())!.revision).toBe(18);
    await clearLedger();
    expect(await loadLedger()).toBeNull();
  });
  it('빈 저장소에는 revision 0만 저장한다', async () => {
    await expect(saveLedger(addRecord(create(), input).ledger)).rejects.toBeInstanceOf(ConflictError);
    expect(await loadLedger()).toBeNull();
  });
  it('손상된 저장 데이터는 자동 삭제하지 않고 복원 안내 오류를 반환한다', async () => {
    await saveLedger(create());
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('wedding-gift-ledger', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('ledger', 'readwrite');
      transaction.objectStore('ledger').put({ schemaVersion: 999 }, 'current');
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
    await expect(loadLedger()).rejects.toThrow('기존 데이터는 보존');
    await expect(loadLedger()).rejects.toThrow('복원');
  });
});
