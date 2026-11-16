import { getCharacter } from '../data/characters';
import type { GameView, Seat } from '../game/types';
import { judge } from '../game/verdict';
import { useI18n } from '../i18n';
import type { StringKey } from '../i18n/strings';
import { CharacterCard } from './CharacterCard';

interface Props {
  view: GameView;
  /** `undefined` hides the button (online guest: only the host can restart). */
  onRematch?: () => void;
  busy?: boolean;
  onHome(): void;
}

const VERDICT: Record<'narrow' | 'clear' | 'crushing', StringKey> = {
  narrow: 'final.verdict.narrow',
  clear: 'final.verdict.clear',
  crushing: 'final.verdict.crushing',
};

/** Both teams side by side with the verdict computed from the power ratings. */
export function Final({ view, onRematch, busy, onHome }: Props) {
  const { t, money } = useI18n();
  const powers = (seat: Seat) => view.players[seat].team.map((id) => getCharacter(id).power);
  const verdict = judge(powers(0), powers(1));

  return (
    <main className="final">
      <header className="final__head">
        <h1 className="display">
          {verdict.winner === null || verdict.margin === 'tie'
            ? t('final.verdict.tie')
            : t(VERDICT[verdict.margin], { name: view.players[verdict.winner].name })}
        </h1>
        {verdict.winner !== null && (
          <p>
            {verdict.ratio >= 1000
              ? t('final.ratio.huge')
              : t('final.ratio', {
                  n: verdict.ratio < 10 ? verdict.ratio.toFixed(1) : Math.round(verdict.ratio),
                })}
          </p>
        )}
      </header>

      {view.players.map((player) => {
        // The card that carries the team gets a marker.
        const best = Math.max(0, ...player.team.map((id) => getCharacter(id).power));
        return (
          <section
            key={player.seat}
            className={`team team--seat${player.seat}${verdict.winner === player.seat ? ' team--winner' : ''}`}
          >
            <header className="team__head">
              <h2>{player.name}</h2>
              <p className="team__power">
                {t('final.teamPower', { n: verdict.power[player.seat].toFixed(1) })}
              </p>
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
                  const power = getCharacter(id).power;
                  return (
                    <li key={id}>
                      <CharacterCard id={id} size="sm" />
                      <span className="tag">{money(price)}</span>
                      <span className={`team__rating${power === best ? ' team__rating--best' : ''}`}>
                        {t('board.power', { n: power })}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}

      <p className="note">{t('final.how')}</p>

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
