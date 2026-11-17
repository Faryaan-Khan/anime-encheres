import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { I18nProvider } from './i18n';
import { GOOGLE_SIGN_IN } from './online/config';
import { initSound } from './sound';
import { initTheme } from './theme';
import '@fontsource/dela-gothic-one/latin-400.css';
import '@fontsource/zen-kaku-gothic-new/latin-400.css';
import '@fontsource/zen-kaku-gothic-new/latin-500.css';
import '@fontsource/zen-kaku-gothic-new/latin-700.css';
import '@fontsource/zen-kaku-gothic-new/latin-900.css';
import './styles.css';

initTheme();
initSound();

// Google sends the player back to the site root with a one-time code: show the profile, which completes it.
const returning = new URLSearchParams(window.location.search);
if (GOOGLE_SIGN_IN && (returning.has('code') || returning.has('error')) && !window.location.hash) {
  window.location.hash = '#/profile';
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
);
