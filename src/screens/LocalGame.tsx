import { useState, type FormEvent } from 'react';
import { Board } from '../components/Board';
import { Final } from '../components/Final';
import { DEFAULT_OPTIONS, SettingsFields, toSettings, type GameOptions } from '../components/SettingsFields';
import { poolFor } from '../data/characters';
import { toView } from '../game/engine';
import { useI18n } from '../i18n';
import type { StringKey } from '../i18n/strings';
import { useLocalGame } from '../local/useLocalGame';
import { navigate } from '../router';
import { readStored, writeStored } from '../storage';

/** Same-device mode: setup form, then the board, then the final screen. */
export function LocalGame() {
  const game = useLocalGame();

  if (!game.state) return <LocalSetup onStart={game.start} />;

  const view = toView(game.state, 'all', { poolSize: game.poolSize });
  const home = () => navigate('/');

  if (view.phase === 'finished') {
    return (
      <Final
        view={view}
        allowVote
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
      mode="local"
      onDraw={game.draw}
      onBid={game.bid}
      onPass={game.pass}
      onNext={game.next}
      onQuit={home}
    />
  );
}

function LocalSetup({ onStart }: { onStart: ReturnType<typeof useLocalGame>['start'] }) {
  const { t } = useI18n();
  const [names, setNames] = useState<[string, string]>(() => [
    readStored('ae.name') ?? '',
    readStored('ae.name2') ?? '',
  ]);
  const [options, setOptions] = useState<GameOptions>(DEFAULT_OPTIONS);
  const [error, setError] = useState<StringKey | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const clean: [string, string] = [names[0].trim(), names[1].trim()];
    if (clean.some((n) => n.length < 1 || n.length > 20)) return setError('setup.nameRequired');
    if (clean[0].toLowerCase() === clean[1].toLowerCase()) return setError('setup.namesDiffer');
    writeStored('ae.name', clean[0]);
    writeStored('ae.name2', clean[1]);
    onStart({ settings: toSettings(options), names: clean, pool: poolFor(options.universe) });
  };

  return (
    <main className="page">
      <h1 className="display">{t('setup.title.local')}</h1>
      <form className="form" onSubmit={submit} noValidate>
        <div className="form__pair">
          {([0, 1] as const).map((i) => (
            <label key={i} className={`field field--seat${i}`}>
              <span>{t(i === 0 ? 'setup.player1' : 'setup.player2')}</span>
              <input
                type="text"
                value={names[i]}
                maxLength={20}
                autoComplete="off"
                onChange={(e) => {
                  const next: [string, string] = [...names];
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
