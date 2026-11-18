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
- **Universe power** is what players see in a game of one universe: the same rating on
  that universe's own 0–100 scale, where its strongest character is 100 and everyone else
  keeps the same proportion (power × 100 ÷ strongest, rounded). It is display only: the
  verdict always uses the shared power, so a game plays the same whichever scale it is
  shown on. Mixed games show the shared power.
- **Tier** (S to D) is relative to the strongest character of the same universe, so it
  says how good a card is in a single-universe game: S is within 7% of the top, A within
  18%, B within 34%, C within 55%, D below that.

## What these ratings are not

They are opinions. Canon rarely settles who beats whom: fights are situational, wins are
not transitive, and comparing universes is guesswork. The scale deliberately compresses
the gap between universes so that a mixed game stays playable; a strict reading of feats
would put most of Dragon Ball above everything else. Change any number you disagree with.

## Roster sizes

| Universe | Characters | Strongest | Weakest | S | A | B | C | D |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Dragon Ball | 52 | 100 | 2 | 9 | 15 | 10 | 6 | 12 |
| One Piece | 62 | 58 | 4 | 9 | 17 | 20 | 12 | 4 |
| Naruto | 58 | 65 | 15 | 5 | 5 | 23 | 21 | 4 |
| Jujutsu Kaisen | 40 | 48 | 3 | 2 | 9 | 19 | 5 | 5 |
| Bleach | 49 | 62 | 2 | 4 | 19 | 18 | 5 | 3 |
| Hunter × Hunter | 35 | 42 | 1 | 2 | 9 | 17 | 4 | 3 |
| Demon Slayer | 30 | 33 | 2 | 2 | 2 | 15 | 9 | 2 |
| **Total** | **326** | | | | | | | |

## Dragon Ball

