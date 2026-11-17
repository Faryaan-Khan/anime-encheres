import { useState, type FormEvent } from 'react';
import { useI18n } from '../i18n';
import type { StringKey } from '../i18n/strings';
import { toOnlineError } from '../online/api';
import { ONLINE_AVAILABLE } from '../online/config';
import { sendFeedback, type FeedbackCategory } from '../online/profile';
import { navigate } from '../router';

const CATEGORIES: Array<{ id: FeedbackCategory; label: StringKey }> = [
  { id: 'idea', label: 'feedback.idea' },
  { id: 'bug', label: 'feedback.bug' },
  { id: 'ratings', label: 'feedback.ratings' },
  { id: 'other', label: 'feedback.other' },
];

const MAX_LENGTH = 1000;

/** Ideas, bug reports and rating disputes from players. */
export function Feedback() {
  const { t, lang } = useI18n();
  const [category, setCategory] = useState<FeedbackCategory>('idea');
  const [message, setMessage] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<StringKey | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (message.trim().length < 5) return setError('feedback.tooShort');
    setBusy(true);
    setError(null);
    try {
      await sendFeedback(category, message.trim(), contact.trim(), lang);
      setSent(true);
      setMessage('');
    } catch (err) {
      const code = toOnlineError(err).code;
      setError(code === 'RATE_LIMITED' ? 'feedback.limit' : (`error.${code}` as StringKey));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page">
      <h1 className="display">{t('home.feedback')}</h1>
      <p>{t('feedback.intro')}</p>

      {!ONLINE_AVAILABLE ? (
        <p className="alert">{t('online.unavailable')}</p>
      ) : sent ? (
        <>
          <p className="waiting">{t('feedback.thanks')}</p>
          <button type="button" className="btn" onClick={() => setSent(false)}>
            {t('feedback.another')}
          </button>
        </>
      ) : (
        <form className="form" onSubmit={submit} noValidate>
          <fieldset className="field">
            <legend>{t('feedback.about')}</legend>
            <div className="options options--wrap">
              {CATEGORIES.map((c) => (
                <label key={c.id} className="option">
                  <input
                    type="radio"
                    name="category"
                    checked={category === c.id}
                    onChange={() => setCategory(c.id)}
                  />
                  <span>{t(c.label)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="field">
            <span>{t('feedback.message')}</span>
            <textarea
              value={message}
              rows={6}
              maxLength={MAX_LENGTH}
              onChange={(e) => setMessage(e.target.value)}
            />
            <small className="note">
              {message.length} / {MAX_LENGTH}
            </small>
          </label>
          <label className="field">
            <span>{t('feedback.contact')}</span>
            <input
              type="text"
              value={contact}
              maxLength={120}
              autoComplete="email"
              onChange={(e) => setContact(e.target.value)}
            />
          </label>
          {error && (
            <p className="alert" role="alert">
              {t(error)}
            </p>
          )}
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {t('feedback.send')}
          </button>
        </form>
      )}

      <button type="button" className="btn" onClick={() => navigate('/')}>
        {t('setup.back')}
      </button>
    </main>
  );
}
