import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { getCharacter } from '../data/characters';
import { canStillBuy } from '../game/engine';
import type { GameView, PlayerView, Seat } from '../game/types';
import { useI18n } from '../i18n';
import type { StringKey } from '../i18n/strings';
import { BidControls } from './BidControls';
import { CharacterCard } from './CharacterCard';
import { Scoreboard } from './Scoreboard';
import { play } from '../sound';

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
  /**
   * Quick matches: leaving gives the win to the opponent, so the quit link
   * says so and asks for a second tap.
   */
  quitForfeits?: boolean;
  /**
   * Quick matches: time left for the player who has to act, and how many
   * times each player has run out of time. When time runs out the server
   * moves for the slow player; the last time-out loses the match.
   */
  clock?: { seat: Seat; secondsLeft: number; strikes: [number, number]; maxStrikes: number };
  /** Quick matches: the rival's device has gone quiet; they lose when this runs out. */
  away?: { seat: Seat; secondsLeft: number };
  /**
   * Quick matches: leave without giving up, for a player who cannot buy any
   * more. Their result stands and the match is settled without them.
   */
  onLeave?: () => void;
}

/** Seconds a result stays on screen before the game moves on by itself. */
const NEXT_AFTER = 5;
/** The same, once this player cannot buy any more: they are only watching. */
const NEXT_AFTER_WATCHING = 1.5;
/** The same, before the final screen. */
const FINISH_AFTER = 3;

/** The clock stays out of the way until this many seconds are left. */
const CLOCK_VISIBLE_FROM = 15;

const rivalOf = (seat: Seat): Seat => (seat === 0 ? 1 : 0);

