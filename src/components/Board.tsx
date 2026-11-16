import { useEffect, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { getCharacter } from '../data/characters';
import type { GameView, PlayerView, Seat } from '../game/types';
import { useI18n } from '../i18n';
import type { StringKey } from '../i18n/strings';
import { BidControls } from './BidControls';
import { CharacterCard } from './CharacterCard';
import { Scoreboard } from './Scoreboard';

export interface BoardProps {
  view: GameView;
  /**
   * `shared`: two players look at one screen, so the card stays face down
   * unless the drawer presses and holds it. `personal`: this screen belongs
   * to `view.you` alone (online play, or a game against the computer).
   */
  mode: 'shared' | 'personal';
  busy?: boolean;
  error?: string | null;
  onDraw(): void;
  onBid(amount: number): void;
  onPass(): void;
  onNext(): void;
  onQuit(): void;
}

const rivalOf = (seat: Seat): Seat => (seat === 0 ? 1 : 0);

export function Board({ view, mode, busy, error, onDraw, onBid, onPass, onNext, onQuit }: BoardProps) {
  const { t, money } = useI18n();
  const [peeking, setPeeking] = useState(false);

  // Never carry a peek over to the next card.
  useEffect(() => setPeeking(false), [view.round, view.phase]);

  const player = (seat: Seat): PlayerView => view.players[seat];
  const drawer = player(view.drawer);
  const bidder = player(view.turn);
  const mine = (seat: Seat) => mode === 'shared' || view.you === seat;

  const { settings } = view;
  const required = view.highBidder === null ? settings.minBid : view.highBid + settings.increment;
  const last = view.history[view.history.length - 1];
  const gameEnds =
    view.deckCount === 0 ||
    !view.players.some((p) => p.team.length < settings.teamSize && p.budget >= settings.minBid);

  const faceUp =
    view.phase === 'reveal' ||
    (view.phase === 'bidding' && (mode === 'shared' ? peeking : view.card !== null));

  const peekHandlers = {
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      setPeeking(true);
    },
    onPointerUp: () => setPeeking(false),
    onPointerCancel: () => setPeeking(false),
    onLostPointerCapture: () => setPeeking(false),
    onKeyDown: (e: KeyboardEvent) => (e.key === ' ' || e.key === 'Enter') && setPeeking(true),
    onKeyUp: () => setPeeking(false),
    onBlur: () => setPeeking(false),
    onContextMenu: (e: { preventDefault(): void }) => e.preventDefault(),
  };

  return (
    <main className="board">
      <header className="board__top">
        <p className="board__meta">
          <strong>{t('board.round', { n: view.round })}</strong>
          <span>
            {view.deckCount === 1 ? t('board.deck.one') : t('board.deck', { n: view.deckCount })}
          </span>
          {view.code && <span>{t('board.room', { code: view.code })}</span>}
        </p>
        <button type="button" className="link" onClick={onQuit}>
          {t('board.quit')}
        </button>
      </header>

      <Scoreboard view={view} />

      <section className="stage" aria-live="polite">
        <div className={`stage__card${view.phase === 'reveal' ? ' stage__card--reveal' : ''}`}>
          {mode === 'shared' && view.phase === 'bidding' ? (
            <button
              type="button"
              className="peek"
              aria-label={t('board.peek', { name: drawer.name })}
              {...peekHandlers}
            >
              <CharacterCard id={faceUp ? view.card : null} />
            </button>
          ) : (
            <CharacterCard id={faceUp ? view.card : null} />
          )}
          {view.phase === 'reveal' && last && (
            <span className={`stamp${last.winner === null ? ' stamp--void' : ''}`}>
              {last.winner === null ? t('board.discarded') : t('board.sold')}
            </span>
          )}
        </div>

        {view.phase === 'draw' && <h2 className="stage__title">{t('board.draws', { name: drawer.name })}</h2>}

        {view.phase === 'bidding' && (
          <>
            <div className="stage__bid">
              {view.highBidder === null ? (
                <p className="stage__nobid">{t('board.noBid')}</p>
              ) : (
                <>
                  <p className="stage__label">{t('board.currentBid')}</p>
                  <p className="stage__amount">
                    <span className="price">{money(view.highBid)}</span>
                    <span className={`stage__by seat${view.highBidder}`}>
                      {t('board.by', { name: player(view.highBidder).name })}
                    </span>
                  </p>
                </>
              )}
            </div>
            {mode === 'personal' && (
              <p className="note">
                {view.card !== null ? t('board.onlyYou') : t('board.hidden', { name: drawer.name })}
              </p>
            )}
            {mode === 'shared' && <p className="note">{t('board.peek', { name: drawer.name })}</p>}
          </>
        )}

        {view.phase === 'reveal' && last && (
          <>
            <h2 className="stage__title">
              {last.winner === null
                ? t('board.noTaker', { character: getCharacter(last.card).name })
                : t('board.soldTo', {
                    name: player(last.winner).name,
                    character: getCharacter(last.card).name,
                    price: money(last.price),
                  })}
            </h2>
            {getCharacter(last.card).power > 0 && (
              <p className="power">{t('board.power', { n: getCharacter(last.card).power })}</p>
            )}
          </>
        )}
      </section>

      {error && (
        <p className="alert" role="alert">
          {t(`error.${error}` as StringKey)}
        </p>
      )}

      <section className="controls">
        {view.phase === 'draw' &&
          (mine(view.drawer) ? (
            <button type="button" className="btn btn--primary btn--wide" onClick={onDraw} disabled={busy}>
              {t('board.draw')}
            </button>
          ) : (
            <p className="waiting">{t('board.waitDraw', { name: drawer.name })}</p>
          ))}

        {view.phase === 'bidding' &&
          (mine(view.turn) ? (
            <>
              <p className={`controls__who seat${view.turn}`}>
                {t('board.yourMove', { name: bidder.name })}
              </p>
              {view.highBidder === null && view.passed[rivalOf(view.turn)] && (
                <p className="note">{t('board.rivalPassed', { name: player(rivalOf(view.turn)).name })}</p>
              )}
              <BidControls
                key={`${view.round}-${view.turn}`}
                min={required}
                max={bidder.budget}
                step={settings.increment}
                disabled={busy}
                onBid={onBid}
                onPass={onPass}
              />
            </>
          ) : (
            <p className="waiting">{t('board.waitMove', { name: bidder.name })}</p>
          ))}

        {view.phase === 'reveal' && (
          <button type="button" className="btn btn--primary btn--wide" onClick={onNext} disabled={busy}>
            {gameEnds ? t('board.finish') : t('board.next')}
          </button>
        )}
      </section>

      <History view={view} />
    </main>
  );
}

function History({ view }: { view: GameView }) {
  const { t, money } = useI18n();
  return (
    <details className="history">
      <summary>{t('board.history')}</summary>
      {view.history.length === 0 ? (
        <p>{t('board.history.empty')}</p>
      ) : (
        <ol>
          {view.history
            .slice()
            .reverse()
            .map((entry) => {
              const character = getCharacter(entry.card).name;
              return (
                <li key={`${entry.round}-${entry.card}`} value={entry.round}>
                  {entry.winner === null
                    ? t('board.history.discarded', { character })
                    : t('board.history.sold', {
                        character,
                        name: view.players[entry.winner].name,
                        price: money(entry.price),
                      })}
                </li>
              );
            })}
        </ol>
      )}
    </details>
  );
}