| # | Overall | Character | Power | Universe power | Tier | Why |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | Zeno | 100 | 100 | S | Omni-King; erases whole universes at will |
| 2 | 2 | Grand Priest | 99 | 99 | S | Strongest angel, father of Whis |
| 3 | 3 | Whis | 97 | 97 | S | Angel who trains Beerus, Goku and Vegeta |
| 4 | 4 | Vados | 96 | 96 | S | Universe 6's angel, on Whis's level |
| 5 | 5 | Beerus | 95 | 95 | S | God of Destruction of Universe 7 |
| 6 | 7 | Gogeta | 94 | 94 | S | Fusion that overpowered full-power Broly |
| 7 | 6 | Frieza | 94 | 94 | S | Black Frieza dropped Ultra Instinct Goku and Ultra Ego Vegeta |
| 8 | 8 | Champa | 93 | 93 | S | God of Destruction of Universe 6, a step below Beerus |
| 9 | 9 | Vegito | 93 | 93 | S | Potara fusion that outclassed Fused Zamasu |
| 10 | 11 | Jiren | 92 | 92 | A | Said to surpass his universe's God of Destruction |
| 11 | 10 | Goku | 92 | 92 | A | Mastered Ultra Instinct |
| 12 | 12 | Broly | 91 | 91 | A | Full-power Super Saiyan; needed Gogeta to stop him |
| 13 | 14 | Vegeta | 91 | 91 | A | Ultra Ego |
| 14 | 13 | Gohan | 91 | 91 | A | Beast form |
| 15 | 15 | Zamasu | 90 | 90 | A | Fused Zamasu: immortal body with Goku Black's power |
| 16 | 16 | Goku Black | 88 | 88 | A | Super Saiyan Rosé |
| 17 | 17 | Toppo | 88 | 88 | A | God of Destruction mode |
| 18 | 18 | Kefla | 87 | 87 | A | Fusion that pushed Ultra Instinct Goku |
| 19 | 20 | Piccolo | 85 | 85 | A | Orange Piccolo |
| 20 | 19 | Hit | 85 | 85 | A | Time-skipping assassin of Universe 6 |
| 21 | 21 | Android 17 | 84 | 84 | A | Won the Tournament of Power |
| 22 | 22 | Kale | 83 | 83 | A | Berserker Super Saiyan |
| 23 | 23 | Dyspo | 82 | 82 | A | Fastest fighter of Universe 11 |
| 24 | 24 | Future Trunks | 82 | 82 | A | Super Saiyan Rage |
| 25 | 25 | Caulifla | 80 | 80 | B | Super Saiyan 2 prodigy |
| 26 | 26 | Android 18 | 79 | 79 | B | Infinite energy; lasted deep into the Tournament of Power |
| 27 | 27 | Cabba | 78 | 78 | B | Universe 6 Saiyan, Super Saiyan 2 |
| 28 | 28 | Gotenks | 76 | 76 | B | Super Saiyan 3 fusion |
| 29 | 29 | Kid Buu | 75 | 75 | B | Pure, unrestrained Buu |
| 30 | 30 | Frost | 74 | 74 | B | Universe 6's Frieza counterpart |
| 31 | 31 | Majin Buu | 72 | 72 | B | Good Buu; absorbs almost any damage |
| 32 | 32 | Cell | 68 | 68 | B | Perfect form |
| 33 | 33 | Goten | 66 | 66 | B | Super Saiyan as a child |
| 34 | 34 | Trunks | 66 | 66 | B | Super Saiyan as a child |
| 35 | 39 | Dabura | 62 | 62 | C | Demon king on Cell's level |
| 36 | 42 | Android 16 | 60 | 60 | C | Matched imperfect Cell |
| 37 | 50 | Supreme Kai | 58 | 58 | C | Stronger than Frieza was on Namek |
| 38 | 76 | King Cold | 52 | 52 | C | Frieza's father |
| 39 | 122 | Krillin | 47 | 47 | C | Strongest pure human |
| 40 | 126 | Tien | 47 | 47 | C | Tri-Beam specialist |
| 41 | 147 | Captain Ginyu | 44 | 44 | D | Body-swapping leader of the Ginyu Force |
| 42 | 154 | Master Roshi | 43 | 43 | D | Held his own in the Tournament of Power |
| 43 | 174 | Bardock | 40 | 40 | D | Goku's father, a low-class warrior |
| 44 | 184 | Yamcha | 40 | 40 | D | Wolf Fang Fist |
| 45 | 200 | Zarbon | 38 | 38 | D | Frieza's right-hand man |
| 46 | 216 | Nappa | 36 | 36 | D | Elite Saiyan who wiped out the Z fighters |
| 47 | 261 | Raditz | 30 | 30 | D | Goku's brother, first Saiyan invader |
| 48 | 267 | Chiaotzu | 28 | 28 | D | Telekinesis, little else |
| 49 | 296 | Yajirobe | 22 | 22 | D | Cut off Vegeta's tail, then hid |
| 50 | 307 | Videl | 18 | 18 | D | Strong for a human, learned to fly |
| 51 | 318 | Mr. Satan | 6 | 6 | D | World champion by reputation only |
| 52 | 323 | Bulma | 2 | 2 | D | Genius inventor, not a fighter |

## One Piece

