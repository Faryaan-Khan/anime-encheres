import { useEffect, useRef, type CSSProperties, type PointerEvent } from 'react';
import { getCharacter, getImage, getUniverse, initials, rarityOf, tierOf } from '../data/characters';
import { startShimmer, type Shimmer } from '../sound';

interface Props {
  /** Character id, or `null` for a face-down card. */
  id: string | null;
  /** `xl`: the card opened up close (Characters page). */
  size?: 'xl' | 'lg' | 'sm';
}

const matches = (query: string) => {
  try {
    return window.matchMedia(query).matches;
  } catch {
    return false;
  }
};

/**
 * Whether this pointer may tilt the card: a mouse on a device that hovers,
 * or, on a card opened up close, a finger or a pen. Never when the player
 * asked for less motion.
 */
const canTilt = (pointerType: string, closeUp: boolean) =>
  matches('(prefers-reduced-motion: no-preference)') &&
  (pointerType === 'mouse' ? matches('(hover: hover)') : closeUp);

/**
 * A card drawn entirely by the app: universe colour, initials and name, in a
 * frame that shows its rarity. Higher rarities glow and carry a holographic
 * sheen that follows the pointer. If a picture exists in
 * src/assets/cards/<id>.* it fills the whole card, with the name over a fade
 * at the bottom.
 */
export function CharacterCard({ id, size = 'lg' }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // The sound that follows the pointer across a card held up close.
  const shimmer = useRef<Shimmer | null>(null);
  const lastPoint = useRef<{ x: number; y: number; t: number } | null>(null);
  useEffect(() => () => shimmer.current?.stop(), []);

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

  // Large cards lean towards the pointer, and the sheen moves with it. Up
  // close they also follow a finger dragged across them.
  const closeUp = size === 'xl';
  // A, S and a universe's number one sing as the pointer moves over them.
  const shimmerLevel =
    closeUp && rarity === 'apex' ? 'apex' : closeUp && tierOf(character) === 'S' ? 'S' : closeUp && tierOf(character) === 'A' ? 'A' : null;
  const lean = (e: PointerEvent<HTMLDivElement>) => {
    if (!ref.current || !canTilt(e.pointerType, closeUp)) return;
    const box = ref.current.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
    const y = Math.min(1, Math.max(0, (e.clientY - box.top) / box.height));
    const angle = closeUp ? 20 : 14;
    ref.current.style.setProperty('--mx', `${x * 100}%`);
    ref.current.style.setProperty('--my', `${y * 100}%`);
    ref.current.style.setProperty('--rx', `${(0.5 - y) * angle}deg`);
    ref.current.style.setProperty('--ry', `${(x - 0.5) * angle}deg`);
    if (shimmerLevel) {
      const now = performance.now();
      const before = lastPoint.current;
      const speed = before ? Math.hypot(x - before.x, y - before.y) / Math.max(0.008, (now - before.t) / 1000) : 0;
      lastPoint.current = { x, y, t: now };
      shimmer.current ??= startShimmer(shimmerLevel);
      shimmer.current?.move(x, y, speed);
    }
  };
  const rest = () => {
    ref.current?.style.removeProperty('--rx');
    ref.current?.style.removeProperty('--ry');
    shimmer.current?.stop();
    shimmer.current = null;
    lastPoint.current = null;
  };
  const tilt =
    size !== 'sm'
      ? {
          onPointerMove: lean,
          onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
            if (e.pointerType === 'mouse' || !closeUp) return;
            // Keep following the finger even when it slides off the card.
            e.currentTarget.setPointerCapture(e.pointerId);
            lean(e);
          },
          onPointerUp: (e: PointerEvent<HTMLDivElement>) => e.pointerType !== 'mouse' && rest(),
          onPointerCancel: rest,
          onPointerLeave: rest,
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
