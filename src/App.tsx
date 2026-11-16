import { Suspense, lazy } from 'react';
import { useI18n } from './i18n';
import { navigate, useRoute } from './router';
import { Home } from './screens/Home';
import { LocalGame } from './screens/LocalGame';
import { Rules } from './screens/Rules';

// The online screens pull in the Supabase client, so they are loaded on demand:
// same-device players never download it.
const Online = lazy(() => import('./screens/Online').then((m) => ({ default: m.Online })));
const Room = lazy(() => import('./screens/Room').then((m) => ({ default: m.Room })));
const Match = lazy(() => import('./screens/Match').then((m) => ({ default: m.Match })));

export function App() {
  const route = useRoute();
  const { lang, setLang, t } = useI18n();

  return (
    <div className="app">
      <header className="topbar">
        <button type="button" className="topbar__brand" onClick={() => navigate('/')}>
          {t('app.title')}
        </button>
        <button
          type="button"
          className="link"
          lang={lang === 'fr' ? 'en' : 'fr'}
          onClick={() => setLang(lang === 'fr' ? 'en' : 'fr')}
        >
          {t('lang.switch')}
        </button>
      </header>

      {route.name === 'home' && <Home />}
      {route.name === 'local' && <LocalGame key="local" />}
      {route.name === 'solo' && <LocalGame key="solo" solo />}
      {route.name === 'rules' && <Rules />}
      <Suspense fallback={<p className="waiting">{t('online.connecting')}</p>}>
        {route.name === 'online' && <Online />}
        {route.name === 'match' && <Match />}
        {route.name === 'room' && <Room key={route.code} code={route.code} />}
      </Suspense>
    </div>
  );
}
