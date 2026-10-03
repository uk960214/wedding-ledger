# 축의금 접수·정산 — 구현 기준

## 확정 범위
- 신랑측·신부측은 별도 기기와 별도 장부. 서버 저장, 동기화, 병합 없음.
- 모바일 접수, 맥북 웹 사후 정리. 한국어 인터페이스.
- 50,000 / 10,000 / 5,000 / 1,000원 권종 수량과 대인·소인 식권 수 기록.
- 금액 0원 + 식권 1장 이상 허용. 모두 0이면 불가.
- 번호는 장부별 단조 증가. 취소/삭제 후 재사용 금지. 신랑-001 / 신부-001 표시.
- 봉투 있는 기록과 식권만 지급한 기록 구분. 총 접수와 현금 봉투 수 구분.
- 사후 분류: 신랑, 신부, 신랑모, 신랑부, 신부모, 신부부, 기타. 이름·소속·메모 유지.
- 식권은 최초 수령량과 잔량을 대인·소인별로 대조. 추가 수령 UI는 제외.
- 정산에서 입력하지 않은 지폐 장수와 대인·소인 식권 수량은 저장할 때 0으로 확정. 음수와 소수는 거부.
- 차이 있는 정산은 사유를 적고 마감 가능. 백업과 Excel에 실제/기록/차이/사유/상태 포함.
- 접수 변경 시 정산 재확인. 이름 등 사후 정보 변경은 정산 무효화하지 않음.
- 기존 백업 불러오기는 검증·요약·명시적 교체. 병합 없음.

## 첫 확인 지점
행사 시작, 모바일 접수, 번호 안내, 내역 확인·수정, 로컬 저장을 실제로 사용할 수 있는 UI를 사용자에게 먼저 보여주고 멈춘다. 정산/정리 화면도 준비된 범위에서 확인 가능하게 한다. 오프라인·실기기 파일 전달까지 검증하기 전 현장 사용 준비가 완료됐다고 표현하지 않는다.

## 작업 분담
- UI 에이전트: 프로젝트 구성, 앱 화면, 반응형 스타일, UI 상태 연결.
- 데이터 에이전트: src/lib/domain.ts, src/lib/store.ts, 해당 테스트.
- 인계 에이전트: src/lib/transfer.ts, 해당 테스트.
- 주 에이전트: 공유 타입 계약, 통합, 실행 환경, 브라우저 확인, 사용자 확인 지점.

## 기술 방향
React + TypeScript + Vite, 브라우저 IndexedDB. 정적 웹앱으로 개발. 외부 서비스로 접수 데이터 전송 없음. 첫 확인은 로컬 미리보기이며 공개 배포는 이후 단계.

## 모듈 계약
공유 타입은 src/types.ts. domain.ts는 emptyBills, calculateAmount, formatMoney, formatSequence, summarize, createLedger, addRecord, updateRecord, deleteRecord, updateGuest, completeSettlement를 export한다. 순수 함수는 입력 ledger를 변경하지 않고 새 ledger를 반환한다.
- createLedger({title,date,side}): Ledger
- addRecord(ledger,{bills,tickets}): {ledger: Ledger, record: ReceiptRecord}
- updateRecord(ledger,id,{bills,tickets}): Ledger
- deleteRecord(ledger,id): Ledger (soft delete)
- updateGuest(ledger,id,{name,affiliation,category,memo}): Ledger
- completeSettlement(ledger,settlement): Ledger
- summarize(ledger): Summary
- emptyBills(): Bills; calculateAmount(bills): number; formatMoney(amount): string (원 포함); formatSequence(ledger,sequence): string
store.ts: loadLedger(): Promise<Ledger|null>, saveLedger(ledger): Promise<void>, clearLedger(): Promise<void>. 저장 시 revision 충돌 검증. 새 ledger revision=0, 순수 mutation마다 +1, 기존 데이터 교체는 replaceLedger(ledger): Promise<void>. store 기본 DB명 축의금 전용. UI는 저장 성공 후 상태 갱신.
transfer.ts: serializeBackup(ledger): string, parseBackup(text): Ledger, downloadBackup(ledger): void, shareBackup(ledger): Promise<'shared'|'downloaded'|'cancelled'>, exportExcel(ledger,kind:'settlement'|'final'): Promise<void>. xlsx 라이브러리 선택 시 UI 에이전트에게 의존성 명칭 전달. 정산 차이 내역은 두 Excel 모두 포함.
