# Power ratings

Every character has a **power** from 1 to 100: their strength at their canon peak, on one
scale shared by all universes. The ratings decide the verdict at the end of a game and
are what the computer opponent values cards by. A card's power is shown when it is
revealed, never during the bidding.

This file is generated. Edit `src/data/rosters.json`, then run `npm run ratings`.

## How to read the numbers

- **Peak form counts.** Goku is rated as Ultra Instinct, Ichigo with True Zangetsu, Gon in
  his one-time adult form. A character's weakest arc is ignored.
- **Fighters, not plot devices.** Characters whose power is not combat (Alluka's wishes,
  Orihime's rejection, Bulma's inventions) are rated as fighters.
- **One scale for every anime.** A 50 in One Piece and a 50 in Naruto are meant to be a
  fair fight. Rough anchors:

  | Power | Meaning | Examples |
  | --- | --- | --- |
  | 95–100 | Gods above gods | Zeno, Whis, Beerus |
  | 85–94 | Universe-level fighters | Jiren, Goku, Broly |
  | 60–84 | Planet and star busters | Kaguya, Cell, Yhwach, Android 17 |
  | 45–59 | Top of a grounded world | Shanks, Hashirama, Sukuna, Yamamoto |
  | 30–44 | Elite fighters | Meruem, Doflamingo, Yoriichi, Nanami |
  | 15–29 | Competent, outclassed | Usopp, Leorio, Rui |
  | 1–14 | Should not be in a fight | Mr. Satan, Komugi, Kon |

- **Small gaps matter.** In the verdict, strength doubles every 2.5 points, so a 55 is
  about four times as strong as a 50.
- **Tier** (S to D) is relative to the strongest character of the same universe, so it
  says how good a card is in a single-universe game: S is within 7% of the top, A within
  18%, B within 34%, C within 55%, D below that.

## What these ratings are not

They are opinions. Canon rarely settles who beats whom: fights are situational, wins are
not transitive, and comparing universes is guesswork. The scale deliberately compresses
the gap between universes so that a mixed game stays playable; a strict reading of feats
would put most of Dragon Ball above everything else. Change any number you disagree with.
