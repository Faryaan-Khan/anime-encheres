import { useState, type CSSProperties } from 'react';
import { CHARACTERS, UNIVERSES, getCharacter, getImage, getUniverse, initials } from '../data/characters';
import { useI18n } from '../i18n';

/**
 * A profile picture: a character from the game, chosen by the player, shown
 * as the face from that character's card. Characters without a picture yet
 * show their initials on the universe's colour. No uploads: nothing to store
 * or moderate beyond a character id.
 *
 * `value` is the character id, or '' for none. Numbers (or digit strings)
 * are the symbols profiles used to pick from before; they count as none.
 */
export type AvatarValue = string | number | null | undefined;

/** The character id behind an avatar value, or null for none. */
export function avatarCharacter(value: AvatarValue): string | null {
  if (typeof value !== 'string' || value === '' || /^\d+$/.test(value)) return null;
  return getCharacter(value).universe === 'unknown' ? null : value;
}

export function Avatar({ value, size = 'md' }: { value: AvatarValue; size?: 'sm' | 'md' | 'lg' }) {
  const id = avatarCharacter(value);
  if (!id) {
    return (
      <span className={`avatar avatar--${size} avatar--none`} aria-hidden="true">
        <GuestFigure />
      </span>
    );
  }
  const character = getCharacter(id);
  const image = getImage(id);
  const style = { '--spot': getUniverse(character.universe).color } as CSSProperties;
  return (
    <span className={`avatar avatar--${size} avatar--character`} style={style} aria-hidden="true">
      {image ? <img src={image} alt="" draggable={false} loading="lazy" /> : initials(character.name)}
    </span>
  );
}

/** The grey head-and-shoulders figure for a profile with no picture. */
function GuestFigure() {
  return (
    <svg viewBox="0 0 40 40" className="avatar__guest">
      <circle cx="20" cy="15" r="7.5" />
      <path d="M5.5 36c1.6-8.2 7.6-12.5 14.5-12.5S32.9 27.8 34.5 36z" />
    </svg>
  );
}

/**
 * Choosing a profile picture: a universe at a time, every character of it,
 * plus "none". Characters with a card picture come first.
 */
export function AvatarPicker({ value, onChange }: { value: AvatarValue; onChange(id: string): void }) {
  const { t } = useI18n();
  const current = avatarCharacter(value);
  const [universe, setUniverse] = useState(
    () => (current ? getCharacter(current).universe : UNIVERSES[0].id),
  );
  const choices = CHARACTERS.filter((c) => c.universe === universe)
    .slice()
    .sort((a, b) => Number(Boolean(getImage(b.id))) - Number(Boolean(getImage(a.id))) || b.power - a.power);

  return (
    <div className="avatar-picker">
      <div className="avatar-picker__tabs" role="tablist" aria-label={t('chars.filter')}>
        {UNIVERSES.map((u) => (
          <button
            key={u.id}
            type="button"
            role="tab"
            aria-selected={universe === u.id}
            className={`chip${universe === u.id ? ' chip--on' : ''}`}
            style={{ '--spot': u.color } as CSSProperties}
            onClick={() => setUniverse(u.id)}
          >
            {u.name}
          </button>
        ))}
      </div>
      <div className="avatar-picker__grid" role="radiogroup" aria-label={t('profile.avatar')}>
        <button
          type="button"
          role="radio"
          aria-checked={!current}
          className={`avatar-picker__choice${!current ? ' avatar-picker__choice--on' : ''}`}
          onClick={() => onChange('')}
        >
          <span className="avatar avatar--md avatar--clear" aria-hidden="true">
            <svg viewBox="0 0 40 40">
              <circle cx="20" cy="20" r="15" />
              <path d="M9.4 30.6 30.6 9.4" />
            </svg>
          </span>
          <span className="avatar-picker__name">{t('profile.avatar.none')}</span>
        </button>
        {choices.map((c) => (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={current === c.id}
            className={`avatar-picker__choice${current === c.id ? ' avatar-picker__choice--on' : ''}`}
            onClick={() => onChange(c.id)}
          >
            <Avatar value={c.id} />
            <span className="avatar-picker__name">{c.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
