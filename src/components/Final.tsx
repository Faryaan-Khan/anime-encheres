import { useState } from 'react';
import type { GameView, Seat } from '../game/types';
import { useI18n } from '../i18n';
import { CharacterCard } from './CharacterCard';

interface Props {
  view: GameView;
  /** Same-device games let the table crown a winner on the shared screen. */
  allowVote: boolean;
  /** `undefined` hides the button (online guest: only the host can restart). */
  onRematch?: () => void;
  busy?: boolean;
  onHome(): void;
}

export function Final({ view, allowVote, onRematch, busy, onHome }: Props) {
  const { t, money } = useI18n();
  const [winner, setWinner] = useState<Seat | null>(null);

  return (
    <main className="final">
      <header className="final__head">
        <h1 className="display">{t('final.title')}</h1>
        <p>
          {winner === null
            ? t('final.debate')
            : t('final.winner', { name: view.players[winner].name })}
        </p>
      </header>

      {view.players.map((player) => (
        <section
          key={player.seat}
          className={`team team--seat${player.seat}${winner === player.seat ? ' team--winner' : ''}`}
        >
          <header className="team__head">
            <h2>{player.name}</h2>
            <p>
              {t('final.spent', { amount: money(view.settings.budget - player.budget) })},{' '}
              {t('final.left', { amount: money(player.budget) })}
            </p>
          </header>
          {player.team.length === 0 ? (
            <p className="team__empty">{t('final.empty')}</p>
          ) : (
            <ul className="team__cards">
              {player.team.map((id) => {
                const price = view.history.find((h) => h.card === id)?.price ?? 0;
                return (
                  <li key={id}>
                    <CharacterCard id={id} size="sm" />
                    <span className="tag">{money(price)}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {allowVote && winner === null && (
            <button type="button" className="btn" onClick={() => setWinner(player.seat)}>
              {t('final.voteFor', { name: player.name })}
            </button>
          )}
        </section>
      ))}

      {allowVote && winner === null && <p className="note">{t('final.vote')}</p>}

      <div className="final__actions">
        {onRematch ? (
          <button type="button" className="btn btn--primary" onClick={onRematch} disabled={busy}>
            {t('final.rematch')}
          </button>
        ) : (
          <p className="note">{t('final.waitRematch')}</p>
        )}
        <button type="button" className="btn" onClick={onHome}>
          {t('final.home')}
        </button>
      </div>
    </main>
  );
}
