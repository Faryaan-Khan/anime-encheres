import { useEffect, useState, type CSSProperties } from 'react';
import { CharacterCard } from '../components/CharacterCard';
import { getCharacter, getUniverse, powerIn, scaleFactor, slug } from '../data/characters';
import { teamPower } from '../game/verdict';
import { useI18n } from '../i18n';
import type { StringKey } from '../i18n/strings';
import { navigate } from '../router';

/** How long each step of the demo stays on screen, in milliseconds. */
const STEP_MS = 2600;

const STRONG = slug('Goku');
const WEAK = slug('Bulma');

interface Frame {
  caption: StringKey;
  drawer: 0 | 1;
  card: string;
  /** Whose eyes see the card: the drawer only, or everyone once revealed. */
  shown: 'drawer' | 'all';
  bid: { amount: number; by: 0 | 1 } | null;
  /** Passes used so far by each player. */
  passes: [number, number];
  /** Who just passed, and whether it cost one of their passes. */
  passed?: { seat: 0 | 1; costs: boolean };
  stamp: 'sold' | 'discard' | null;
  teams: [string[], string[]];
}

const FRAMES: Frame[] = [
  { caption: 'demo.1', drawer: 0, card: STRONG, shown: 'drawer', bid: null, passes: [0, 0], stamp: null, teams: [[], []] },
  { caption: 'demo.2', drawer: 0, card: STRONG, shown: 'drawer', bid: { amount: 10, by: 0 }, passes: [0, 0], stamp: null, teams: [[], []] },
  { caption: 'demo.3', drawer: 0, card: STRONG, shown: 'drawer', bid: { amount: 40, by: 1 }, passes: [0, 0], stamp: null, teams: [[], []] },
  {
    caption: 'demo.4',
    drawer: 0,
    card: STRONG,
    shown: 'drawer',
    bid: { amount: 90, by: 0 },
    passes: [0, 0],
    passed: { seat: 1, costs: false },
    stamp: null,
    teams: [[], []],
  },
  { caption: 'demo.5', drawer: 0, card: STRONG, shown: 'all', bid: { amount: 90, by: 0 }, passes: [0, 0], stamp: 'sold', teams: [[STRONG], []] },
  {
    caption: 'demo.6',
    drawer: 1,
    card: WEAK,
    shown: 'drawer',
    bid: null,
    passes: [0, 1],
    passed: { seat: 1, costs: true },
    stamp: null,
    teams: [[STRONG], []],
  },
  {
    caption: 'demo.7',
    drawer: 1,
    card: WEAK,
    shown: 'all',
    bid: null,
    passes: [1, 1],
    passed: { seat: 0, costs: true },
    stamp: 'discard',
    teams: [[STRONG], []],
  },
];

const NAMES = ['Ana', 'Ben'] as const;

/** A round played out on its own, step by step, with a caption for each move. */
function DemoRound() {
  const { t, money } = useI18n();
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(
    () => typeof window === 'undefined' || !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => setStep((s) => (s + 1) % FRAMES.length), STEP_MS);
    return () => window.clearTimeout(timer);
  }, [playing, step]);

  const frame = FRAMES[step];
  const faceUp = frame.shown === 'all';

  return (
    <figure className="demo" aria-label={t('demo.label')}>
      <div className="demo__table">
        {[0, 1].map((seat) => (
          <div
            key={seat}
            className={`demo__player demo__player--seat${seat}${frame.drawer === seat ? ' demo__player--drawer' : ''}`}
          >
            <strong>{NAMES[seat]}</strong>
            <span className="demo__team">
              {Array.from({ length: 3 }, (_, i) => {
                const id = frame.teams[seat][i];
                return (
                  <span
                    key={`${i}-${id ?? ''}`}
                    className={`demo__slot${id ? ' demo__slot--filled' : ''}`}
                    style={id ? ({ '--spot': getUniverse(getCharacter(id).universe).color } as CSSProperties) : undefined}
                  />
                );
              })}
            </span>
            <span className="passes passes--small" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <span key={i} className={`passes__x${i < frame.passes[seat] ? ' passes__x--used' : ''}`}>
                  ✕
                </span>
              ))}
            </span>
            {frame.drawer === seat && !faceUp && (
              <span className="demo__peek">
                <CharacterCard id={frame.card} size="sm" />
              </span>
            )}
          </div>
        ))}
        <div className="demo__middle">
          <div className="demo__card" key={`${frame.card}-${faceUp}`}>
            <CharacterCard id={faceUp ? frame.card : null} size="sm" />
            {frame.stamp && (
              <span className={`stamp demo__stamp${frame.stamp === 'discard' ? ' stamp--void' : ''}`}>
                {t(frame.stamp === 'sold' ? 'board.sold' : 'board.discarded')}
              </span>
            )}
          </div>
          <p className="demo__bid" key={`bid-${step}`}>
            {frame.bid ? (
              <>
                <span className="price pop">{money(frame.bid.amount)}</span>{' '}
                <span className={`seat${frame.bid.by}`}>{NAMES[frame.bid.by]}</span>
              </>
            ) : (
              t('board.noBid')
            )}
          </p>
          {frame.passed && (
            <p className={`demo__pass${frame.passed.costs ? ' demo__pass--costs' : ''}`} key={`pass-${step}`}>
              {t(frame.passed.costs ? 'demo.skip' : 'demo.free', { name: NAMES[frame.passed.seat] })}
            </p>
          )}
        </div>
      </div>
      <figcaption className="demo__caption" aria-live="polite">
        {t(frame.caption, { strong: getCharacter(STRONG).name, weak: getCharacter(WEAK).name })}
      </figcaption>
      <div className="demo__controls">
        <button type="button" className="chip" onClick={() => setPlaying((p) => !p)}>
          {t(playing ? 'demo.pause' : 'demo.play')}
        </button>
        <span className="demo__dots">
          {FRAMES.map((_, i) => (
            <button
              key={i}
              type="button"
              className={`demo__dot${i === step ? ' demo__dot--on' : ''}`}
              aria-label={t('demo.step', { n: i + 1 })}
              onClick={() => {
                setStep(i);
                setPlaying(false);
              }}
            />
          ))}
        </span>
      </div>
    </figure>
  );
}

