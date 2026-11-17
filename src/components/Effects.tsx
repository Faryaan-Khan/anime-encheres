/** Small visual effects: confetti and a number that counts up. */
import { useEffect, useMemo, useState, type CSSProperties } from 'react';

const reducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

const COLORS = ['#ffd60a', '#ff5a36', '#2f5bff', '#3fc46b', '#8b6cff', '#ff5d93', '#ffffff'];

/** A burst of paper confetti over the whole screen. */
export function Confetti({ pieces = 70 }: { pieces?: number }) {
  const bits = useMemo(
    () =>
      Array.from({ length: pieces }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.6,
        duration: 1.8 + Math.random() * 1.6,
        drift: (Math.random() - 0.5) * 160,
        spin: (Math.random() - 0.5) * 1440,
        color: COLORS[i % COLORS.length],
        wide: Math.random() < 0.5,
      })),
    [pieces],
  );
  if (reducedMotion()) return null;
  return (
    <div className="confetti" aria-hidden="true">
      {bits.map((b, i) => (
        <i
          key={i}
          className={b.wide ? 'wide' : undefined}
          style={
            {
              left: `${b.left}%`,
              background: b.color,
              animationDelay: `${b.delay}s`,
              animationDuration: `${b.duration}s`,
              '--drift': `${b.drift}px`,
              '--spin': `${b.spin}deg`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

/** Counts from `from` to `to` over `ms`, easing out. */
export function CountUp({ from = 0, to, ms = 900, onDone }: { from?: number; to: number; ms?: number; onDone?(): void }) {
  const [value, setValue] = useState(reducedMotion() ? to : from);
  useEffect(() => {
    if (reducedMotion()) {
      setValue(to);
      onDone?.();
      return;
    }
    let frame = 0;
    const start = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / ms);
      const eased = 1 - (1 - k) ** 3;
      setValue(Math.round(from + (to - from) * eased));
      if (k < 1) frame = requestAnimationFrame(step);
      else onDone?.();
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, ms]);
  return <>{value}</>;
}
