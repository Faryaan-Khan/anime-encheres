# Game rules

[English](#english) · [Français](#français)

## English

### Goal

Build a better team of characters than your opponent, using a fictional budget.

### Setup

- Two players. Each starts with the same budget (500M by default).
- Choose a universe (or mix them all) and a team size (5 by default).
- The game deals a face-down deck of four cards per team slot (20 cards for teams of 5).

### A round

1. **Draw.** Players take turns being the drawer. The drawer takes the top card and is the
   only one who sees it.
2. **Bid.** The drawer speaks first. On your turn you either:
   - **bid**: at least 10M to open, then at least 10M more than the current bid, and never
     more than your budget; or
   - **pass**: a pass is final for this card.
3. **Resolve.**
   - When one player has bid and the other passes, the bidder wins the card and pays
     their bid.
   - If the drawer passes without bidding, the other player may take the card at the
     price they choose (10M or more), or pass too.
   - If both players pass, the card is discarded.
4. **Reveal.** The card is always shown to both players at the end of the round.

You are skipped automatically when you have no legal move: your team is full, or you
cannot afford the next bid.

### End of the game

The game ends when both teams are full, when the deck is empty, or when nobody who still
needs characters can afford the minimum bid.

### The verdict

Every character has a power rating (see [POWER_RATINGS.md](POWER_RATINGS.md)); it is shown
when a card is revealed. At the end the game compares the two teams. Strength doubles
every 2.5 points of power and a team's strength is the sum of its members', so the
strongest characters count the most: one 95 beats a 92 and a 91 together. The final screen
shows each team's power and how decisive the win is. The ratings are opinions, so you are
still free to argue.

### Against the computer

Choose "Play against the computer" and a level. The computer follows the same rules and
sees only what a player in its seat would see. "Computer" bids by feel and bluffs now and
then. "Computer, ultra hard" counts the cards that have come out and plays out the rest of
the game in its head before every bid.

### The bluff

Only the drawer knows what the card is worth.

- Drew someone weak? Bid with confidence and let your opponent overpay to "steal" it.
- Drew someone strong? Open low and act bored.
- Not the drawer? Watch how they bid. A big opening bid can be real, or bait.
- Money you do not spend is worthless at the end, but running out early leaves the rest of
  the deck to your opponent at the minimum price.
- One top character is worth more than a team of average ones. Save for the cards that
  decide the game.

## Français

### But du jeu

Composer une meilleure équipe de personnages que ton adversaire avec un budget fictif.

### Mise en place

- Deux joueurs. Chacun commence avec le même budget (500M par défaut).
- Choisissez un univers (ou mélangez tout) et une taille d'équipe (5 par défaut).
- Le jeu distribue une pioche face cachée de quatre cartes par place dans une équipe
  (20 cartes pour des équipes de 5).

### Une manche

1. **Pioche.** Les joueurs piochent à tour de rôle. Celui qui pioche prend la première
   carte et est le seul à la voir.
2. **Enchères.** Celui qui a pioché parle en premier. À ton tour, tu peux :
   - **miser** : au moins 10M pour ouvrir, puis au moins 10M de plus que la mise actuelle,
     sans jamais dépasser ton budget ;
   - **passer** : passer est définitif pour cette carte.
3. **Résolution.**
   - Quand un joueur a misé et que l'autre passe, celui qui a misé remporte la carte et
     paie sa mise.
   - Si celui qui a pioché passe sans miser, l'autre peut prendre la carte au prix qu'il
     fixe (10M ou plus), ou passer aussi.
   - Si les deux joueurs passent, la carte est défaussée.
4. **Révélation.** La carte est toujours montrée aux deux joueurs à la fin de la manche.

Ton tour est sauté automatiquement si tu n'as aucun coup possible : équipe complète, ou
budget insuffisant pour la prochaine mise.

### Fin de partie

La partie se termine quand les deux équipes sont complètes, quand la pioche est vide, ou
quand plus aucun joueur ayant encore besoin de personnages ne peut payer la mise minimale.

### Le verdict

Chaque personnage a une note de puissance (voir [POWER_RATINGS.md](POWER_RATINGS.md)),
affichée quand la carte est révélée. À la fin, le jeu compare les deux équipes. La force
double tous les 2,5 points de puissance et la force d'une équipe est la somme de celles de
ses membres : les plus forts pèsent donc le plus, et un 95 bat un 92 et un 91 réunis.
L'écran final affiche la puissance de chaque équipe et l'ampleur de la victoire. Les notes
restent des avis : vous pouvez toujours débattre.

### Contre l'ordinateur

Choisissez « Jouer contre l'ordinateur » et un niveau. L'ordinateur suit les mêmes règles
et ne voit que ce qu'un joueur à sa place verrait. « Ordinateur » mise au feeling et
bluffe parfois. « Ordinateur ultra » compte les cartes sorties et simule la suite de la
partie avant chaque mise.

### Le bluff

Seul celui qui a pioché connaît la valeur de la carte.

- Tu as pioché un personnage faible ? Mise avec assurance et laisse ton adversaire
  surpayer pour te le « voler ».
- Tu as pioché un personnage fort ? Ouvre bas et fais comme si de rien n'était.
- Tu n'as pas pioché ? Observe la façon de miser de l'autre. Une grosse ouverture peut
  être sincère, ou un piège.
- L'argent non dépensé ne vaut rien à la fin, mais être à sec trop tôt laisse le reste de
  la pioche à ton adversaire au prix minimum.
- Un personnage de tout premier plan vaut plus qu'une équipe de moyens. Garde ton budget
  pour les cartes qui décident de la partie.
