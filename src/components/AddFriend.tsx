import { useState } from 'react';
import { useI18n } from '../i18n';
import type { StringKey } from '../i18n/strings';
import { addFriend, type AddFriendStatus } from '../online/profile';

/**
 * Sends a friend request to the player with this tag, then says what came of
 * it. Shown next to other players in public rooms.
 */
export function AddFriend({ tag }: { tag: string }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<AddFriendStatus | 'busy' | 'error' | null>(null);

  if (status && status !== 'busy') {
    return (
      <span className="add-friend__status">
        {t(status === 'error' ? 'error.UNKNOWN' : (`friends.status.${status}` as StringKey))}
      </span>
    );
  }
  return (
    <button
      type="button"
      className="link add-friend"
      disabled={status === 'busy'}
      onClick={() => {
        setStatus('busy');
        addFriend(tag)
          .then((r) => setStatus(r.status))
          .catch(() => setStatus('error'));
      }}
    >
      {t('room.addFriend')}
    </button>
  );
}
