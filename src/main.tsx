import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles.css';

// Register the service worker (Workbox via vite-plugin-pwa) so the app shell is
// precached and fully functional offline after first load.
import { registerSW } from 'virtual:pwa-register';
registerSW({ immediate: true });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