/** Two teams as bars: one great card nearly outweighs three very good ones. */
function PowerDiagram() {
  const { t } = useI18n();
  const universe = 'dragon-ball';
  const teams = [
    { name: 'Ana', ids: [slug('Beerus'), slug('Bulma'), slug('Yamcha')] },
    { name: 'Ben', ids: [slug('Goku'), slug('Vegeta'), slug('Gohan')] },
  ];
  return (
    <div className="diagram" aria-hidden="true">
      {teams.map((team) => (
        <div key={team.name} className="diagram__team">
          <strong>{team.name}</strong>
          {team.ids.map((id) => {
            const power = powerIn(getCharacter(id), universe);
            return (
              <span key={id} className="diagram__bar" style={{ '--w': `${power}%` } as CSSProperties}>
                <span>{getCharacter(id).name}</span>
                <b>{power}</b>
              </span>
            );
          })}
        </div>
      ))}
      <p className="note">
        {t('rules.power.diagram', {
          a: (teamPower(teams[0].ids.map((id) => getCharacter(id).power)) * scaleFactor(universe)).toFixed(1),
          b: (teamPower(teams[1].ids.map((id) => getCharacter(id).power)) * scaleFactor(universe)).toFixed(1),
        })}
      </p>
    </div>
  );
}

const SECTIONS: Array<{ title: StringKey; items: StringKey[]; extra?: 'passes' | 'power' | 'clock' }> = [
  { title: 'rules.h.round', items: ['rules.1', 'rules.2', 'rules.3', 'rules.4', 'rules.5', 'rules.6'] },
  { title: 'rules.h.passes', items: ['rules.p1', 'rules.p2', 'rules.p3'], extra: 'passes' },
  { title: 'rules.h.power', items: ['rules.v1', 'rules.v2', 'rules.v3'], extra: 'power' },
  { title: 'rules.h.online', items: ['rules.o1', 'rules.o2', 'rules.o3', 'rules.o4'], extra: 'clock' },
  { title: 'rules.h.end', items: ['rules.7', 'rules.e2'] },
];

export function Rules() {
  const { t } = useI18n();
  return (
    <main className="page">
      <h1 className="display">{t('rules.title')}</h1>
      <DemoRound />
      {SECTIONS.map((section) => (
        <section key={section.title} className="rules__section">
          <h2>{t(section.title)}</h2>
          {section.extra === 'passes' && (
            <p className="passes passes--big" aria-hidden="true">
              <span className="passes__x passes__x--used">✕</span>
              <span className="passes__x passes__x--used">✕</span>
              <span className="passes__x">✕</span>
              <span className="rules__aside">{t('rules.p.diagram')}</span>
            </p>
          )}
          <ul className="rules">
            {section.items.map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ul>
          {section.extra === 'power' && <PowerDiagram />}
          {section.extra === 'clock' && (
            <div className="clockdemo" aria-hidden="true">
              <span className="clockdemo__ring" />
              <span className="clockdemo__label">30 s</span>
              <span className="rules__aside">{t('rules.o.diagram')}</span>
            </div>
          )}
        </section>
      ))}
      <div className="form__actions">
        <button type="button" className="btn" onClick={() => navigate('/characters')}>
          {t('home.characters')}
        </button>
        <button type="button" className="btn btn--primary" onClick={() => navigate('/')}>
          {t('setup.back')}
        </button>
      </div>
    </main>
  );
}
