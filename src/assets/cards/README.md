# Card pictures

Pictures of the real characters, for the **website only**. App builds (App Store, Google
Play) leave them all out: build those with `VITE_CARD_IMAGES=off` (see `vite.config.ts`).
Record every picture in `CREDITS.md`.

To show a picture on a card, add an image file named after the character id:

```text
src/assets/cards/goku.webp
src/assets/cards/monkey-d-luffy.png
```

- The id is the character's name in lower case with dashes (`slug()` in
  `src/data/characters.ts`). "Satoru Gojo" becomes `satoru-gojo`.
- Supported formats: `.webp`, `.png`, `.jpg`, `.jpeg`, `.avif`.
- Portrait images work best (5:7). They are stored as WebP, about 420×588, and cropped to
  fill the art area of the card, keeping the top (the face) in view.
- Pictures are picked up automatically at build time. Characters without a picture keep
  the default card.

Only add images you made yourself or have permission to use. Official artwork and fan art
both belong to their creators.
