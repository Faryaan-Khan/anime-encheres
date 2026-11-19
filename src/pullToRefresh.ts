/**
 * Pull down at the top of a page to reload it.
 *
 * The page never bounces past its ends (overscroll-behavior in styles.css):
 * that keeps the bottom at the footer even after a fast flick, which nothing
 * else can promise on iPhone. It also switches off the browser's own pull to
 * refresh, so this brings it back: an arrow follows the finger down from the
 * top and, past the mark, turns into a reload.
 */
const MARK = 72; // how far to pull, in pixels (after resistance)
const MOST = 110;

export function initPullToRefresh(): void {
  if (typeof window === 'undefined' || !('ontouchstart' in window)) return;
  const badge = document.createElement('div');
  badge.className = 'ptr';
  badge.setAttribute('aria-hidden', 'true');
  badge.innerHTML = '<span class="ptr__arrow">↓</span>';
  document.body.append(badge);

  let startY: number | null = null;
  let pull = 0;

  const show = (distance: number) => {
    const ready = distance >= MARK;
    badge.style.transform = `translate(-50%, ${distance - 56}px) rotate(${ready ? 180 : (distance / MARK) * 150}deg)`;
    badge.style.opacity = String(Math.min(1, distance / (MARK * 0.6)));
    badge.classList.toggle('ptr--ready', ready);
  };
  const reset = () => {
    startY = null;
    pull = 0;
    badge.classList.add('ptr--back');
    show(0);
    window.setTimeout(() => badge.classList.remove('ptr--back'), 250);
  };

  window.addEventListener(
    'touchstart',
    (e) => {
      const target = e.target as Element | null;
      // Not from a card held up close, a dialog, or something that scrolls itself.
      const blocked = target?.closest('dialog, .card--xl, [data-no-pull]');
      if (e.touches.length !== 1 || window.scrollY > 0 || blocked || insideScroller(target)) {
        startY = null;
        return;
      }
      startY = e.touches[0].clientY;
      pull = 0;
    },
    { passive: true },
  );
  window.addEventListener(
    'touchmove',
    (e) => {
      if (startY === null) return;
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0 || window.scrollY > 0) {
        if (pull > 0) reset();
        return;
      }
      pull = Math.min(MOST, dy * 0.45);
      show(pull);
    },
    { passive: true },
  );
  const end = () => {
    if (startY === null) return;
    if (pull >= MARK) {
      badge.classList.add('ptr--loading');
      const arrow = badge.querySelector('.ptr__arrow');
      if (arrow) arrow.textContent = '↻';
      window.location.reload();
      return;
    }
    reset();
  };
  window.addEventListener('touchend', end, { passive: true });
  window.addEventListener('touchcancel', reset, { passive: true });
}

/** True when the touch began inside a box that scrolls on its own and is not at its top. */
function insideScroller(target: Element | null): boolean {
  for (let el = target; el && el !== document.body; el = el.parentElement) {
    const style = getComputedStyle(el);
    if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight && el.scrollTop > 0) return true;
  }
  return false;
}
