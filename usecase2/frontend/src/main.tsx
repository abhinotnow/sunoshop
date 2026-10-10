// Application entry point mounting the root React component and registering PWA service worker
// Exports nothing (side-effect: renders DOM)
// Depends on react, react-dom/client, ./App, ./index.css, ./sw
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { registerSW } from './sw';

// Register PWA service worker for offline shell support
registerSW();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
