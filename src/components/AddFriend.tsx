import { useState } from 'react';
import { useI18n } from '../i18n';
import type { StringKey } from '../i18n/strings';
import { addFriend, type AddFriendStatus } from '../online/profile';

/**
 * Sends a friend request, then says what came of it: to the player with this
 * tag (public room lobbies), or through `send` (the results screen, by seat).
 */
export function AddFriend({
  tag,
  send,
  label,
  look = 'link',
}: {
  /** `button`: a bold orange button with a +, in the style of the game's buttons. */
  look?: 'link' | 'button';
  tag?: string;
  send?: () => Promise<{ status: AddFriendStatus }>;
  /** Button text; "Add friend" by default. */
  label?: string;
}) {
  const { t } = useI18n();
  const [status, setStatus] = useState<AddFriendStatus | 'busy' | 'error' | null>(null);

  if (status && status !== 'busy') {
    if (look === 'button') {
      // Short, in the button's place: sent, or already friends; anything else, briefly why not.
      const done = status === 'sent' || status === 'accepted' || status === 'already';
      return (
        <span className={`add-friend__badge${done ? '' : ' add-friend__badge--off'}`} role="status">
          {done
            ? t(status === 'sent' ? 'friends.short.sent' : 'friends.short.friends')
            : t(status === 'error' ? 'error.UNKNOWN' : (`friends.status.${status}` as StringKey))}
        </span>
      );
    }
    return (
      <span className="add-friend__status">
        {t(status === 'error' ? 'error.UNKNOWN' : (`friends.status.${status}` as StringKey))}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={look === 'button' ? 'btn btn--friend' : 'link add-friend'}
      disabled={status === 'busy'}
      onClick={() => {
        setStatus('busy');
        (send ? send() : addFriend(tag ?? ''))
          .then((r) => setStatus(r.status))
          .catch(() => setStatus('error'));
      }}
    >
      {label ?? t('room.addFriend')}
      {look === 'button' && <span aria-hidden="true">+</span>}
    </button>
  );
}
