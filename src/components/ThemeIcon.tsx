/**
 * The theme switch's icon: a sun in light mode that turns into a crescent moon
 * in dark mode. The sun spins as its rays fold in and it shrinks away while
 * the moon turns in to take its place (styles: `.theme-icon` in styles.css,
 * driven by the page's `data-theme`). Transforms and opacity only, which every
 * browser animates smoothly on SVG.
 */
export function ThemeIcon() {
  const rays = [0, 45, 90, 135, 180, 225, 270, 315];
  return (
    <svg className="theme-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <g className="theme-icon__sun">
        <circle cx="12" cy="12" r="4.4" fill="currentColor" />
        <g className="theme-icon__rays" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
          {rays.map((angle) => (
            <line key={angle} x1="12" y1="2" x2="12" y2="4.3" transform={`rotate(${angle} 12 12)`} />
          ))}
        </g>
      </g>
      <path className="theme-icon__moon" d="M20.5 13.6A8.6 8.6 0 1 1 10.4 3.5a6.7 6.7 0 0 0 10.1 10.1z" fill="currentColor" />
    </svg>
  );
}
