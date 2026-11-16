import { MIX_ID, UNIVERSES, poolFor } from '../data/characters';
import { DEFAULT_SETTINGS } from '../game/engine';
import type { Settings } from '../game/types';
import { useI18n } from '../i18n';

export interface GameOptions {
  universe: string;
  budget: number;
  teamSize: number;
}

export const DEFAULT_OPTIONS: GameOptions = {
  universe: UNIVERSES[0].id,
  budget: DEFAULT_SETTINGS.budget,
  teamSize: DEFAULT_SETTINGS.teamSize,
};

const BUDGETS = [300, 500, 1000];
const TEAM_SIZES = [3, 4, 5, 6, 7];

export function toSettings(options: GameOptions): Settings {
  return { ...DEFAULT_SETTINGS, budget: options.budget, teamSize: options.teamSize };
}

interface Props {
  value: GameOptions;
  onChange(value: GameOptions): void;
}

/** Universe, budget and team size: shared by the same-device and online setup screens. */
export function SettingsFields({ value, onChange }: Props) {
  const { t, money } = useI18n();
  const universes = [...UNIVERSES.map((u) => ({ id: u.id, name: u.name })), { id: MIX_ID, name: t('setup.mix') }];

  return (
    <>
      <fieldset className="field">
        <legend>{t('setup.universe')}</legend>
        <div className="options options--wrap">
          {universes.map((u) => (
            <label key={u.id} className="option">
              <input
                type="radio"
                name="universe"
                checked={value.universe === u.id}
                onChange={() => onChange({ ...value, universe: u.id })}
              />
              <span>
                {u.name}
                <small>{t('setup.characters', { n: poolFor(u.id).length })}</small>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="field">
        <legend>{t('setup.budget')}</legend>
        <div className="options">
          {BUDGETS.map((budget) => (
            <label key={budget} className="option">
              <input
                type="radio"
                name="budget"
                checked={value.budget === budget}
                onChange={() => onChange({ ...value, budget })}
              />
              <span>{money(budget)}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="field">
        <legend>{t('setup.teamSize')}</legend>
        <div className="options">
          {TEAM_SIZES.map((teamSize) => (
            <label key={teamSize} className="option">
              <input
                type="radio"
                name="teamSize"
                checked={value.teamSize === teamSize}
                onChange={() => onChange({ ...value, teamSize })}
              />
              <span>{teamSize}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </>
  );
}
