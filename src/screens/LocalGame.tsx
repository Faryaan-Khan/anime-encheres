import { useEffect, useState, type FormEvent } from 'react';
import type { BotLevel } from '../bot/bot';
import { AUTO_BID_SECONDS, Board } from '../components/Board';
import { Final } from '../components/Final';
import { DEFAULT_OPTIONS, SettingsFields, toSettings, type GameOptions } from '../components/SettingsFields';
import { poolFor } from '../data/characters';
import { canPass, canStillBuy, toView } from '../game/engine';
import { useI18n } from '../i18n';
import type { StringKey } from '../i18n/strings';
import { BOT_SEAT, useLocalGame } from '../local/useLocalGame';
import { navigate } from '../router';
import { readStored, writeStored } from '../storage';

/** How long the computer appears to think before it acts, in milliseconds. */
const BOT_DELAY = 900;
/** How long a player who has to bid gets before the minimum is bid for them. */
const AUTO_BID_MS = AUTO_BID_SECONDS * 1000;

/**
 * `teams`: two teams share the device, any number of people in each.
 * `three`: three players share the device.
 */
type Opponent = 'friend' | 'three' | 'teams' | BotLevel;

/**
 * A game on this device: setup form, then the board, then the final screen.
 * `solo` preselects the computer as the opponent.
 */
export function LocalGame({ solo = false }: { solo?: boolean }) {
  const game = useLocalGame();
  const { state, bot, playBot, finishForBot } = game;

  // The player cannot buy any more: once they have seen the result of their
  // last purchase, the computer finishes and the final screen follows.
  const playerDone = state !== null && bot !== null && state.phase !== 'finished' && !canStillBuy(state, 0);
  useEffect(() => {
    if (!playerDone || state?.phase === 'reveal') return;
    const timer = window.setTimeout(finishForBot, BOT_DELAY);
    return () => window.clearTimeout(timer);
  }, [playerDone, state?.phase, finishForBot]);

  // The computer moves a moment after it becomes its turn (unless it is
  // finishing the game on its own, below).
  const botToAct =
    state !== null &&
    bot !== null &&
    canStillBuy(state, 0) &&
    ((state.phase === 'draw' && state.drawer === BOT_SEAT) ||
      (state.phase === 'bidding' && state.turn === BOT_SEAT));
  useEffect(() => {
    if (!botToAct) return;
    const timer = window.setTimeout(playBot, BOT_DELAY);
    return () => window.clearTimeout(timer);
  }, [botToAct, playBot]);

  // A player out of passes, facing a card nobody has bid on, has to bid: after
  // a few seconds the minimum is bid for them (as the server does online).
  // The computer handles its own turns.
  const mustBid =
    state !== null &&
    state.phase === 'bidding' &&
    state.highBidder === null &&
    !(bot !== null && state.turn === BOT_SEAT) &&
    !canPass(state, state.turn);
  const { bid: placeBid } = game;
  useEffect(() => {
    if (!mustBid || !state) return;
    const timer = window.setTimeout(() => placeBid(state.settings.minBid), AUTO_BID_MS);
    return () => window.clearTimeout(timer);
  }, [mustBid, state, placeBid]);

  if (!state) return <LocalSetup solo={solo} onStart={game.start} />;

  // Against the computer the screen belongs to the human in seat 0, who must
  // not see the cards the computer draws. Two humans share the whole view.
  const view = toView(state, bot ? 0 : 'all', { poolSize: game.poolSize });
  const home = () => navigate('/');

  if (view.phase === 'finished') {
    return (
      <Final
        view={view}
        onRematch={game.rematch}
        onHome={() => {
          game.clear();
          home();
        }}
      />
    );
  }

  return (
    <Board
      view={view}
      mode={bot ? 'personal' : 'shared'}
      onDraw={game.draw}
      onBid={game.bid}
      onPass={game.pass}
      onNext={game.next}
      onQuit={home}
    />
  );
}

interface SetupProps {
  solo: boolean;
  onStart: ReturnType<typeof useLocalGame>['start'];
}