| # | Overall | Character | Power | Universe power | Tier | Why |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 48 | Imu | 58 | 100 | S | Ruler of the world; shown above Gear 5 Luffy even while weakened |
| 2 | 56 | Rocks D. Xebec | 56 | 97 | S | Took Roger and Garp together to bring down |
| 3 | 57 | Gol D. Roger | 55 | 95 | S | King of the Pirates |
| 4 | 62 | Whitebeard | 55 | 95 | S | Strongest man in the world in his prime |
| 5 | 61 | Shanks | 55 | 95 | S | Emperor with top-class Conqueror's Haki |
| 6 | 59 | Monkey D. Luffy | 55 | 95 | S | Gear 5; defeated Kaido |
| 7 | 68 | Monkey D. Garp | 54 | 93 | S | Hero of the Marines, Roger's rival |
| 8 | 63 | Kaido | 54 | 93 | S | Strongest creature; fell only to Gear 5 |
| 9 | 67 | Loki | 54 | 93 | S | Prince of Elbaf with a god-class dragon fruit |
| 10 | 70 | Big Mom | 53 | 91 | A | Emperor; needed Law and Kid together |
| 11 | 71 | Blackbeard | 53 | 91 | A | Emperor with two Devil Fruits |
| 12 | 72 | Dracule Mihawk | 53 | 91 | A | World's strongest swordsman |
| 13 | 83 | Silvers Rayleigh | 52 | 90 | A | Roger's right hand, in his prime |
| 14 | 77 | Kozuki Oden | 52 | 90 | A | Gave Kaido his only scar |
| 15 | 73 | Akainu | 52 | 90 | A | Fleet Admiral; magma |
| 16 | 80 | Monkey D. Dragon | 52 | 90 | A | World's most wanted man; feats still unseen |
| 17 | 91 | Saint Jaygarcia Saturn | 51 | 88 | A | One of the Five Elders; regenerates from anything shown |
| 18 | 92 | Sengoku | 51 | 88 | A | Former Fleet Admiral, the Buddha |
| 19 | 90 | Kizaru | 51 | 88 | A | Admiral; light |
| 20 | 84 | Aokiji | 51 | 88 | A | Former admiral; ice |
| 21 | 98 | Fujitora | 50 | 86 | A | Admiral; gravity |
| 22 | 102 | Ryokugyu | 50 | 86 | A | Admiral; forest |
| 23 | 97 | Benn Beckman | 50 | 86 | A | Shanks's first mate |
| 24 | 109 | Roronoa Zoro | 49 | 84 | A | King of Hell style; beat King |
| 25 | 119 | Trafalgar Law | 48 | 83 | A | Awakened Ope Ope no Mi |
| 26 | 111 | Eustass Kid | 48 | 83 | A | Awakened magnetism |
| 27 | 127 | Yamato | 47 | 81 | B | Held off Kaido alone |
| 28 | 137 | Sanji | 46 | 79 | B | Ifrit Jambe; beat Queen |
| 29 | 131 | King | 46 | 79 | B | Kaido's right hand |
| 30 | 129 | Charlotte Katakuri | 46 | 79 | B | Big Mom's strongest son; future sight |
| 31 | 132 | Marco | 46 | 79 | B | Phoenix; held off King and Queen |
| 32 | 135 | Sabo | 46 | 79 | B | Revolutionary Army chief of staff; Flame-Flame Fruit |
| 33 | 144 | Shiryu | 45 | 78 | B | Blackbeard's swordsman, invisible |
| 34 | 149 | Portgas D. Ace | 44 | 76 | B | Whitebeard's 2nd division commander |
| 35 | 146 | Boa Hancock | 44 | 76 | B | Conqueror's Haki and petrification |
| 36 | 145 | Bartholomew Kuma | 44 | 76 | B | Paw-Paw Fruit; former Warlord |
| 37 | 152 | Donquixote Doflamingo | 43 | 74 | B | Awakened String-String Fruit |
| 38 | 156 | Rob Lucci | 43 | 74 | B | Awakened Zoan; fought Gear 5 |
| 39 | 155 | Queen | 43 | 74 | B | Kaido's All-Star, cyborg brachiosaurus |
| 40 | 159 | Jinbe | 42 | 72 | B | Fish-Man Karate master |
| 41 | 168 | Killer | 41 | 71 | B | Kid's first mate |
| 42 | 167 | Enel | 41 | 71 | B | Logia lightning; ruled Skypiea |
| 43 | 170 | Magellan | 41 | 71 | B | Impel Down's poison warden |
| 44 | 183 | X Drake | 40 | 69 | B | Ancient Zoan, Marine spy |
| 45 | 176 | Crocodile | 40 | 69 | B | Sand Logia; former Warlord |
| 46 | 185 | Gecko Moria | 39 | 67 | B | Shadow-stealing former Warlord |
| 47 | 193 | Koby | 38 | 66 | C | Marine rising star; Honesty Impact |
| 48 | 189 | Emporio Ivankov | 38 | 66 | C | Hormone fruit; Revolutionary commander |
| 49 | 204 | Franky | 37 | 64 | C | Cyborg shipwright |
| 50 | 217 | Nico Robin | 36 | 62 | C | Demonio Fleur |
| 51 | 210 | Brook | 36 | 62 | C | Soul King |
| 52 | 221 | Smoker | 36 | 62 | C | Smoke Logia vice admiral |
| 53 | 227 | Carrot | 34 | 59 | C | Sulong form |
| 54 | 244 | Tony Tony Chopper | 33 | 57 | C | Monster Point |
| 55 | 236 | Bartolomeo | 33 | 57 | C | Barrier fruit |
| 56 | 264 | Nami | 29 | 50 | C | Weather control with Zeus |
| 57 | 274 | Usopp | 28 | 48 | C | Sniper; Observation Haki |
| 58 | 271 | Perona | 28 | 48 | C | Negative Hollows |
| 59 | 279 | Bon Clay | 26 | 45 | D | Okama Kenpo |
| 60 | 302 | Buggy | 20 | 34 | D | Emperor by accident |
| 61 | 311 | Arlong | 15 | 26 | D | East Blue fish-man boss |
| 62 | 320 | Nefertari Vivi | 4 | 7 | D | Princess of Alabasta, not a fighter |

