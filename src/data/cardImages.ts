/**
 * Card pictures, keyed by character id: src/assets/cards/<id>.<ext>.
 *
 * These are pictures of the real characters, for the website only. App builds
 * (App Store, Google Play) must not ship them: build those with
 * VITE_CARD_IMAGES=off, and vite.config.ts swaps this module for
 * cardImages.none.ts, so not one picture ends up in the build.
 */
const modules = import.meta.glob('../assets/cards/*.{png,jpg,jpeg,webp,avif}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

export const cardImages: ReadonlyMap<string, string> = new Map(
  Object.entries(modules).map(([path, url]) => [path.split('/').pop()!.replace(/\.[^.]+$/, ''), url]),
);
