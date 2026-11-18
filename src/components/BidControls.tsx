import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';

interface Props {
  /** Smallest legal bid right now. */
  min: number;
  /** The bidder's budget. */
  max: number;
  step: number;
  disabled?: boolean;
  onBid(amount: number): void;
  onPass(): void;
  /**
   * Passes left when passing would skip the card (nobody has bid on it yet);
   * `null` when passing only lets the other player have it, which is free.
   */
  passesLeft?: number | null;
  /** Out of passes and nobody has bid: the player has to bid. */
  mustBid?: boolean;
}

const QUICK_RAISES = [50, 100];

export function BidControls({ min, max, step, disabled, onBid, onPass, passesLeft = null, mustBid = false }: Props) {
  const { t, money } = useI18n();
  const [amount, setAmount] = useState(min);

  // A new minimum means the rival just raised: start again from it.
  useEffect(() => setAmount(min), [min]);

  const clamp = (value: number) => Math.min(max, Math.max(min, Math.round(value)));
  const valid = Number.isInteger(amount) && amount >= min && amount <= max;

  return (
    <div className="bid">
      <div className="bid__row">
        <button
          type="button"
          className="btn btn--square"
          onClick={() => setAmount(clamp(amount - step))}
          disabled={disabled || amount <= min}
          aria-label={t('board.less')}
        >
          −
        </button>
        <label className="bid__amount">
          <span className="sr-only">{t('board.amount')}</span>
          <input
            type="number"
            inputMode="numeric"
            min={min}
            max={max}
            step={step}
            value={Number.isFinite(amount) ? amount : ''}
            disabled={disabled}
            onChange={(e) => setAmount(e.target.value === '' ? NaN : Number(e.target.value))}
            onBlur={() => setAmount(clamp(Number.isFinite(amount) ? amount : min))}
          />
          <span aria-hidden="true">M</span>
        </label>
        <button
          type="button"
          className="btn btn--square"
          onClick={() => setAmount(clamp(amount + step))}
          disabled={disabled || amount >= max}
          aria-label={t('board.more')}
        >
          +
        </button>
      </div>

      <div className="bid__quick">
        {QUICK_RAISES.map((raise) => (
          <button
            key={raise}
            type="button"
            className="chip"
            onClick={() => setAmount(clamp((Number.isFinite(amount) ? amount : min) + raise))}
            disabled={disabled || amount >= max}
          >
            +{raise}
          </button>
        ))}
        <button
          type="button"
          className="chip"
          onClick={() => setAmount(max)}
          disabled={disabled || amount === max}
        >
          {t('board.allIn')}
        </button>
      </div>

      {mustBid && <p className="note bid__must">{t('board.pass.none')}</p>}
      <div className="bid__actions">
        <button
          type="button"
          className={`btn${passesLeft !== null ? ' btn--skip' : ''}`}
          onClick={onPass}
          disabled={disabled || mustBid}
        >
          {mustBid
            ? t('board.pass.out')
            : passesLeft !== null
              ? t('board.pass.left', { n: passesLeft })
              : t('board.pass')}
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => valid && onBid(amount)}
          disabled={disabled || !valid}
        >
          {t('board.bid', { amount: money(valid ? amount : min) })}
        </button>
      </div>
    </div>
  );
}
