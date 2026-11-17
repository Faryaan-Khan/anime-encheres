import type { CSSProperties } from 'react';

/** Twelve built-in avatars: a symbol on a colour. No uploads, nothing to moderate. */
export const AVATARS: Array<{ symbol: string; color: string }> = [
  { symbol: '★', color: '#ffd60a' },
  { symbol: '◆', color: '#27a4f2' },
  { symbol: '▲', color: '#ff5a36' },
  { symbol: '●', color: '#3fc46b' },
  { symbol: '✦', color: '#8b6cff' },
  { symbol: '☾', color: '#12b5a6' },
  { symbol: '♠', color: '#ff5d93' },
  { symbol: '♣', color: '#f5b400' },
  { symbol: '♥', color: '#ff8a1f' },
  { symbol: '♦', color: '#7aa8ff' },
  { symbol: '☀', color: '#5fd3c4' },
  { symbol: '✚', color: '#c98a4b' },
];

export function Avatar({ index, size = 'md' }: { index: number; size?: 'sm' | 'md' | 'lg' }) {
  const avatar = AVATARS[index] ?? AVATARS[0];
  return (
    <span className={`avatar avatar--${size}`} style={{ '--spot': avatar.color } as CSSProperties} aria-hidden="true">
      {avatar.symbol}
    </span>
  );
}
