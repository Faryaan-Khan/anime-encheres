import { useEffect, useState, type FormEvent } from 'react';
import { Avatar } from '../components/Avatar';
import { useI18n } from '../i18n';
import type { StringKey } from '../i18n/strings';
import { toOnlineError } from '../online/api';
import { ONLINE_AVAILABLE } from '../online/config';
import {
  addFriend,
  answerFriend,
  dismissInvite,
  getFriends,
  removeFriend,
  type AddFriendStatus,
  type Friends as FriendsData,
  type Person,
} from '../online/profile';
import { navigate } from '../router';

const POLL_MS = 6000;

const STATUS: Record<AddFriendStatus, StringKey> = {
  sent: 'friends.status.sent',
  accepted: 'friends.status.accepted',
  already: 'friends.status.already',
  unknown: 'friends.status.unknown',
  self: 'friends.status.self',
  full: 'friends.status.full',
};

/** The player's tag, their friends, requests in both directions, and invitations to rooms. */
export function Friends() {
  const { t } = useI18n();
  const [data, setData] = useState<FriendsData | null>(null);
  const [tag, setTag] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<StringKey | null>(null);
  const [status, setStatus] = useState<AddFriendStatus | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!ONLINE_AVAILABLE) return;
    let cancelled = false;
    const load = () =>
      getFriends()
        .then((f) => !cancelled && setData(f))
        .catch((e) => !cancelled && setError(`error.${toOnlineError(e).code}` as StringKey));
    void load();
    // Requests and invitations arrive while the screen is open.
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const run = async (task: () => Promise<FriendsData>) => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      setData(await task());
    } catch (e) {
      setError(`error.${toOnlineError(e).code}` as StringKey);
    } finally {
      setBusy(false);
    }
  };

  const add = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const result = await addFriend(tag);
      setStatus(result.status);
      if (result.status === 'sent' || result.status === 'accepted') setTag('');
      return result;
    });
  };

  const copy = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.tag);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* Clipboard blocked: the tag on screen is enough. */
    }
  };

  const person = (p: Person, actions: JSX.Element) => (
    <li key={p.id} className="leaders__row">
      <Avatar index={p.avatar} size="sm" />
      <span className="leaders__name">{p.name}</span>
      <span className="people__actions">{actions}</span>
    </li>
  );

  if (!ONLINE_AVAILABLE) {
    return (
      <main className="page">
        <h1 className="display">{t('home.friends')}</h1>
        <p className="alert">{t('online.unavailable')}</p>
        <button type="button" className="btn" onClick={() => navigate('/')}>
          {t('setup.back')}
        </button>
      </main>
    );
  }

  return (
    <main className="page">
      <h1 className="display">{t('home.friends')}</h1>

      {!data && !error && <p className="waiting">{t('online.connecting')}</p>}

      {data && (
        <>
          <section className="panel">
            <h2>{t('friends.tag')}</h2>
            <p className="code">{data.tag}</p>
            <p className="note">{t('friends.tag.hint')}</p>
            <button type="button" className="btn" onClick={() => void copy()}>
              {copied ? t('friends.tag.copied') : t('friends.tag.copy')}
            </button>
          </section>

          {data.invites.length > 0 && (
            <section>
              <h2 className="page__subhead">{t('friends.invites')}</h2>
              <ul className="leaders">
                {data.invites.map((invite) => (
                  <li key={invite.code} className="leaders__row leaders__row--you">
                    <Avatar index={invite.avatar} size="sm" />
                    <span className="leaders__name">{t('friends.invite.from', { name: invite.from })}</span>
                    <span className="people__actions">
                      <button type="button" className="link" onClick={() => navigate(`/room/${invite.code}`)}>
                        {t('friends.invite.join')}
                      </button>
                      <button
                        type="button"
                        className="link"
                        disabled={busy}
                        onClick={() => void run(() => dismissInvite(invite.code))}
                      >
                        {t('friends.decline')}
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.incoming.length > 0 && (
            <section>
              <h2 className="page__subhead">{t('friends.incoming')}</h2>
              <ul className="leaders">
                {data.incoming.map((p) =>
                  person(
                    p,
                    <>
                      <button
                        type="button"
                        className="link"
                        disabled={busy}
                        onClick={() => void run(() => answerFriend(p.id, true))}
                      >
                        {t('friends.accept')}
                      </button>
                      <button
                        type="button"
                        className="link"
                        disabled={busy}
                        onClick={() => void run(() => answerFriend(p.id, false))}
                      >
                        {t('friends.decline')}
                      </button>
                    </>,
                  ),
                )}
              </ul>
            </section>
          )}

          <form className="panel" onSubmit={add} noValidate>
            <h2>{t('friends.add')}</h2>
            <label className="field">
              <span>{t('friends.add.label')}</span>
              <input
                type="text"
                value={tag}
                maxLength={12}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                onChange={(e) => setTag(e.target.value)}
              />
            </label>
            {status && <p className={status === 'sent' || status === 'accepted' ? 'note' : 'alert'}>{t(STATUS[status])}</p>}
            <button type="submit" className="btn btn--primary" disabled={busy || tag.trim().length < 7}>
              {t('friends.add.action')}
            </button>
          </form>

          <section>
            <h2 className="page__subhead">{t('friends.list', { n: data.friends.length })}</h2>
            {data.friends.length === 0 ? (
              <p className="note">{t('friends.empty')}</p>
            ) : (
              <ul className="leaders">
                {data.friends.map((p) =>
                  person(
                    p,
                    <>
                      <span className="leaders__value">{p.trophies}</span>
                      <button
                        type="button"
                        className="link"
                        disabled={busy}
                        onClick={() => void run(() => removeFriend(p.id))}
                      >
                        {t('friends.remove')}
                      </button>
                    </>,
                  ),
                )}
              </ul>
            )}
          </section>

          {data.outgoing.length > 0 && (
            <section>
              <h2 className="page__subhead">{t('friends.outgoing')}</h2>
              <ul className="leaders">
                {data.outgoing.map((p) =>
                  person(
                    p,
                    <button
                      type="button"
                      className="link"
                      disabled={busy}
                      onClick={() => void run(() => removeFriend(p.id))}
                    >
                      {t('friends.cancel')}
                    </button>,
                  ),
                )}
              </ul>
            </section>
          )}
        </>
      )}

      {error && (
        <p className="alert" role="alert">
          {t(error)}
        </p>
      )}

      <div className="form__actions">
        <button type="button" className="btn" onClick={() => navigate('/')}>
          {t('setup.back')}
        </button>
        <button type="button" className="btn" onClick={() => navigate('/leaderboard')}>
          {t('home.leaderboard')}
        </button>
      </div>
    </main>
  );
}
