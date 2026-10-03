import { describe, expect, it } from 'vitest';
import { addRecord, calculateAmount, completeSettlement, createLedger, deleteRecord, emptyBills, summarize, updateGuest, updateRecord } from './domain';
import type { Ledger, Settlement } from '../types';

const create = () => createLedger({ title: '결혼식', date: '2026-10-10', side: 'groom' });
const input = () => ({ bills: { ...emptyBills(), 50000: 2, 10000: 1 }, tickets: { adult: 2, child: 1 } });
const matched = (ledger: Ledger): Settlement => ({ status: 'open', actualBills: summarize(ledger).bills, initialTickets: { adult: 100, child: 10 }, remainingTickets: { adult: 98, child: 9 }, reason: '', completedAt: null });

describe('접수와 정산 업무 규칙', () => {
  it('권종별 합계를 계산하고 입력과 원본 장부를 변경하지 않는다', () => {
    const original = create();
    const values = input();
    const { ledger, record } = addRecord(original, values);
    values.bills[50000] = 0;
    expect(calculateAmount(record.bills)).toBe(110000);
    expect(original.records).toEqual([]);
    expect(ledger.revision).toBe(1);
    expect(summarize(ledger)).toMatchObject({ amount: 110000, envelopeCount: 1, ticketsOnlyCount: 0, tickets: { adult: 2, child: 1 } });
  });
  it('식권만 지급 가능하지만 빈 접수는 금지한다', () => {
    const ledger = addRecord(create(), { bills: emptyBills(), tickets: { adult: 0, child: 1 } }).ledger;
    expect(summarize(ledger)).toMatchObject({ count: 1, envelopeCount: 0, ticketsOnlyCount: 1 });
    expect(() => addRecord(create(), { bills: emptyBills(), tickets: { adult: 0, child: 0 } })).toThrow();
  });
  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER])('잘못된 금액 %s를 거부한다', value => {
    expect(() => addRecord(create(), { bills: { ...emptyBills(), 50000: value }, tickets: { adult: 0, child: 0 } })).toThrow();
  });
  it('소인 식권도 정수이며 안전한 합계 범위여야 한다', () => {
    expect(() => addRecord(create(), { bills: emptyBills(), tickets: { adult: 0, child: -1 } })).toThrow();
    const ledger = addRecord(create(), { bills: emptyBills(), tickets: { adult: Number.MAX_SAFE_INTEGER, child: 0 } }).ledger;
    expect(() => addRecord(ledger, { bills: emptyBills(), tickets: { adult: 1, child: 0 } })).toThrow();
  });
  it('마지막 번호를 삭제해도 재사용하지 않고 삭제 내역은 합계에서 제외한다', () => {
    const first = addRecord(create(), input());
    const deleted = deleteRecord(first.ledger, first.record.id);
    const next = addRecord(deleted, input());
    expect(deleted.records[0].deletedAt).not.toBeNull();
    expect(summarize(deleted).amount).toBe(0);
    expect(next.record.sequence).toBe(2);
    expect(next.ledger.nextSequence).toBe(3);
    expect(() => updateRecord(deleted, first.record.id, input())).toThrow();
  });
  it('정산의 빈 칸은 0으로 저장하고 실제 차이가 있으면 사유를 요구한다', () => {
    const { ledger } = addRecord(create(), input());
    expect(completeSettlement(ledger, matched(ledger)).settlement.status).toBe('matched');
    const invalid = matched(ledger);
    invalid.actualBills[1000] = -1;
    expect(() => completeSettlement(ledger, invalid)).toThrow();
    const fractional = matched(ledger);
    fractional.initialTickets.child = 0.5;
    expect(() => completeSettlement(ledger, fractional)).toThrow();
    const discrepancy = matched(ledger);
    discrepancy.actualBills[10000] = 0;
    expect(() => completeSettlement(ledger, discrepancy)).toThrow('사유');
    discrepancy.reason = '만원권 1장 부족';
    const closed = completeSettlement(ledger, discrepancy);
    expect(closed.settlement.status).toBe('discrepancy');
    expect(closed.settlement.completedAt).not.toBeNull();
  });
  it('0장인 소인 식권과 권종별 빈 칸을 0으로 정산한다', () => {
    const { ledger } = addRecord(create(), { bills: { ...emptyBills(), 50000: 2 }, tickets: { adult: 0, child: 0 } });
    const settlement = matched(ledger);
    settlement.actualBills[10000] = null;
    settlement.actualBills[5000] = null;
    settlement.actualBills[1000] = null;
    settlement.initialTickets = { adult: null, child: null };
    settlement.remainingTickets = { adult: null, child: null };

    const closed = completeSettlement(ledger, settlement).settlement;
    expect(closed.status).toBe('matched');
    expect(closed.actualBills).toEqual({ 50000: 2, 10000: 0, 5000: 0, 1000: 0 });
    expect(closed.initialTickets).toEqual({ adult: 0, child: 0 });
    expect(closed.remainingTickets).toEqual({ adult: 0, child: 0 });
  });
  it('모든 정산 칸이 비어 있어도 실제 차이 사유가 있으면 0으로 저장한다', () => {
    const { ledger } = addRecord(create(), input());
    const settlement = matched(ledger);
    settlement.actualBills = { 50000: null, 10000: null, 5000: null, 1000: null };
    settlement.initialTickets = { adult: null, child: null };
    settlement.remainingTickets = { adult: null, child: null };
    expect(() => completeSettlement(ledger, settlement)).toThrow('사유');

    settlement.reason = '실물 계수 결과와 접수 금액 차이';
    const closed = completeSettlement(ledger, settlement).settlement;
    expect(closed.status).toBe('discrepancy');
    expect(closed.actualBills).toEqual({ 50000: 0, 10000: 0, 5000: 0, 1000: 0 });
    expect(closed.initialTickets).toEqual({ adult: 0, child: 0 });
    expect(closed.remainingTickets).toEqual({ adult: 0, child: 0 });
  });
  it('식권 차이도 마감 사유가 필요하고 잔량이 최초 수량을 초과할 수 없다', () => {
    const { ledger } = addRecord(create(), input());
    const settlement = matched(ledger);
    settlement.remainingTickets.child = 10;
    expect(() => completeSettlement(ledger, settlement)).toThrow('사유');
    settlement.reason = '소인 미수령';
    expect(completeSettlement(ledger, settlement).settlement.status).toBe('discrepancy');
    settlement.remainingTickets.child = 11;
    expect(() => completeSettlement(ledger, settlement)).toThrow('많을 수');
  });
  it('손님 정보 변경과 동일 금액 재저장은 마감을 유지하고 재무 변경은 재확인 처리한다', () => {
    const { ledger, record } = addRecord(create(), input());
    const closed = completeSettlement(ledger, matched(ledger));
    const guest = updateGuest(closed, record.id, { name: ' 홍길동 ', affiliation: '친구', category: '신랑', memo: '' });
    expect(guest.settlement.status).toBe('matched');
    expect(summarize(guest).organizedCount).toBe(1);
    expect(updateRecord(guest, record.id, input()).settlement.status).toBe('matched');
    const changed = updateRecord(guest, record.id, { ...input(), tickets: { adult: 3, child: 1 } });
    expect(changed.settlement.status).toBe('needs-review');
    expect(changed.settlement.completedAt).toBeNull();
    expect(changed.settlement.actualBills).toEqual(closed.settlement.actualBills);
    expect(deleteRecord(closed, record.id).settlement.status).toBe('needs-review');
  });
});
