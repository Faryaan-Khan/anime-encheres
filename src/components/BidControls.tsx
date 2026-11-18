import { useEffect, useState, type CSSProperties } from 'react';
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
  /**
   * With `mustBid`: seconds before the minimum is bid for the player (the
   * server does it online, the game offline). Shown draining on the bid button.
   */
  autoBidIn?: number;
}

const QUICK_RAISES = [50, 100];

export function BidControls({
  min,
  max,
  step,
  disabled,
  onBid,
  onPass,
  passesLeft = null,
  mustBid = false,
  autoBidIn,
}: Props) {
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
        {mustBid && autoBidIn !== undefined ? (
          <AutoBidButton
            seconds={autoBidIn}
            label={t('board.bid', { amount: money(valid ? amount : min) })}
            disabled={Boolean(disabled) || !valid}
            onClick={() => valid && onBid(amount)}
          />
        ) : (
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => valid && onBid(amount)}
            disabled={disabled || !valid}
          >
            {t('board.bid', { amount: money(valid ? amount : min) })}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The bid button when the player has to bid: a bar drains across it until the
 * minimum is bid for them. Display only: the bid itself is made by the server
 * online and by the game offline.
 */
function AutoBidButton({
  seconds,
  label,
  disabled,
  onClick,
}: {
  seconds: number;
  label: string;
  disabled: boolean;
  onClick(): void;
}) {
  // Fixed when the button appears: later refreshes of the view must not
  // restart the countdown.
  const [total] = useState(() => Math.max(0, seconds));
  const [left, setLeft] = useState(Math.ceil(total));
  useEffect(() => {
    const start = Date.now();
    const timer = window.setInterval(() => {
      setLeft(Math.max(0, Math.ceil(total - (Date.now() - start) / 1000)));
    }, 200);
    return () => window.clearInterval(timer);
  }, [total]);
  return (
    <button
      type="button"
      className="btn btn--primary btn--countdown"
      style={{ '--countdown': `${total}s` } as CSSProperties}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="btn--countdown__bar" aria-hidden="true" />
      <span className="btn--countdown__label">
        {label}
        {left > 0 && <span className="btn--countdown__left"> · {left}</span>}
      </span>
    </button>
  );
}
