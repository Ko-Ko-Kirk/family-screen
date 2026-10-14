import { useEffect, useId, useRef, useState } from 'react';
import { House, Share, Smartphone, SquarePlus, X } from 'lucide-react';

const DISMISSED_KEY = 'family-screen-home-screen-hint-dismissed';

function displayContext() {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: fullscreen)').matches
    || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  const safari = ios && /Safari/.test(navigator.userAgent)
    && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(navigator.userAgent);
  return { ios, standalone, safari };
}

export function HomeScreenGuide({ placement }: { placement: 'login' | 'library' }) {
  const [context, setContext] = useState(displayContext);
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISSED_KEY) === '1'; } catch { return false; }
  });
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousOverflow = useRef<string | null>(null);
  const titleId = useId();

  function restoreScroll() {
    if (previousOverflow.current === null) return;
    document.body.style.overflow = previousOverflow.current;
    previousOverflow.current = null;
  }

  useEffect(() => {
    const modes = [window.matchMedia('(display-mode: standalone)'), window.matchMedia('(display-mode: fullscreen)')];
    const update = () => {
      const next = displayContext();
      if (next.standalone) { dialogRef.current?.close(); restoreScroll(); }
      setContext(next);
    };
    modes.forEach((mode) => mode.addEventListener('change', update));
    return () => {
      modes.forEach((mode) => mode.removeEventListener('change', update));
      restoreScroll();
    };
  }, []);

  function openGuide() {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    previousOverflow.current = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }

  function dismissHint() {
    setDismissed(true);
    try { localStorage.setItem(DISMISSED_KEY, '1'); } catch { /* The guide also works without browser storage. */ }
  }

  if (context.standalone) return null;
  return <div className={`home-screen-guide home-screen-${placement}`}>
    {context.ios && !dismissed ? <section className="home-screen-banner" aria-label="加入主畫面提示">
      <img className="home-screen-icon" src="/apple-touch-icon.png" alt="" />
      <div className="home-screen-copy"><strong>下次，直接點圖示看影片</strong><p>把家庭片庫放到手機主畫面，開啟更方便。</p></div>
      <button className="home-screen-action" type="button" onClick={openGuide} aria-haspopup="dialog"><SquarePlus size={18} /> 加入主畫面</button>
      <button className="home-screen-dismiss" type="button" onClick={dismissHint} aria-label="收起加入主畫面提示"><X size={20} /></button>
    </section> : <button className="home-screen-link" type="button" onClick={openGuide} aria-haspopup="dialog"><Smartphone size={18} /> {context.ios ? '加入主畫面' : '在 iPhone 加入主畫面'}</button>}

    <dialog className="home-screen-dialog" ref={dialogRef} aria-labelledby={titleId} onClose={restoreScroll}
      onClick={(event) => { if (event.target === event.currentTarget) dialogRef.current?.close(); }}>
      <div className="home-screen-dialog-content">
        <div className="home-screen-dialog-heading"><div><span>只要設定一次</span><h2 id={titleId}>把家庭片庫放到主畫面</h2></div><button className="home-screen-dismiss" type="button" autoFocus onClick={() => dialogRef.current?.close()} aria-label="關閉加入主畫面引導"><X size={22} /></button></div>
        {!context.safari && <p className="home-screen-browser-note">請先在 iPhone 用 Safari 開啟這個網站，再照下面操作。</p>}
        <ol className="home-screen-steps">
          <li><span className="home-screen-step-number">1</span><div><h3><Share size={22} /> 點 Safari 的「分享」</h3><p>找這個向上箭頭的圖示；也可以先點「頁面選單」或「⋯」，再選「分享」。</p></div></li>
          <li><span className="home-screen-step-number">2</span><div><h3><SquarePlus size={22} /> 選「加入主畫面」</h3><p>在分享選單往下滑。若找不到，滑到最下方的「編輯動作」加入這個選項。</p></div></li>
          <li><span className="home-screen-step-number">3</span><div><h3><House size={22} /> 點「加入」</h3><p>如果看到「打開為網頁 App」，請保持開啟，再點「加入」。</p></div></li>
        </ol>
        <div className="home-screen-finish"><img className="home-screen-icon" src="/apple-touch-icon.png" alt="Family Screen 主畫面圖示" /><div><strong>完成後，回到手機主畫面</strong><p>點 Family Screen 圖示就能進入片庫。第一次可能需要再登入。</p></div></div>
        <button className="primary-button home-screen-done" type="button" onClick={() => dialogRef.current?.close()}>知道了</button>
      </div>
    </dialog>
  </div>;
}