## Naruto

| # | Overall | Character | Power | Universe power | Tier | Why |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 35 | Kaguya Otsutsuki | 65 | 100 | S | Progenitor of chakra; had to be sealed |
| 2 | 36 | Hagoromo Otsutsuki | 64 | 98 | S | Sage of Six Paths |
| 3 | 37 | Naruto Uzumaki | 63 | 97 | S | Six Paths Sage Mode |
| 4 | 38 | Sasuke Uchiha | 63 | 97 | S | Rinnegan with Six Paths power |
| 5 | 40 | Madara Uchiha | 62 | 95 | S | Ten-Tails jinchuriki |
| 6 | 44 | Obito Uchiha | 60 | 92 | A | Ten-Tails jinchuriki |
| 7 | 46 | Might Guy | 59 | 91 | A | Eighth Gate nearly killed Madara |
| 8 | 49 | Kurama | 58 | 89 | A | The Nine-Tailed Fox |
| 9 | 53 | Hashirama Senju | 56 | 86 | A | God of Shinobi |
| 10 | 64 | Kakashi Hatake | 54 | 83 | A | Double Mangekyo Susanoo, briefly |
| 11 | 81 | Pain | 52 | 80 | B | Flattened the Hidden Leaf |
| 12 | 79 | Minato Namikaze | 52 | 80 | B | Fourth Hokage, Flying Thunder God |
| 13 | 88 | Hiruzen Sarutobi | 51 | 78 | B | Third Hokage in his prime |
| 14 | 89 | Kabuto Yakushi | 51 | 78 | B | Sage Mode |
| 15 | 100 | Itachi Uchiha | 50 | 77 | B | Susanoo with the Totsuka Blade |
| 16 | 103 | Tobirama Senju | 50 | 77 | B | Second Hokage |
| 17 | 101 | Killer Bee | 50 | 77 | B | Perfect Eight-Tails jinchuriki |
| 18 | 105 | A (Fourth Raikage) | 49 | 75 | B | Lightning armour, speed near Minato |
| 19 | 107 | Onoki | 49 | 75 | B | Third Tsuchikage, Dust Release |
| 20 | 114 | Jiraiya | 48 | 74 | B | Sannin, Sage Mode |
| 21 | 112 | Gaara | 48 | 74 | B | Fifth Kazekage |
| 22 | 115 | Kisame Hoshigaki | 48 | 74 | B | The tailless tailed beast |
| 23 | 117 | Shisui Uchiha | 48 | 74 | B | Kotoamatsukami |
| 24 | 123 | Orochimaru | 47 | 72 | B | Sannin, near-immortal |
| 25 | 121 | Hanzo | 47 | 72 | B | Beat all three Sannin in his prime |
| 26 | 138 | Tsunade | 46 | 71 | B | Fifth Hokage, Strength of a Hundred |
| 27 | 130 | Danzo Shimura | 46 | 71 | B | Izanagi and Shisui's eye |
| 28 | 139 | Deidara | 45 | 69 | B | Explosive clay |
| 29 | 143 | Sasori | 45 | 69 | B | Puppet master with a hundred puppets |
| 30 | 140 | Kakuzu | 45 | 69 | B | Five hearts |
| 31 | 148 | Mei Terumi | 44 | 68 | B | Fifth Mizukage |
| 32 | 150 | Sakura Haruno | 44 | 68 | B | Strength of a Hundred Seal |
| 33 | 153 | Konan | 43 | 66 | B | Six hundred billion paper bombs |
| 34 | 158 | Darui | 42 | 65 | C | Black lightning |
| 35 | 161 | Kimimaro | 42 | 65 | C | Orochimaru's strongest follower |
| 36 | 166 | Chiyo | 41 | 63 | C | Veteran puppet master |
| 37 | 178 | Hidan | 40 | 62 | C | Immortal, curse ritual |
| 38 | 175 | Captain Yamato | 40 | 62 | C | Wood Release |
| 39 | 173 | Asuma Sarutobi | 40 | 62 | C | Wind chakra blades |
| 40 | 181 | Rock Lee | 40 | 62 | C | Taijutsu and the inner gates |
| 41 | 196 | Neji Hyuga | 38 | 58 | C | Byakugan prodigy |
| 42 | 199 | Zabuza Momochi | 38 | 58 | C | Demon of the Hidden Mist |
| 43 | 192 | Jugo | 38 | 58 | C | Source of the curse mark |
| 44 | 201 | Choji Akimichi | 37 | 57 | C | Butterfly mode |
| 45 | 219 | Shikamaru Nara | 36 | 55 | C | Strategist who beat Hidan |
| 46 | 222 | Temari | 36 | 55 | C | Wind style |
| 47 | 226 | Suigetsu Hozuki | 35 | 54 | C | Liquid body |
| 48 | 228 | Hinata Hyuga | 34 | 52 | C | Twin Lion Fists |
| 49 | 235 | Shino Aburame | 34 | 52 | C | Insect swarm |
| 50 | 230 | Kankuro | 34 | 52 | C | Puppeteer |
| 51 | 234 | Sai | 34 | 52 | C | Ink beasts |
| 52 | 239 | Haku | 33 | 51 | C | Ice mirrors |
| 53 | 252 | Kiba Inuzuka | 31 | 48 | C | Fights alongside Akamaru |
| 54 | 254 | Ino Yamanaka | 30 | 46 | C | Mind transfer |
| 55 | 269 | Konohamaru Sarutobi | 28 | 43 | D | Learned the Rasengan young |
| 56 | 280 | Tenten | 26 | 40 | D | Weapons specialist |
| 57 | 293 | Karin | 22 | 34 | D | Sensor and healer |
| 58 | 312 | Iruka Umino | 15 | 23 | D | Academy teacher |

