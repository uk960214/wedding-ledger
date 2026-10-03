import { ArrowDownToLine, ArrowLeft, Check, CircleHelp, ClipboardCheck, FileUp, Heart, ListChecks, ShieldCheck, Ticket, Wallet } from 'lucide-react';
import type { MouseEvent } from 'react';

const shot = (file: string, alt: string) => `${import.meta.env.BASE_URL}guide/${file}`;

function Screenshot({ file, alt, caption }: { file: string; alt: string; caption: string }) {
  return <figure className="guide-shot">
    <div className="guide-shot-frame">
      <div className="guide-shot-placeholder"><span>화면 캡처</span><small>{caption}</small></div>
      <img src={shot(file, alt)} alt={alt} onLoad={e => { e.currentTarget.previousElementSibling?.setAttribute('hidden', 'true'); }} onError={e => { e.currentTarget.hidden = true; }} />
    </div>
    <figcaption>{caption}</figcaption>
  </figure>;
}

const steps = [
  { id: 'setup', n: '01', icon: ClipboardCheck, title: '행사 장부를 확인하세요', text: '행사명과 날짜를 확인하고, 축의대를 맡은 쪽을 선택해 장부를 시작합니다. 신랑측과 신부측은 각각 별도 장부로 관리하세요.', image: ['01-setup.png', '행사명과 날짜, 신랑측·신부측을 설정하는 시작 화면', '행사 정보와 담당 측 확인'] },
  { id: 'reception', n: '02', icon: Wallet, title: '봉투와 식권을 한 건씩 기록하세요', text: '봉투를 열어 지폐를 권종별로 세고 수량을 입력한 뒤, 지급한 대인·소인 식권 수를 입력합니다. 현금이 없어도 식권만 지급했다면 식권 수만 입력해 등록하세요.', image: ['02-reception.png', '권종별 금액과 대인·소인 식권을 입력하는 접수 화면', '현금과 식권 입력'] },
  { id: 'confirm', n: '03', icon: Check, title: '접수 번호를 봉투에 적으세요', text: '접수 완료 화면의 번호를 봉투 앞면에 또렷하게 적습니다. 장부 번호와 봉투 번호가 같아야 나중에 금액 확인과 명부 정리가 쉽습니다.', image: ['03-confirm.png', '접수 완료 번호와 금액, 식권 수가 보이는 확인 화면', '완료 번호를 봉투에 기록'] },
  { id: 'history', n: '04', icon: ListChecks, title: '접수 내역을 확인하고 바로잡으세요', text: '접수 내역 탭에서 건수와 합계를 확인합니다. 잘못 입력한 항목은 해당 줄을 눌러 권종이나 식권 수를 수정하고 변경 내용을 저장하세요. 취소·삭제한 번호는 다시 사용하지 않습니다.', image: ['04-history.png', '번호별 접수 내역을 확인하고 수정하는 화면', '접수 내역 확인과 수정'] },
  { id: 'settlement', n: '05', icon: ClipboardCheck, title: '현금과 식권을 실물과 대조하세요', text: '현장 정산 탭에서 실제 지폐 수량과 장부 수량을 비교합니다. 처음 받은 식권과 남은 식권도 입력하고 차이가 있으면 사유를 메모한 뒤 정산 결과를 저장하세요.', image: ['05-settlement.png', '실계수 지폐와 식권 수량을 장부와 대조하는 정산 화면', '실물 수량 대조와 정산 저장'] },
  { id: 'backup', n: '06', icon: ShieldCheck, title: '파일로 내보내고 백업하세요', text: '정산 결과는 현장 정산 Excel로 저장하고, 장부 관리 및 백업에서 백업 파일도 저장하세요. 접수 후에는 파일이 정상적으로 내려왔는지 확인하고 담당자에게 안전하게 전달합니다.', image: ['06-backup.png', '장부 선택과 백업 파일 저장 기능 화면', '장부 선택과 백업 파일 저장'] },
];

export default function GuidePage() {
  const scrollTo = (id: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  return <div className="guide-page">
    <header className="guide-top"><a className="guide-brand" href={import.meta.env.BASE_URL}><span><Heart size={18} /></span>마음장부</a><a className="guide-back" href={import.meta.env.BASE_URL}><ArrowLeft size={16} /> 장부로 돌아가기</a></header>
    <main className="guide-main">
      <section className="guide-hero">
        <span className="guide-kicker">ON-SITE QUICK GUIDE</span>
        <h1>축의대 접수,<br /><em>이 순서대로</em> 진행하세요.</h1>
        <p>처음 맡은 분도 바로 따라 할 수 있도록 접수부터 정산과 백업까지 정리했습니다. 각 단계의 화면을 보며 진행해 주세요.</p>
        <div className="guide-hero-note"><CircleHelp size={18} /><span>접수 담당자는 <b>금액·식권 입력</b>과 <b>봉투 번호 기록</b>에 집중하고, 이름과 메모는 여유가 생긴 뒤 정리해도 됩니다.</span></div>
        <a className="guide-start" href={`${import.meta.env.BASE_URL}#/guide`} onClick={scrollTo('setup')}>빠른 안내 시작 <ArrowDownToLine size={16} /></a>
      </section>

      <section className="guide-alert"><ShieldCheck size={21} /><div><b>장부는 이 기기의 브라우저에 저장됩니다.</b><p>기기끼리 자동 동기화되지 않아요. 기기를 바꾸거나 보관할 때는 백업 파일을 저장해 전달하세요.</p></div></section>

      <nav className="guide-toc" aria-label="가이드 목차">{steps.map(s => <a key={s.id} href={`${import.meta.env.BASE_URL}#/guide`} onClick={scrollTo(s.id)}><span>{s.n}</span>{s.title}</a>)}</nav>

      <section className="guide-steps">
        {steps.map(s => <article className="guide-step" id={s.id} key={s.id}>
          <div className="guide-step-copy">
            <span className="guide-step-number">STEP {s.n}</span>
            <h2><s.icon size={21} />{s.title}</h2>
            <p>{s.text}</p>
            {s.id === 'reception' && <div className="guide-tip"><Ticket size={17} /><span>식권만 전달한 경우도 접수 건으로 등록해야 정산에 빠지지 않습니다.</span></div>}
            {s.id === 'history' && <div className="guide-tip"><FileUp size={17} /><span>이름·소속·메모는 사후 정리 탭에서 번호를 선택해 입력하고 저장할 수 있습니다.</span></div>}
          </div>
          <Screenshot file={s.image[0]} alt={s.image[1]} caption={s.image[2]} />
        </article>)}
      </section>

      <section className="guide-checklist">
        <div><span className="guide-kicker">BEFORE YOU FINISH</span><h2>마지막으로 확인해 주세요</h2></div>
        <ul><li><Check size={17} />봉투 번호와 장부 접수 번호가 일치합니다.</li><li><Check size={17} />현금 봉투 수와 식권만 지급한 건수를 확인했습니다.</li><li><Check size={17} />실계수와 차이 사유를 저장했습니다.</li><li><Check size={17} />Excel 정산표와 장부 백업 파일을 보관했습니다.</li></ul>
      </section>
      <footer className="guide-footer">마음장부 · 축의대 담당자 안내 <a href={import.meta.env.BASE_URL}>장부로 돌아가기</a></footer>
    </main>
  </div>;
}
