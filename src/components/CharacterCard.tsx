import { useRef, type CSSProperties, type PointerEvent } from 'react';
import { getCharacter, getImage, getUniverse, initials, rarityOf, tierOf } from '../data/characters';

interface Props {
  /** Character id, or `null` for a face-down card. */
  id: string | null;
  /** `xl`: the card opened up close (Characters page). */
  size?: 'xl' | 'lg' | 'sm';
}

const canTilt = () => {
  try {
    return window.matchMedia('(hover: hover) and (prefers-reduced-motion: no-preference)').matches;
  } catch {
    return false;
  }
};

/**
 * A card drawn entirely by the app: universe colour, initials and name, in a
 * frame that shows its rarity. Higher rarities glow and carry a holographic
 * sheen that follows the pointer. If a picture exists in
 * src/assets/cards/<id>.* it fills the whole card, with the name over a fade
 * at the bottom.
 */
export function CharacterCard({ id, size = 'lg' }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  if (id === null) {
    return (
      <div className={`card card--back card--${size}`} aria-label="?">
        <span className="card__mark" aria-hidden="true">
          ?
        </span>
      </div>
    );
  }

  const character = getCharacter(id);
  const universe = getUniverse(character.universe);
  const image = getImage(id);
  const rarity = rarityOf(character);
  const style = { '--spot': universe.color } as CSSProperties;

  // Large cards lean towards the pointer, and the sheen moves with it.
  const tilt =
    size !== 'sm'
      ? {
          onPointerMove: (e: PointerEvent<HTMLDivElement>) => {
            if (!ref.current || e.pointerType !== 'mouse' || !canTilt()) return;
            const box = ref.current.getBoundingClientRect();
            const x = (e.clientX - box.left) / box.width;
            const y = (e.clientY - box.top) / box.height;
            ref.current.style.setProperty('--mx', `${x * 100}%`);
            ref.current.style.setProperty('--my', `${y * 100}%`);
            ref.current.style.setProperty('--rx', `${(0.5 - y) * 14}deg`);
            ref.current.style.setProperty('--ry', `${(x - 0.5) * 14}deg`);
          },
          onPointerLeave: () => {
            ref.current?.style.removeProperty('--rx');
            ref.current?.style.removeProperty('--ry');
          },
        }
      : {};

  return (
    <div
      ref={ref}
      key={id}
      className={`card card--face card--${size} rarity--${rarity}${image ? ' card--photo' : ''}`}
      style={style}
      data-rarity={rarity}
      {...tilt}
    >
      {universe.name && !image && <div className="card__universe">{universe.name}</div>}
      <span className="card__tier" aria-label={`${rarity}`}>
        {rarity === 'apex' ? '★' : tierOf(character)}
      </span>
      <div className="card__art">
        {image ? (
          <img src={image} alt="" draggable={false} />
        ) : (
          <span className="card__initials" aria-hidden="true">
            {initials(character.name)}
          </span>
        )}
      </div>
      <div className="card__name">
        {image && universe.name && size !== 'sm' && <span className="card__verse">{universe.name}</span>}
        {character.name}
      </div>
      <span className="card__shine" aria-hidden="true" />
    </div>
  );
}