## Jujutsu Kaisen

| # | Overall | Character | Power | Universe power | Tier | Why |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 116 | Ryomen Sukuna | 48 | 100 | S | King of Curses; killed Gojo |
| 2 | 124 | Satoru Gojo | 47 | 98 | S | Limitless and the Six Eyes |
| 3 | 157 | Yuta Okkotsu | 43 | 90 | A | Copy and Rika |
| 4 | 164 | Yuji Itadori | 42 | 88 | A | End of series; finished Sukuna |
| 5 | 160 | Kenjaku | 42 | 88 | A | Centuries of stolen techniques |
| 6 | 165 | Yuki Tsukumo | 42 | 88 | A | Special grade; mass |
| 7 | 172 | Toji Fushiguro | 41 | 85 | A | Zero cursed energy; nearly killed young Gojo |
| 8 | 171 | Maki Zenin | 41 | 85 | A | Awakened to Toji's level |
| 9 | 169 | Kinji Hakari | 41 | 85 | A | Jackpot makes him unkillable |
| 10 | 182 | Suguru Geto | 40 | 83 | A | Special grade curse manipulator |
| 11 | 177 | Hajime Kashimo | 40 | 83 | A | Strongest sorcerer of his era |
| 12 | 188 | Yorozu | 39 | 81 | B | Heian-era construction user |
| 13 | 187 | Ryu Ishigori | 39 | 81 | B | Highest cursed energy output |
| 14 | 198 | Takako Uro | 38 | 79 | B | Bends the sky |
| 15 | 194 | Mahito | 38 | 79 | B | Reshapes souls |
| 16 | 191 | Jogo | 38 | 79 | B | Volcano curse |
| 17 | 190 | Hiromi Higuruma | 38 | 79 | B | Courtroom domain; a genius beginner |
| 18 | 202 | Choso | 37 | 77 | B | Blood manipulation |
| 19 | 207 | Uraume | 37 | 77 | B | Sukuna's ice-wielding servant |
| 20 | 214 | Megumi Fushiguro | 36 | 75 | B | Ten Shadows |
| 21 | 209 | Aoi Todo | 36 | 75 | B | Boogie Woogie |
| 22 | 212 | Hanami | 36 | 75 | B | Forest curse |
| 23 | 211 | Hana Kurusu | 36 | 75 | B | Host of Angel; nullifies techniques |
| 24 | 215 | Miguel | 36 | 75 | B | Stalled Gojo for minutes |
| 25 | 224 | Naoya Zenin | 35 | 73 | B | Projection Sorcery |
| 26 | 223 | Fumihiko Takaba | 35 | 73 | B | Whatever he finds funny comes true |
| 27 | 233 | Naobito Zenin | 34 | 71 | B | Fastest sorcerer after Gojo |
| 28 | 240 | Kento Nanami | 33 | 69 | B | Grade 1; Ratio |
| 29 | 248 | Mei Mei | 32 | 67 | B | Grade 1; crows |
| 30 | 247 | Atsuya Kusakabe | 32 | 67 | B | Strongest grade 1 without a technique |
| 31 | 253 | Mechamaru | 31 | 65 | C | Kokichi Muta's puppets |
| 32 | 262 | Toge Inumaki | 30 | 63 | C | Cursed Speech |
| 33 | 260 | Panda | 30 | 63 | C | Three cores |
| 34 | 265 | Noritoshi Kamo | 29 | 60 | C | Blood manipulation |
| 35 | 270 | Nobara Kugisaki | 28 | 58 | C | Straw Doll, Resonance |
| 36 | 303 | Mai Zenin | 20 | 42 | D | Can construct one bullet a day |
| 37 | 304 | Utahime Iori | 20 | 42 | D | Amplifies allies |
| 38 | 313 | Kasumi Miwa | 15 | 31 | D | Simple Domain |
| 39 | 315 | Junpei Yoshino | 12 | 25 | D | Had only just awakened |
| 40 | 322 | Kiyotaka Ijichi | 3 | 6 | D | Assistant manager |