function LocalSetup({ solo, onStart }: SetupProps) {
  const { t } = useI18n();
  const [opponent, setOpponent] = useState<Opponent>(solo ? 'normal' : 'friend');
  const [names, setNames] = useState<string[]>(() => [
    readStored('ae.name') ?? '',
    readStored('ae.name2') ?? '',
    readStored('ae.name3') ?? '',
  ]);
  const [options, setOptions] = useState<GameOptions>(DEFAULT_OPTIONS);
  const [error, setError] = useState<StringKey | null>(null);
  const againstBot = opponent !== 'friend' && opponent !== 'teams' && opponent !== 'three';
  const teams = opponent === 'teams';
  const count = opponent === 'three' ? 3 : 2;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const chosen = againstBot
      ? [names[0].trim(), t(opponent === 'hard' ? 'bot.name.hard' : 'bot.name.normal')]
      : names.slice(0, count).map((n) => n.trim());
    if (chosen.some((n) => n.length < 1 || n.length > 20)) return setError('setup.nameRequired');
    if (new Set(chosen.map((n) => n.toLowerCase())).size !== chosen.length) return setError('setup.namesDiffer');
    if (teams) {
      writeStored('ae.team1', chosen[0]);
      writeStored('ae.team2', chosen[1]);
    } else {
      writeStored('ae.name', chosen[0]);
      if (!againstBot) writeStored('ae.name2', chosen[1]);
      if (count === 3) writeStored('ae.name3', chosen[2]);
    }
    onStart({
      settings: toSettings(options),
      names: chosen,
      pool: poolFor(options.universe),
      bot: againstBot ? opponent : undefined,
    });
  };

  const opponents: Array<{ id: Opponent; label: StringKey; hint: StringKey }> = [
    { id: 'friend', label: 'setup.opponent.friend', hint: 'setup.opponent.friend.hint' },
    { id: 'three', label: 'setup.opponent.three', hint: 'setup.opponent.three.hint' },
    { id: 'teams', label: 'setup.opponent.teams', hint: 'setup.opponent.teams.hint' },
    { id: 'normal', label: 'setup.opponent.normal', hint: 'setup.opponent.normal.hint' },
    { id: 'hard', label: 'setup.opponent.hard', hint: 'setup.opponent.hard.hint' },
  ];

  return (
    <main className="page">
      <h1 className="display">{t('setup.title.local')}</h1>
      <form className="form" onSubmit={submit} noValidate>
        <fieldset className="field">
          <legend>{t('setup.opponent')}</legend>
          <div className="options options--stack">
            {opponents.map((o) => (
              <label key={o.id} className="option">
                <input
                  type="radio"
                  name="opponent"
                  checked={opponent === o.id}
                  onChange={() => {
                    // Team names and player names are remembered separately.
                    if ((o.id === 'teams') !== teams) {
                      setNames(
                        o.id === 'teams'
                          ? [readStored('ae.team1') ?? '', readStored('ae.team2') ?? '', '']
                          : [readStored('ae.name') ?? '', readStored('ae.name2') ?? '', readStored('ae.name3') ?? ''],
                      );
                    }
                    setOpponent(o.id);
                  }}
                />
                <span>
                  {t(o.label)}
                  <small>{t(o.hint)}</small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className={againstBot ? undefined : count === 3 ? 'form__trio' : 'form__pair'}>
          {([0, 1, 2] as const)
            .filter((i) => (againstBot ? i === 0 : i < count))
            .map((i) => (
              <label key={i} className={`field field--seat${i}`}>
                <span>
                  {t(
                    againstBot
                      ? 'setup.name'
                      : teams
                        ? i === 0
                          ? 'setup.team1'
                          : 'setup.team2'
                        : i === 0
                          ? 'setup.player1'
                          : i === 1
                            ? 'setup.player2'
                            : 'setup.player3',
                  )}
                </span>
                <input
                  type="text"
                  value={names[i]}
                  maxLength={20}
                  autoComplete="off"
                  onChange={(e) => {
                    const next = [...names];
                    next[i] = e.target.value;
                    setNames(next);
                  }}
                />
              </label>
            ))}
        </div>

        <SettingsFields value={options} onChange={setOptions} />
        {error && (
          <p className="alert" role="alert">
            {t(error)}
          </p>
        )}
        <div className="form__actions">
          <button type="button" className="btn" onClick={() => navigate('/')}>
            {t('setup.back')}
          </button>
          <button type="submit" className="btn btn--primary">
            {t('setup.start')}
          </button>
        </div>
      </form>
    </main>
  );
}
