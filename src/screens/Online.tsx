import { BackButton } from '../components/BackButton';
import { useEffect, useState, type FormEvent } from 'react';
import { DEFAULT_OPTIONS, SettingsFields, toSettings, type GameOptions } from '../components/SettingsFields';
import { poolFor } from '../data/characters';
import { useI18n } from '../i18n';
import type { StringKey } from '../i18n/strings';
import { createRoom, getPublicRooms, joinRoom, toOnlineError, type PublicRoom } from '../online/api';
import { ONLINE_AVAILABLE } from '../online/config';
import type { RoomFormat } from '../game/types';
import { modeName } from '../modes';
import { navigate } from '../router';
import { readStored, writeStored } from '../storage';

/** The kinds of room a host can open. */
const FORMATS: RoomFormat[] = ['duel', 'trio', 'teams'];

/** Create a room (with its rules) or join one with a code. */
export function Online() {
  const { t } = useI18n();
  const [name, setName] = useState(() => readStored('ae.name') ?? '');
  const [code, setCode] = useState('');
  const [options, setOptions] = useState<GameOptions>(DEFAULT_OPTIONS);
  const [listed, setListed] = useState(() => readStored('ae.roomPublic') === '1');
  const [format, setFormat] = useState<RoomFormat>(() => (readStored('ae.roomFormat') as RoomFormat | null) ?? 'duel');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<StringKey | null>(null);

  if (!ONLINE_AVAILABLE) {
    return (
      <main className="page">
        <h1 className="display">{t('online.title')}</h1>
        <p className="alert">{t('online.unavailable')}</p>
        <BackButton className="btn" />
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
    writeStored('ae.roomPublic', listed ? '1' : '0');
    writeStored('ae.roomFormat', format);
    if (clean) {
      void run(() =>
        createRoom(clean, toSettings(options), poolFor(options.universe), {
          public: listed,
          verse: options.universe,
          format,
        }),
      );
    }
  };

  const join = (e: FormEvent) => {
    e.preventDefault();
    const clean = cleanName();
    if (!clean) return;
    if (code.length !== 5) return setError('error.ROOM_NOT_FOUND');
    void run(() => joinRoom(code, clean));
  };

  const joinListed = (room: PublicRoom) => {
    if (room.mine) return navigate(`/room/${room.code}`);
    const clean = cleanName();
    if (clean) void run(() => joinRoom(room.code, clean));
  };

  return (
    <main className="page">
      <h1 className="display">{t('online.title')}</h1>

      <section className="panel">
        <h2>{t('online.match')}</h2>
        <p className="note">{t('online.match.hint')}</p>
        <button type="button" className="btn btn--primary" onClick={() => navigate('/match')}>
          {t('match.find')}
        </button>
      </section>

      <h2 className="page__subhead">{t('online.rooms')}</h2>

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

      <PublicRooms busy={busy} onJoin={joinListed} />

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
        <fieldset className="field">
          <legend>{t('online.format')}</legend>
          <div className="options options--stack">
            {FORMATS.map((f) => (
              <label key={f} className="option">
                <input type="radio" name="format" checked={format === f} onChange={() => setFormat(f)} />
                <span>
                  {t(`online.format.${f}` as StringKey)}
                  <small>{t(`online.format.${f}.hint` as StringKey)}</small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <SettingsFields value={options} onChange={setOptions} />
        <fieldset className="field">
          <legend>{t('online.visibility')}</legend>
          <div className="options options--stack">
            {[false, true].map((open) => (
              <label key={String(open)} className="option">
                <input type="radio" name="visibility" checked={listed === open} onChange={() => setListed(open)} />
                <span>
                  {t(open ? 'online.visibility.public' : 'online.visibility.private')}
                  <small>{t(open ? 'online.visibility.public.hint' : 'online.visibility.private.hint')}</small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {t('online.create.action')}
        </button>
      </form>

      <BackButton className="btn" />
    </main>
  );
}

/** How often the list of public rooms is refreshed while on screen. */
const REFRESH_MS = 5000;

/** Public rooms waiting for players, refreshed every few seconds. */
function PublicRooms({ busy, onJoin }: { busy: boolean; onJoin(room: PublicRoom): void }) {
  const { t, money } = useI18n();
  const [rooms, setRooms] = useState<PublicRoom[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      if (document.hidden) return;
      getPublicRooms()
        .then((list) => {
          if (cancelled) return;
          setRooms(list);
          setFailed(false);
        })
        .catch(() => !cancelled && setFailed(true));
    };
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <section className="panel">
      <h2>{t('online.public')}</h2>
      <p className="note">{t('online.public.hint')}</p>
      {failed && !rooms ? (
        <p className="alert">{t('error.NETWORK')}</p>
      ) : !rooms ? (
        <p className="waiting">{t('online.connecting')}</p>
      ) : rooms.length === 0 ? (
        <p className="note">{t('online.public.empty')}</p>
      ) : (
        <ul className="public-rooms">
          {rooms.map((room) => (
            <li key={room.code} className="public-rooms__row">
              <span className="public-rooms__what">
                <strong>
                  {modeName(room.verse, t)}
                  {room.format && room.format !== 'duel' && ` · ${t(`online.format.${room.format}` as StringKey)}`}
                </strong>
                <small>
                  {t('online.public.rules', {
                    host: room.host,
                    budget: money(room.budget),
                    teamSize: room.teamSize,
                  })}
                </small>
              </span>
              <span className="public-rooms__seats">
                {room.players}/{room.seats}
              </span>
              <button type="button" className="btn" disabled={busy} onClick={() => onJoin(room)}>
                {t(room.mine ? 'online.public.open' : 'online.join.action')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