## Bleach

| # | Overall | Character | Power | Universe power | Tier | Why |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 41 | Yhwach | 62 | 100 | S | The Almighty: sees and rewrites the future |
| 2 | 43 | Ichigo Kurosaki | 60 | 97 | S | True Zangetsu |
| 3 | 45 | Sosuke Aizen | 60 | 97 | S | Fused with the Hogyoku; cannot be killed |
| 4 | 47 | Ichibe Hyosube | 58 | 94 | S | Leader of Squad Zero; controls names |
| 5 | 51 | Genryusai Yamamoto | 57 | 92 | A | Zanka no Tachi |
| 6 | 54 | Jugram Haschwalth | 56 | 90 | A | The Balance; Yhwach's other half |
| 7 | 55 | Kenpachi Zaraki | 56 | 90 | A | Bankai |
| 8 | 52 | Gerard Valkyrie | 56 | 90 | A | The Miracle |
| 9 | 58 | Gremmy Thoumeaux | 55 | 89 | A | Whatever he imagines becomes real |
| 10 | 60 | Senjumaru Shutara | 55 | 89 | A | Squad Zero; bankai |
| 11 | 66 | Lille Barro | 54 | 87 | A | The X-Axis |
| 12 | 65 | Kisuke Urahara | 54 | 87 | A | Bankai restructures anything |
| 13 | 69 | Shunsui Kyoraku | 54 | 87 | A | Captain-Commander; bankai |
| 14 | 82 | Retsu Unohana | 52 | 84 | A | The first Kenpachi |
| 15 | 78 | Mayuri Kurotsuchi | 52 | 84 | A | Prepared for everything |
| 16 | 75 | Isshin Kurosaki | 52 | 84 | A | Former captain, Ichigo's father |
| 17 | 74 | Askin Nakk Le Vaar | 52 | 84 | A | The Deathdealing |
| 18 | 86 | Byakuya Kuchiki | 51 | 82 | A | Senbonzakura Kageyoshi |
| 19 | 93 | Toshiro Hitsugaya | 51 | 82 | A | Completed bankai |
| 20 | 87 | Coyote Starrk | 51 | 82 | A | Primera Espada |
| 21 | 85 | Baraggan Louisenbairn | 51 | 82 | A | Segunda Espada; ages all he touches |
| 22 | 94 | Ulquiorra Cifer | 51 | 82 | A | Segunda Etapa |
| 23 | 95 | Uryu Ishida | 51 | 82 | A | The Antithesis |
| 24 | 99 | Gin Ichimaru | 50 | 81 | B | Bankai extends at absurd speed |
| 25 | 104 | Yoruichi Shihoin | 50 | 81 | B | Goddess of Flash |
| 26 | 96 | As Nodt | 50 | 81 | B | The Fear |
| 27 | 110 | Rukia Kuchiki | 49 | 79 | B | Bankai: absolute zero |
| 28 | 108 | Renji Abarai | 49 | 79 | B | True bankai |
| 29 | 106 | Jushiro Ukitake | 49 | 79 | B | Veteran captain |
| 30 | 118 | Tier Harribel | 48 | 77 | B | Tercera Espada |
| 31 | 113 | Grimmjow Jaegerjaquez | 48 | 77 | B | Sexta Espada, far stronger later |
| 32 | 125 | Shinji Hirako | 47 | 76 | B | Visored captain; inverts perception |
| 33 | 120 | Bazz-B | 47 | 76 | B | The Heat |
| 34 | 136 | Sajin Komamura | 46 | 74 | B | Humanization bankai |
| 35 | 134 | Nnoitra Gilga | 46 | 74 | B | Quinto Espada, toughest hierro |
| 36 | 133 | Nelliel Tu Odelschwanck | 46 | 74 | B | Former Tercera Espada |
| 37 | 128 | Bambietta Basterbine | 46 | 74 | B | The Explode |
| 38 | 141 | Kaname Tosen | 45 | 73 | B | Hollowfied former captain |
| 39 | 142 | Kensei Muguruma | 45 | 73 | B | Visored captain |
| 40 | 151 | Soi Fon | 44 | 71 | B | Two-strike kill |
| 41 | 163 | Yasutora Sado | 42 | 68 | B | Brazo Derecha de Gigante |
| 42 | 179 | Ikkaku Madarame | 40 | 65 | C | Hides his bankai |
| 43 | 197 | Shuhei Hisagi | 38 | 61 | C | Lieutenant of Squad 9 |
| 44 | 218 | Rangiku Matsumoto | 36 | 58 | C | Lieutenant of Squad 10 |
| 45 | 257 | Momo Hinamori | 30 | 48 | C | Kido specialist |
| 46 | 259 | Orihime Inoue | 30 | 48 | C | Rejects events; not a fighter |
| 47 | 316 | Hanataro Yamada | 10 | 16 | D | Squad 4 healer |
| 48 | 321 | Don Kanonji | 3 | 5 | D | TV spirit medium |
| 49 | 325 | Kon | 2 | 3 | D | A mod soul in a plush lion |

