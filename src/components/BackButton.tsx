import { useI18n } from '../i18n';
import { goBack, previousPage } from '../router';
import { play } from '../sound';

/**
 * "Back" to the page before, or "Home" when the page was opened directly (a
 * shared link, a new tab) and there is nothing before it.
 */
export function BackButton({ className = 'btn', compact = false }: { className?: string; compact?: boolean }) {
  const { t } = useI18n();
  const back = previousPage() !== null;
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        play('back');
        goBack();
      }}
    >
      {compact && <span aria-hidden="true">{back ? '‹ ' : '⌂ '}</span>}
      {t(back ? 'nav.back' : 'nav.home')}
    </button>
  );
}
