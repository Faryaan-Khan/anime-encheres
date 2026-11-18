import { getCharacter, powerOf, scaleFactor } from '../data/characters';
import type { GameView, Seat } from '../game/types';
import { judge } from '../game/verdict';
import { useI18n } from '../i18n';
import type { StringKey } from '../i18n/strings';
import { CharacterCard } from './CharacterCard';
import { useEffect } from 'react';
import { play } from '../sound';
import { Confetti, CountUp } from './Effects';

interface Props {
  view: GameView;
  /** `undefined` hides the button (online guest: only the host can restart). */
  onRematch?: () => void;
  /** Quick matches: look for a new opponent instead of a rematch. */
  onFindAnother?: () => void;
  /** The seat that gave up or ran out of time, if the game ended that way. */
  forfeit?: Seat | null;
  /** Extra line under the explanation. */
  footnote?: string;
  /** Ranked games: this player's trophy change and new total. */
  trophies?: { delta: number; total: number } | null;
  busy?: boolean;
  onHome(): void;
}

const VERDICT: Record<'narrow' | 'clear' | 'crushing', StringKey> = {
  narrow: 'final.verdict.narrow',
  clear: 'final.verdict.clear',
  crushing: 'final.verdict.crushing',
};

/** Both teams side by side with the verdict computed from the power ratings. */
export function Final({
  view,
  onRematch,
  onFindAnother,
  forfeit = null,
  footnote,
  trophies,
  busy,
  onHome,
}: Props) {
  const { t, money } = useI18n();
  const powers = (seat: Seat) => view.players[seat].team.map((id) => getCharacter(id).power);
  const verdict = judge(powers(0), powers(1));
  // A forfeit decides the game whatever the teams look like.
  const winner: Seat | null = forfeit !== null ? (forfeit === 0 ? 1 : 0) : verdict.winner;
  // On a shared screen (you = null) any win is celebrated.
  const outcome = winner === null ? 'tie' : view.you === null || view.you === winner ? 'win' : 'loss';

  useEffect(() => {
    const timer = window.setTimeout(() => play(outcome === 'win' ? 'victory' : outcome === 'loss' ? 'defeat' : 'tie'), 250);
    return () => window.clearTimeout(timer);
  }, [outcome]);

  return (
    <main className="final">
      {outcome === 'win' && <Confetti />}
      <header className="final__head">
        <h1 className="display">
          {forfeit !== null && winner !== null
            ? t('final.forfeit', { winner: view.players[winner].name, loser: view.players[forfeit].name })
            : verdict.winner === null || verdict.margin === 'tie'
              ? t('final.verdict.tie')
              : t(VERDICT[verdict.margin], { name: view.players[verdict.winner].name })}
        </h1>
        {forfeit === null && verdict.winner !== null && (
          <p>
            {verdict.ratio >= 1000
              ? t('final.ratio.huge')
              : t('final.ratio', {
                  n: verdict.ratio < 10 ? verdict.ratio.toFixed(1) : Math.round(verdict.ratio),
                })}
          </p>
        )}
        {trophies && (
          <p
            className={`trophies${trophies.delta > 0 ? ' trophies--up' : trophies.delta < 0 ? ' trophies--down' : ''}`}
          >
            {(() => {
              const key =
                trophies.delta > 0 ? 'final.trophies.up' : trophies.delta < 0 ? 'final.trophies.down' : 'final.trophies.same';
              // The total counts up inside the sentence.
              const [before, after = ''] = t(key, { n: trophies.delta, total: '\u0000' }).split('\u0000');
              return (
                <>
                  {before}
                  <CountUp
                    from={trophies.total - trophies.delta}
                    to={trophies.total}
                    ms={1100}
                    onDone={() => trophies.delta > 0 && play('trophy')}
                  />
                  {after}
                </>
              );
            })()}
          </p>
        )}
      </header>

      {view.players.map((player) => {
        // The card that carries the team gets a marker.
        const best = Math.max(0, ...player.team.map((id) => getCharacter(id).power));
        return (
          <section
            key={player.seat}
            className={`team team--seat${player.seat}${winner === player.seat ? ' team--winner' : ''}`}
          >
            <header className="team__head">
              <h2>{player.name}</h2>
              <p className="team__power">
                {t('final.teamPower', { n: (verdict.power[player.seat] * scaleFactor(view.scale)).toFixed(1) })}
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
                  const power = powerOf(id, view.scale);
                  const isBest = getCharacter(id).power === best;
                  return (
                    <li key={id}>
                      <CharacterCard id={id} size="sm" />
                      <span className="tag">{money(price)}</span>
                      <span className={`team__rating${isBest ? ' team__rating--best' : ''}`}>
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

      {forfeit === null && <p className="note">{t('final.how')}</p>}
      {footnote && <p className="note">{footnote}</p>}

      <div className="final__actions">
        {onFindAnother ? (
          <button type="button" className="btn btn--primary" onClick={onFindAnother} disabled={busy}>
            {t('match.again')}
          </button>
        ) : onRematch ? (
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
