import type { CSSProperties } from 'react';
import { getCharacter, getImage, getUniverse, initials } from '../data/characters';

interface Props {
  /** Character id, or `null` for a face-down card. */
  id: string | null;
  size?: 'lg' | 'sm';
}

/**
 * A card drawn entirely by the app: universe colour, initials and name.
 * If a picture exists in src/assets/cards/<id>.* it replaces the initials.
 */
export function CharacterCard({ id, size = 'lg' }: Props) {
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
  const style = { '--spot': universe.color } as CSSProperties;

  return (
    <div className={`card card--face card--${size}`} style={style}>
      {universe.name && <div className="card__universe">{universe.name}</div>}
      <div className="card__art">
        {image ? (
          <img src={image} alt="" draggable={false} />
        ) : (
          <span className="card__initials" aria-hidden="true">
            {initials(character.name)}
          </span>
        )}
      </div>
      <div className="card__name">{character.name}</div>
    </div>
  );
}