## Hunter × Hunter

| # | Overall | Character | Power | Universe power | Tier | Why |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 162 | Meruem | 42 | 100 | S | Chimera Ant King after absorbing Youpi and Pouf |
| 2 | 180 | Isaac Netero | 40 | 95 | S | Hundred-Type Guanyin Bodhisattva |
| 3 | 186 | Gon Freecss | 39 | 93 | A | Adult form, a one-time vow |
| 4 | 195 | Neferpitou | 38 | 90 | A | Royal Guard; killed Kite |
| 5 | 206 | Menthuthuyoupi | 37 | 88 | A | Royal Guard; raw power |
| 6 | 205 | Ging Freecss | 37 | 88 | A | Top-five Nen user; feats mostly unseen |
| 7 | 208 | Zeno Zoldyck | 37 | 88 | A | Dragon Dive |
| 8 | 203 | Chrollo Lucilfer | 37 | 88 | A | Skill Hunter; killed Hisoka once |
| 9 | 220 | Silva Zoldyck | 36 | 86 | A | Head of the Zoldyck family |
| 10 | 213 | Hisoka Morow | 36 | 86 | A | Bungee Gum |
| 11 | 225 | Shaiapouf | 35 | 83 | A | Royal Guard; splits into clones |
| 12 | 229 | Illumi Zoldyck | 34 | 81 | B | Needle control |
| 13 | 231 | Killua Zoldyck | 34 | 81 | B | Godspeed |
| 14 | 232 | Kurapika | 34 | 81 | B | Emperor Time; deadly against the Troupe |
| 15 | 243 | Razor | 33 | 79 | B | Greed Island game master |
| 16 | 237 | Biscuit Krueger | 33 | 79 | B | Double-star hunter, true form |
| 17 | 245 | Uvogin | 33 | 79 | B | Strongest body in the Troupe |
| 18 | 238 | Feitan Portor | 33 | 79 | B | Rising Sun |
| 19 | 242 | Phinks Magcub | 33 | 79 | B | Ripper Cyclotron |
| 20 | 241 | Kite | 33 | 79 | B | Crazy Slots |
| 21 | 249 | Morel Mackernasey | 32 | 76 | B | Smoke; master tactician |
| 22 | 251 | Franklin Bordeau | 31 | 74 | B | Double Machine Gun |
| 23 | 256 | Machi Komacine | 30 | 71 | B | Nen threads |
| 24 | 258 | Nobunaga Hazama | 30 | 71 | B | Iaido within his En |
| 25 | 263 | Knuckle Bine | 29 | 69 | B | Hakoware bankrupts aura |
| 26 | 266 | Palm Siberia | 29 | 69 | B | Chimera form |
| 27 | 273 | Shizuku Murasaki | 28 | 67 | B | Blinky the vacuum |
| 28 | 272 | Shalnark | 28 | 67 | B | Controls people by antenna |
| 29 | 277 | Kalluto Zoldyck | 27 | 64 | C | Paper techniques |
| 30 | 278 | Alluka Zoldyck | 26 | 62 | C | Nanika grants wishes; not a fighter |
| 31 | 287 | Pakunoda | 24 | 57 | C | Reads memories |
| 32 | 294 | Leorio Paradinight | 22 | 52 | C | Remote punch |
| 33 | 314 | Zushi | 15 | 36 | D | Wing's young student |
| 34 | 319 | Tonpa | 5 | 12 | D | The rookie crusher |
| 35 | 326 | Komugi | 1 | 2 | D | Gungi champion, cannot fight |

