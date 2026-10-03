import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import GuidePage from './GuidePage';
import './styles.css';
import './guide.css';
const Page = window.location.hash === '#/guide' ? GuidePage : App;
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><Page /></React.StrictMode>);