export function Board({
  view,
  mode,
  busy,
  error,
  onDraw,
  onBid,
  onPass,
  onNext,
  onQuit,
  quitForfeits,
  clock,
  away,
  onLeave,
}: BoardProps) {
  const { t, money } = useI18n();
  const [peeking, setPeeking] = useState(false);
  const [confirmingQuit, setConfirmingQuit] = useState(false);

  // The second tap must follow the first within a few seconds.
  useEffect(() => {
    if (!confirmingQuit) return;
    const timer = window.setTimeout(() => setConfirmingQuit(false), 4000);
    return () => window.clearTimeout(timer);
  }, [confirmingQuit]);

  // Never carry a peek over to the next card.
  useEffect(() => setPeeking(false), [view.round, view.phase]);

  useGameSounds(view, mode);
  const myClock = clock && (mode === 'shared' || view.you === clock.seat) ? clock.secondsLeft : null;
  useEffect(() => {
    if (myClock === null || myClock > 10 || myClock < 1) return;
    play(myClock <= 5 ? 'urgent' : 'tick');
  }, [myClock]);

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

  // This screen's player can no longer buy anything: the rest plays out by
  // itself and they are only watching.
  const watcher = mode === 'personal' && view.you !== null ? view.you : null;
  const watching = watcher !== null && view.status === 'playing' && !canStillBuy(view, watcher);
  const teamFull = watcher !== null && view.players[watcher].team.length >= settings.teamSize;

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
        {watching && onLeave ? (
          <button type="button" className="link" onClick={onLeave}>
            {t('board.done.leave')}
          </button>
        ) : quitForfeits ? (
          <button
            type="button"
            className="link"
            onClick={() => (confirmingQuit ? onQuit() : setConfirmingQuit(true))}
          >
            {t(confirmingQuit ? 'board.forfeit.confirm' : 'board.forfeit')}
          </button>
        ) : (
          <button type="button" className="link" onClick={onQuit}>
            {t('board.quit')}
          </button>
        )}
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
                    <span key={view.highBid} className="price pop">
                      {money(view.highBid)}
                    </span>
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

      {away && (
        <div className="clock clock--away" role="status">
          <p className="note">
            {away.secondsLeft > 0
              ? t('board.away.counting', { name: player(away.seat).name, n: away.secondsLeft })
              : t('board.away.done', { name: player(away.seat).name })}
          </p>
        </div>
      )}

      {clock && !away && clock.secondsLeft <= CLOCK_VISIBLE_FROM && (
        <div className={`clock${clock.secondsLeft <= 5 ? ' clock--urgent' : ''}`} role="status">
          {clock.secondsLeft <= 0 ? (
            <p className="note">
              {mine(clock.seat) ? t('board.timer.youExpired') : t('board.timer.expired', { name: player(clock.seat).name })}
            </p>
          ) : mine(clock.seat) ? (
            <p className="alert">{t('board.timer.you', { n: clock.secondsLeft })}</p>
          ) : (
            <p className="note">{t('board.timer.rival', { name: player(clock.seat).name, n: clock.secondsLeft })}</p>
          )}
          {mine(clock.seat) && clock.strikes[clock.seat] > 0 && (
            <p className="clock__strikes">
              {t('board.timer.strikes', { n: clock.strikes[clock.seat], max: clock.maxStrikes })}
            </p>
          )}
        </div>
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

        {watching && view.phase !== 'reveal' && (
          <p className="note done-note">{t(teamFull ? 'board.done.full' : 'board.done.broke')}</p>
        )}

        {view.phase === 'reveal' && (
          <NextButton
            key={`${view.round}-${view.history.length}`}
            label={gameEnds ? t('board.finish') : t('board.next')}
            seconds={gameEnds ? FINISH_AFTER : watching ? NEXT_AFTER_WATCHING : NEXT_AFTER}
            busy={Boolean(busy)}
            onNext={onNext}
          />
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

/**
 * Plays a sound for each thing that happens in the game, by comparing the
 * view with the previous one. "Mine" means the seat this screen belongs to;
 * on a shared screen every result is cheered.
 */
function useGameSounds(view: GameView, mode: 'shared' | 'personal'): void {
  const previous = useRef<GameView | null>(null);
  // Sounds already queued must survive the next refresh of the view (online
  // views are re-read every second or two); they stop only with the board.
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);
  useEffect(() => {
    const before = previous.current;
    previous.current = view;
    if (!before || before.round > view.round) return;
    const me = mode === 'personal' ? view.you : null;
    const later = (ms: number, fn: () => void) => {
      if (timers.current.length > 20) timers.current = timers.current.slice(-20);
      timers.current.push(window.setTimeout(fn, ms));
    };

    if (before.phase === 'draw' && view.phase === 'bidding') {
      play('draw');
      if (view.card !== null) later(220, () => play('flip'));
    } else if (view.phase === 'reveal' && (before.phase !== 'reveal' || before.round !== view.round)) {
      const last = view.history[view.history.length - 1];
      if (before.phase === 'bidding' && before.card === null) play('flip');
      later(250, () => {
        if (!last || last.winner === null) return play('discard');
        play('sold');
        later(520, () => play(me === null || last.winner === me ? 'won' : 'lost'));
      });
    } else if (view.phase === 'bidding' && before.phase === 'bidding' && before.round === view.round) {
      if (view.highBid > before.highBid) {
        play(me !== null && view.highBidder !== me && before.highBidder === me ? 'outbid' : 'bid');
      } else if (view.passed.some((p, i) => p && !before.passed[i])) {
        play('pass');
      }
    }
  }, [view, mode]);
}

/**
 * Moves on from a result after a short countdown, shown as a bar draining
 * across the button. Pressing it moves on at once.
 */
function NextButton({
  label,
  seconds,
  busy,
  onNext,
}: {
  label: string;
  seconds: number;
  busy: boolean;
  onNext(): void;
}) {
  const [left, setLeft] = useState(Math.ceil(seconds));
  const fired = useRef(false);
  const latest = useRef({ onNext, busy });
  latest.current = { onNext, busy };

  useEffect(() => {
    const start = Date.now();
    const timer = window.setInterval(() => {
      const remaining = seconds - (Date.now() - start) / 1000;
      setLeft(Math.max(0, Math.ceil(remaining)));
      if (remaining <= 0 && !fired.current && !latest.current.busy) {
        fired.current = true;
        window.clearInterval(timer);
        latest.current.onNext();
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [seconds]);

  const press = () => {
    if (fired.current) return;
    fired.current = true;
    onNext();
  };

  return (
    <button
      type="button"
      className="btn btn--primary btn--wide btn--countdown"
      style={{ '--countdown': `${seconds}s` } as CSSProperties}
      onClick={press}
      disabled={busy}
    >
      <span className="btn--countdown__bar" aria-hidden="true" />
      <span className="btn--countdown__label">
        {label}
        {left > 0 && <span className="btn--countdown__left"> · {left}</span>}
      </span>
    </button>
  );
}
