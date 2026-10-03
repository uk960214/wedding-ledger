import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import GuidePage from './GuidePage';
import './styles.css';
import './guide.css';

function Root() {
  const [showGuide, setShowGuide] = useState(() => window.location.hash.startsWith('#/guide'));
  const showingGuide = useRef(showGuide);
  const appScrollY = useRef(0);

  useEffect(() => {
    const updatePage = () => {
      const nextShowsGuide = window.location.hash.startsWith('#/guide');
      if (nextShowsGuide && !showingGuide.current) {
        appScrollY.current = window.scrollY;
        window.scrollTo(0, 0);
      } else if (!nextShowsGuide && showingGuide.current) {
        requestAnimationFrame(() => window.scrollTo(0, appScrollY.current));
      }
      showingGuide.current = nextShowsGuide;
      setShowGuide(nextShowsGuide);
    };
    window.addEventListener('hashchange', updatePage);
    return () => window.removeEventListener('hashchange', updatePage);
  }, []);

  return <>
    <div hidden={showGuide}><App /></div>
    {showGuide && <GuidePage />}
  </>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><Root /></React.StrictMode>);
