import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../i18n';
import '../index.css';
import { ShowcaseApp } from './ShowcaseApp';

/** E2E-only page of the shared UI components (built by `vite build --mode e2e` only). */
const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <ShowcaseApp />
    </StrictMode>,
  );
}
