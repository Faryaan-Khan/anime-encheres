import type { CSSProperties } from 'react';
import { getCharacter, getUniverse, initials } from '../data/characters';
import type { GameView, PlayerView } from '../game/types';
import { useI18n } from '../i18n';

function TeamSlots({ player, teamSize }: { player: PlayerView; teamSize: number }) {
  const { t } = useI18n();
  return (
    <ul
      className="slots"
      aria-label={t('board.teamSlots', { name: player.name, n: player.team.length, max: teamSize })}
    >
      {Array.from({ length: teamSize }, (_, i) => {
        const id = player.team[i];
        if (!id) return <li key={i} className="slot" />;
        const character = getCharacter(id);
        const style = { '--spot': getUniverse(character.universe).color } as CSSProperties;
        return (
          <li key={i} className="slot slot--filled" style={style} title={character.name}>
            {initials(character.name)}
          </li>
        );
      })}
    </ul>
  );
}

/** Both players side by side: budget, team progress, who draws and who must act. */
export function Scoreboard({ view }: { view: GameView }) {
  const { t, money } = useI18n();
  const live = view.phase === 'draw' || view.phase === 'bidding';
  return (
    <div className="scoreboard">
      {view.players.map((player) => {
        const acting =
          (view.phase === 'draw' && view.drawer === player.seat) ||
          (view.phase === 'bidding' && view.turn === player.seat);
        return (
          <section
            key={player.seat}
            className={`player player--seat${player.seat}${acting ? ' player--acting' : ''}`}
          >
            <h2 className="player__name">
              {player.name}
              {view.you === player.seat && <span className="player__you"> ({t('lobby.you')})</span>}
            </h2>
            <p className="player__budget">{money(player.budget)}</p>
            <TeamSlots player={player} teamSize={view.settings.teamSize} />
            <PassMarks used={player.passes ?? 0} limit={view.settings.passLimit ?? 3} name={player.name} />
            {(view.strikes?.[player.seat] ?? 0) > 0 && (
              <p className="player__strikes" title={t('board.timer.strikesShort', { n: view.strikes![player.seat], max: view.maxStrikes ?? 3 })}>
                {t('board.timer.strikesShort', { n: view.strikes![player.seat], max: view.maxStrikes ?? 3 })}
              </p>
            )}
            <p className="player__role">
              {live && view.drawer === player.seat ? (
                <>
                  <EyeIcon /> {t('board.sees')}
                </>
              ) : (
                ' '
              )}
            </p>
          </section>
        );
      })}
    </div>
  );
}

function EyeIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3.2" fill="currentColor" />
    </svg>
  );
}

/**
 * The passes a player has used, as big crosses that light up one by one, like
 * the buzzers on a talent show.
 */
function PassMarks({ used, limit, name }: { used: number; limit: number; name: string }) {
  const { t } = useI18n();
  return (
    <p className="passes" aria-label={t('board.passes.label', { name, n: used, max: limit })}>
      {Array.from({ length: limit }, (_, i) => (
        <span key={i} className={`passes__x${i < used ? ' passes__x--used' : ''}`} aria-hidden="true">
          ✕
        </span>
      ))}
    </p>
  );
}
