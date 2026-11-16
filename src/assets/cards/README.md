# Card pictures

This folder is empty on purpose: the project ships no artwork.

To show a picture on a card, add an image file named after the character id:

```text
src/assets/cards/goku.webp
src/assets/cards/monkey-d-luffy.png
```

- The id is the character's name in lower case with dashes (`slug()` in
  `src/data/characters.ts`). "Satoru Gojo" becomes `satoru-gojo`.
- Supported formats: `.webp`, `.png`, `.jpg`, `.jpeg`, `.avif`.
- Portrait images work best; they are cropped to fill the art area of the card.
- Pictures are picked up automatically at build time. Characters without a picture keep
  the default card.

Only add images you made yourself or have permission to use. Official artwork and fan art
both belong to their creators.
