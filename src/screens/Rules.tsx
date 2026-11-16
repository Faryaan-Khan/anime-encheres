import { useI18n } from '../i18n';
import type { StringKey } from '../i18n/strings';
import { navigate } from '../router';

const STEPS: StringKey[] = ['rules.1', 'rules.2', 'rules.3', 'rules.4', 'rules.5', 'rules.6', 'rules.7'];

export function Rules() {
  const { t } = useI18n();
  return (
    <main className="page">
      <h1 className="display">{t('rules.title')}</h1>
      <ol className="rules">
        {STEPS.map((key) => (
          <li key={key}>{t(key)}</li>
        ))}
      </ol>
      <button type="button" className="btn" onClick={() => navigate('/')}>
        {t('setup.back')}
      </button>
    </main>
  );
}
