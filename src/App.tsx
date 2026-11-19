import { Suspense, lazy } from 'react';
import { BackButton } from './components/BackButton';
import { useI18n } from './i18n';
import { navigate, useRoute } from './router';
import { setSoundOn, useSoundOn } from './sound';
import { setTheme, useTheme } from './theme';
import { Home } from './screens/Home';
import { Legal } from './screens/Legal';
import { LocalGame } from './screens/LocalGame';
import { Characters } from './screens/Characters';
import { Rules } from './screens/Rules';

// The online screens pull in the Supabase client, so they are loaded on demand:
// same-device players never download it.
const Online = lazy(() => import('./screens/Online').then((m) => ({ default: m.Online })));
const Room = lazy(() => import('./screens/Room').then((m) => ({ default: m.Room })));
const Match = lazy(() => import('./screens/Match').then((m) => ({ default: m.Match })));
const Profile = lazy(() => import('./screens/Profile').then((m) => ({ default: m.Profile })));
const Leaderboard = lazy(() => import('./screens/Leaderboard').then((m) => ({ default: m.Leaderboard })));
const Feedback = lazy(() => import('./screens/Feedback').then((m) => ({ default: m.Feedback })));
const Friends = lazy(() => import('./screens/Friends').then((m) => ({ default: m.Friends })));

export function App() {
  const route = useRoute();
  const { lang, setLang, t } = useI18n();
  const theme = useTheme();
  const sound = useSoundOn();

  return (
    <div className="app">
      <header className={`topbar${route.name === 'home' ? '' : ' topbar--inner'}`}>
        <div className="topbar__start">
          {/* Always in reach, however long the page: back to the page before, or home. */}
          {route.name !== 'home' && <BackButton className="topbar__back" compact />}
          <button type="button" className="topbar__brand" onClick={() => navigate('/')}>
            {t('app.title')}
          </button>
        </div>
        <div className="topbar__tools">
          <button
            type="button"
            className="icon-btn"
            aria-label={t(sound ? 'tools.sound.off' : 'tools.sound.on')}
            title={t(sound ? 'tools.sound.off' : 'tools.sound.on')}
            onClick={() => setSoundOn(!sound)}
          >
            {sound ? '♪' : '✕'}
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label={t(theme === 'dark' ? 'tools.theme.light' : 'tools.theme.dark')}
            title={t(theme === 'dark' ? 'tools.theme.light' : 'tools.theme.dark')}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
          <button
            type="button"
            className="link"
            lang={lang === 'fr' ? 'en' : 'fr'}
            onClick={() => setLang(lang === 'fr' ? 'en' : 'fr')}
          >
            {t('lang.switch')}
          </button>
        </div>
      </header>

      {route.name === 'home' && <Home />}
      {route.name === 'local' && <LocalGame key="local" />}
      {route.name === 'solo' && <LocalGame key="solo" solo />}
      {route.name === 'rules' && <Rules />}
      {route.name === 'characters' && <Characters />}
      <Suspense fallback={<p className="waiting">{t('online.connecting')}</p>}>
        {route.name === 'online' && <Online />}
        {route.name === 'match' && <Match />}
        {route.name === 'profile' && <Profile />}
        {route.name === 'leaderboard' && <Leaderboard />}
        {route.name === 'feedback' && <Feedback />}
        {route.name === 'friends' && <Friends />}
        {route.name === 'room' && <Room key={route.code} code={route.code} />}
      </Suspense>
      {route.name === 'legal' && <Legal />}

      <footer className="footer">
        <span>{t('footer.fan')}</span>
        <span className="footer__links">
          <button type="button" className="link" onClick={() => navigate('/legal')}>
            {t('footer.legal')}
          </button>
          <a className="link" href="/privacy.html">
            {t('footer.privacy')}
          </a>
          <a className="link" href="/terms.html">
            {t('footer.terms')}
          </a>
        </span>
      </footer>
    </div>
  );
}
