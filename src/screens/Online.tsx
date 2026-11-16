import { useState, type FormEvent } from 'react';
import { DEFAULT_OPTIONS, SettingsFields, toSettings, type GameOptions } from '../components/SettingsFields';
import { poolFor } from '../data/characters';
import { useI18n } from '../i18n';
import type { StringKey } from '../i18n/strings';
import { createRoom, joinRoom, toOnlineError } from '../online/api';
import { ONLINE_AVAILABLE } from '../online/config';
import { navigate } from '../router';
import { readStored, writeStored } from '../storage';

/** Create a room (with its rules) or join one with a code. */
export function Online() {
  const { t } = useI18n();
  const [name, setName] = useState(() => readStored('ae.name') ?? '');
  const [code, setCode] = useState('');
  const [options, setOptions] = useState<GameOptions>(DEFAULT_OPTIONS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<StringKey | null>(null);

  if (!ONLINE_AVAILABLE) {
    return (
      <main className="page">
        <h1 className="display">{t('online.title')}</h1>
        <p className="alert">{t('online.unavailable')}</p>
        <button type="button" className="btn" onClick={() => navigate('/')}>
          {t('setup.back')}
        </button>
      </main>
    );
  }

  const cleanName = (): string | null => {
    const clean = name.trim();
    if (clean.length < 1 || clean.length > 20) {
      setError('setup.nameRequired');
      return null;
    }
    writeStored('ae.name', clean);
    return clean;
  };

  const run = async (request: () => Promise<{ code: string | null }>) => {
    setBusy(true);
    setError(null);
    try {
      const view = await request();
      navigate(`/room/${view.code}`);
    } catch (e) {
      setError(`error.${toOnlineError(e).code}` as StringKey);
    } finally {
      setBusy(false);
    }
  };

  const create = (e: FormEvent) => {
    e.preventDefault();
    const clean = cleanName();
    if (clean) void run(() => createRoom(clean, toSettings(options), poolFor(options.universe)));
  };

  const join = (e: FormEvent) => {
    e.preventDefault();
    const clean = cleanName();
    if (!clean) return;
    if (code.length !== 5) return setError('error.ROOM_NOT_FOUND');
    void run(() => joinRoom(code, clean));
  };

  return (
    <main className="page">
      <h1 className="display">{t('online.title')}</h1>

      <label className="field">
        <span>{t('setup.name')}</span>
        <input
          type="text"
          value={name}
          maxLength={20}
          autoComplete="nickname"
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      {error && (
        <p className="alert" role="alert">
          {t(error)}
        </p>
      )}

      <form className="panel" onSubmit={join} noValidate>
        <h2>{t('online.join')}</h2>
        <label className="field">
          <span>{t('online.code')}</span>
          <input
            className="code-input"
            type="text"
            value={code}
            maxLength={5}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="ABC23"
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
          />
        </label>
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {t('online.join.action')}
        </button>
      </form>

      <form className="panel" onSubmit={create} noValidate>
        <h2>{t('online.create')}</h2>
        <p className="note">{t('online.create.hint')}</p>
        <SettingsFields value={options} onChange={setOptions} />
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {t('online.create.action')}
        </button>
      </form>

      <button type="button" className="btn" onClick={() => navigate('/')}>
        {t('setup.back')}
      </button>
    </main>
  );
}
