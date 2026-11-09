import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, appReady } from './app/App';
import './i18n';
import './index.css';

const root = document.getElementById('root');
if (root) {
  void appReady.then(() =>
    createRoot(root).render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  );
}
