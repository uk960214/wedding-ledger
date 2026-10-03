import { DENOMINATIONS, GUEST_CATEGORIES, type Bills, type Ledger, type ReceiptRecord, type Settlement, type Summary, type Tickets } from '../types';

export function emptyBills(): Bills {
  return { 50000: 0, 10000: 0, 5000: 0, 1000: 0 };
}

function count(value: number | null, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label}: 0 이상의 정수를 입력해주세요.`);
  }
  return value;
}

function safeSum(a: number, b: number): number {
  const result = a + b;
  if (!Number.isSafeInteger(result)) throw new Error('입력한 수량 또는 금액이 너무 큽니다.');
  return result;
}

function copyBills(bills: Bills): Bills {
  const result = emptyBills();
  for (const denomination of DENOMINATIONS) result[denomination] = count(bills?.[denomination], `${denomination}원권`);
  return result;
}

function copyTickets(tickets: Tickets): Tickets {
  return { adult: count(tickets?.adult, '대인 식권'), child: count(tickets?.child, '소인 식권') };
}

export function calculateAmount(bills: Bills): number {
  return DENOMINATIONS.reduce((sum, denomination) => {
    const subtotal = count(bills?.[denomination], `${denomination}원권`) * denomination;
    if (!Number.isSafeInteger(subtotal)) throw new Error('입력한 금액이 너무 큽니다.');
    return safeSum(sum, subtotal);
  }, 0);
}

export function formatMoney(amount: number): string {
  return `${amount.toLocaleString('ko-KR')}원`;
}

export function formatSequence(ledger: Ledger, sequence: number): string {
  return `${ledger.event.side === 'groom' ? '신랑' : '신부'}-${String(sequence).padStart(3, '0')}`;
}

export function summarize(ledger: Ledger): Summary {
  const summary: Summary = { count: 0, envelopeCount: 0, ticketsOnlyCount: 0, amount: 0, bills: emptyBills(), tickets: { adult: 0, child: 0 }, organizedCount: 0 };
  for (const record of ledger.records) {
    if (record.deletedAt !== null) continue;
    const amount = calculateAmount(record.bills);
    summary.count++;
    if (amount > 0) summary.envelopeCount++;
    else summary.ticketsOnlyCount++;
    summary.amount = safeSum(summary.amount, amount);
    for (const denomination of DENOMINATIONS) summary.bills[denomination] = safeSum(summary.bills[denomination], record.bills[denomination]);
    for (const kind of ['adult', 'child'] as const) summary.tickets[kind] = safeSum(summary.tickets[kind], count(record.tickets[kind], '식권'));
    if (record.name.trim()) summary.organizedCount++;
  }
  return summary;
}

export function createLedger(event: Ledger['event']): Ledger {
  if (!event.title.trim()) throw new Error('행사명을 입력해주세요.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(event.date) || !Number.isFinite(Date.parse(event.date)) || new Date(event.date).toISOString().slice(0, 10) !== event.date) throw new Error('올바른 행사 날짜를 입력해주세요.');
  if (event.side !== 'groom' && event.side !== 'bride') throw new Error('신랑측 또는 신부측을 선택해주세요.');
  const now = new Date().toISOString();
  return {
    schemaVersion: 1, id: crypto.randomUUID(), revision: 0, event: { ...event, title: event.title.trim() }, nextSequence: 1, records: [],
    settlement: { status: 'open', actualBills: { 50000: null, 10000: null, 5000: null, 1000: null }, initialTickets: { adult: null, child: null }, remainingTickets: { adult: null, child: null }, reason: '', completedAt: null },
    createdAt: now, updatedAt: now,
  };
}

function changed(ledger: Ledger, records: ReceiptRecord[], financial: boolean): Ledger {
  const result: Ledger = {
    ...ledger, revision: safeSum(ledger.revision, 1), updatedAt: new Date().toISOString(), records,
    settlement: financial && ledger.settlement.status !== 'open' ? { ...ledger.settlement, status: 'needs-review', completedAt: null } : ledger.settlement,
  };
  summarize(result);
  return result;
}

function financialInput(input: { bills: Bills; tickets: Tickets }) {
  const bills = copyBills(input.bills);
  const tickets = copyTickets(input.tickets);
  if (calculateAmount(bills) === 0 && tickets.adult === 0 && tickets.child === 0) throw new Error('축의금 또는 식권 수량을 입력해주세요.');
  return { bills, tickets };
}

function activeRecord(ledger: Ledger, id: string): ReceiptRecord {
  const record = ledger.records.find(record => record.id === id && record.deletedAt === null);
  if (!record) throw new Error('접수 내역을 찾을 수 없습니다. 이미 삭제된 내역인지 확인해주세요.');
  return record;
}

export function addRecord(ledger: Ledger, input: { bills: Bills; tickets: Tickets }): { ledger: Ledger; record: ReceiptRecord } {
  const values = financialInput(input);
  if (!Number.isSafeInteger(ledger.nextSequence) || ledger.nextSequence < 1) throw new Error('장부 번호가 올바르지 않습니다.');
  const record: ReceiptRecord = {
    id: crypto.randomUUID(), sequence: ledger.nextSequence, createdAt: new Date().toISOString(), updatedAt: null, deletedAt: null,
    ...values, name: '', affiliation: '', category: '', memo: '',
  };
  return { ledger: { ...changed(ledger, [...ledger.records, record], true), nextSequence: safeSum(ledger.nextSequence, 1) }, record };
}

export function updateRecord(ledger: Ledger, id: string, input: { bills: Bills; tickets: Tickets }): Ledger {
  const previous = activeRecord(ledger, id);
  const values = financialInput(input);
  const financial = DENOMINATIONS.some(d => previous.bills[d] !== values.bills[d]) || previous.tickets.adult !== values.tickets.adult || previous.tickets.child !== values.tickets.child;
  return changed(ledger, ledger.records.map(record => record.id === id ? { ...record, ...values, updatedAt: new Date().toISOString() } : record), financial);
}

export function deleteRecord(ledger: Ledger, id: string): Ledger {
  activeRecord(ledger, id);
  const now = new Date().toISOString();
  return changed(ledger, ledger.records.map(record => record.id === id ? { ...record, deletedAt: now, updatedAt: now } : record), true);
}

export function updateGuest(ledger: Ledger, id: string, input: Pick<ReceiptRecord, 'name' | 'affiliation' | 'category' | 'memo'>): Ledger {
  activeRecord(ledger, id);
  if (input.category !== '' && !(GUEST_CATEGORIES as readonly string[]).includes(input.category)) throw new Error('올바른 손님 분류를 선택해주세요.');
  for (const field of ['name', 'affiliation', 'memo'] as const) if (typeof input[field] !== 'string') throw new Error('손님 정보가 올바르지 않습니다.');
  const guest = { name: input.name.trim(), affiliation: input.affiliation.trim(), category: input.category, memo: input.memo.trim() };
  return changed(ledger, ledger.records.map(record => record.id === id ? { ...record, ...guest, updatedAt: new Date().toISOString() } : record), false);
}

export function completeSettlement(ledger: Ledger, input: Settlement): Ledger {
  const actualBills = emptyBills();
  for (const denomination of DENOMINATIONS) actualBills[denomination] = count(input.actualBills[denomination] ?? 0, `${denomination}원권 실제 장수`);
  calculateAmount(actualBills);
  const initialTickets = { adult: count(input.initialTickets.adult ?? 0, '처음 받은 대인 식권'), child: count(input.initialTickets.child ?? 0, '처음 받은 소인 식권') };
  const remainingTickets = { adult: count(input.remainingTickets.adult ?? 0, '남은 대인 식권'), child: count(input.remainingTickets.child ?? 0, '남은 소인 식권') };
  const summary = summarize(ledger);
  let discrepancy = DENOMINATIONS.some(d => actualBills[d] !== summary.bills[d]);
  for (const kind of ['adult', 'child'] as const) {
    if (remainingTickets[kind] > initialTickets[kind]) throw new Error('남은 식권은 처음 받은 식권보다 많을 수 없습니다.');
    discrepancy ||= initialTickets[kind] - remainingTickets[kind] !== summary.tickets[kind];
  }
  const reason = input.reason.trim();
  if (discrepancy && !reason) throw new Error('차이가 발생한 사유를 입력해주세요.');
  return {
    ...changed(ledger, ledger.records, false),
    settlement: { actualBills, initialTickets, remainingTickets, reason, status: discrepancy ? 'discrepancy' : 'matched', completedAt: new Date().toISOString() },
  };
}