## Demon Slayer

| # | Overall | Character | Power | Universe power | Tier | Why |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 246 | Yoriichi Tsugikuni | 33 | 100 | S | Cornered Muzan alone |
| 2 | 250 | Muzan Kibutsuji | 32 | 97 | S | The Demon King |
| 3 | 255 | Kokushibo | 30 | 91 | A | Upper Rank One |
| 4 | 268 | Doma | 28 | 85 | A | Upper Rank Two |
| 5 | 276 | Gyomei Himejima | 27 | 82 | B | Strongest Hashira |
| 6 | 275 | Akaza | 27 | 82 | B | Upper Rank Three |
| 7 | 283 | Tanjiro Kamado | 25 | 76 | B | Sun Breathing with the mark |
| 8 | 282 | Sanemi Shinazugawa | 25 | 76 | B | Wind Hashira |
| 9 | 281 | Giyu Tomioka | 25 | 76 | B | Water Hashira |
| 10 | 285 | Muichiro Tokito | 24 | 73 | B | Mist Hashira; beat Gyokko alone |
| 11 | 286 | Obanai Iguro | 24 | 73 | B | Serpent Hashira |
| 12 | 284 | Kyojuro Rengoku | 24 | 73 | B | Flame Hashira |
| 13 | 290 | Mitsuri Kanroji | 23 | 70 | B | Love Hashira |
| 14 | 291 | Tengen Uzui | 23 | 70 | B | Sound Hashira |
| 15 | 289 | Hantengu | 23 | 70 | B | Upper Rank Four |
| 16 | 288 | Gyutaro | 23 | 70 | B | Upper Rank Six |
| 17 | 292 | Gyokko | 22 | 67 | B | Upper Rank Five |
| 18 | 297 | Zenitsu Agatsuma | 22 | 67 | B | Created a seventh Thunder form |
| 19 | 295 | Nezuko Kamado | 22 | 67 | B | Awakened demon form |
| 20 | 301 | Shinobu Kocho | 21 | 64 | C | Insect Hashira; poison |
| 21 | 298 | Inosuke Hashibira | 21 | 64 | C | Beast Breathing |
| 22 | 300 | Kanao Tsuyuri | 21 | 64 | C | Flower Breathing |
| 23 | 299 | Kaigaku | 21 | 64 | C | New Upper Rank Six |
| 24 | 306 | Genya Shinazugawa | 19 | 58 | C | Gains demon powers by eating them |
| 25 | 305 | Daki | 19 | 58 | C | Shares Upper Rank Six with Gyutaro |
| 26 | 308 | Enmu | 17 | 52 | C | Lower Rank One |
| 27 | 309 | Rui | 16 | 48 | C | Lower Rank Five |
| 28 | 310 | Sakonji Urokodaki | 16 | 48 | C | Former Water Hashira, now old |
| 29 | 317 | Murata | 7 | 21 | D | Ordinary slayer who keeps surviving |
| 30 | 324 | Hotaru Haganezuka | 2 | 6 | D | Swordsmith, not a fighter |
