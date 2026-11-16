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

| # | Character | Power | Tier | Why |
| --- | --- | --- | --- | --- |
| 1 | Zeno | 100 | S | Omni-King; erases whole universes at will |
| 2 | Grand Priest | 99 | S | Strongest angel, father of Whis |
| 3 | Whis | 97 | S | Angel who trains Beerus, Goku and Vegeta |
| 4 | Vados | 96 | S | Universe 6's angel, on Whis's level |
| 5 | Beerus | 95 | S | God of Destruction of Universe 7 |
| 6 | Gogeta | 94 | S | Fusion that overpowered full-power Broly |
| 7 | Frieza | 94 | S | Black Frieza dropped Ultra Instinct Goku and Ultra Ego Vegeta |
| 8 | Champa | 93 | S | God of Destruction of Universe 6, a step below Beerus |
| 9 | Vegito | 93 | S | Potara fusion that outclassed Fused Zamasu |
| 10 | Jiren | 92 | A | Said to surpass his universe's God of Destruction |
| 11 | Goku | 92 | A | Mastered Ultra Instinct |
| 12 | Broly | 91 | A | Full-power Super Saiyan; needed Gogeta to stop him |
| 13 | Vegeta | 91 | A | Ultra Ego |
| 14 | Gohan | 91 | A | Beast form |
| 15 | Zamasu | 90 | A | Fused Zamasu: immortal body with Goku Black's power |
| 16 | Goku Black | 88 | A | Super Saiyan Rosé |
| 17 | Toppo | 88 | A | God of Destruction mode |
| 18 | Kefla | 87 | A | Fusion that pushed Ultra Instinct Goku |
| 19 | Piccolo | 85 | A | Orange Piccolo |
| 20 | Hit | 85 | A | Time-skipping assassin of Universe 6 |
| 21 | Android 17 | 84 | A | Won the Tournament of Power |
| 22 | Kale | 83 | A | Berserker Super Saiyan |
| 23 | Dyspo | 82 | A | Fastest fighter of Universe 11 |
| 24 | Future Trunks | 82 | A | Super Saiyan Rage |
| 25 | Caulifla | 80 | B | Super Saiyan 2 prodigy |
| 26 | Android 18 | 79 | B | Infinite energy; lasted deep into the Tournament of Power |
| 27 | Cabba | 78 | B | Universe 6 Saiyan, Super Saiyan 2 |
| 28 | Gotenks | 76 | B | Super Saiyan 3 fusion |
| 29 | Kid Buu | 75 | B | Pure, unrestrained Buu |
| 30 | Frost | 74 | B | Universe 6's Frieza counterpart |
| 31 | Majin Buu | 72 | B | Good Buu; absorbs almost any damage |
| 32 | Cell | 68 | B | Perfect form |
| 33 | Goten | 66 | B | Super Saiyan as a child |
| 34 | Trunks | 66 | B | Super Saiyan as a child |
| 35 | Dabura | 62 | C | Demon king on Cell's level |
| 36 | Android 16 | 60 | C | Matched imperfect Cell |
| 37 | Supreme Kai | 58 | C | Stronger than Frieza was on Namek |
| 38 | King Cold | 52 | C | Frieza's father |
| 39 | Krillin | 47 | C | Strongest pure human |
| 40 | Tien | 47 | C | Tri-Beam specialist |
| 41 | Captain Ginyu | 44 | D | Body-swapping leader of the Ginyu Force |
| 42 | Master Roshi | 43 | D | Held his own in the Tournament of Power |
| 43 | Bardock | 40 | D | Goku's father, a low-class warrior |
| 44 | Yamcha | 40 | D | Wolf Fang Fist |
| 45 | Zarbon | 38 | D | Frieza's right-hand man |
| 46 | Nappa | 36 | D | Elite Saiyan who wiped out the Z fighters |
| 47 | Raditz | 30 | D | Goku's brother, first Saiyan invader |
| 48 | Chiaotzu | 28 | D | Telekinesis, little else |
| 49 | Yajirobe | 22 | D | Cut off Vegeta's tail, then hid |
| 50 | Videl | 18 | D | Strong for a human, learned to fly |
| 51 | Mr. Satan | 6 | D | World champion by reputation only |
| 52 | Bulma | 2 | D | Genius inventor, not a fighter |

## One Piece

| # | Character | Power | Tier | Why |
| --- | --- | --- | --- | --- |
| 1 | Imu | 58 | S | Ruler of the world; shown above Gear 5 Luffy even while weakened |
| 2 | Rocks D. Xebec | 56 | S | Took Roger and Garp together to bring down |
| 3 | Gol D. Roger | 55 | S | King of the Pirates |
| 4 | Whitebeard | 55 | S | Strongest man in the world in his prime |
| 5 | Shanks | 55 | S | Emperor with top-class Conqueror's Haki |
| 6 | Monkey D. Luffy | 55 | S | Gear 5; defeated Kaido |
| 7 | Monkey D. Garp | 54 | S | Hero of the Marines, Roger's rival |
| 8 | Kaido | 54 | S | Strongest creature; fell only to Gear 5 |
| 9 | Loki | 54 | S | Prince of Elbaf with a god-class dragon fruit |
| 10 | Big Mom | 53 | A | Emperor; needed Law and Kid together |
| 11 | Blackbeard | 53 | A | Emperor with two Devil Fruits |
| 12 | Dracule Mihawk | 53 | A | World's strongest swordsman |
| 13 | Silvers Rayleigh | 52 | A | Roger's right hand, in his prime |
| 14 | Kozuki Oden | 52 | A | Gave Kaido his only scar |
| 15 | Akainu | 52 | A | Fleet Admiral; magma |
| 16 | Monkey D. Dragon | 52 | A | World's most wanted man; feats still unseen |
| 17 | Saint Jaygarcia Saturn | 51 | A | One of the Five Elders; regenerates from anything shown |
| 18 | Sengoku | 51 | A | Former Fleet Admiral, the Buddha |
| 19 | Kizaru | 51 | A | Admiral; light |
| 20 | Aokiji | 51 | A | Former admiral; ice |
| 21 | Fujitora | 50 | A | Admiral; gravity |
| 22 | Ryokugyu | 50 | A | Admiral; forest |
| 23 | Benn Beckman | 50 | A | Shanks's first mate |
| 24 | Roronoa Zoro | 49 | A | King of Hell style; beat King |
| 25 | Trafalgar Law | 48 | A | Awakened Ope Ope no Mi |
| 26 | Eustass Kid | 48 | A | Awakened magnetism |
| 27 | Yamato | 47 | B | Held off Kaido alone |
| 28 | Sanji | 46 | B | Ifrit Jambe; beat Queen |
| 29 | King | 46 | B | Kaido's right hand |
| 30 | Charlotte Katakuri | 46 | B | Big Mom's strongest son; future sight |
| 31 | Marco | 46 | B | Phoenix; held off King and Queen |
| 32 | Sabo | 46 | B | Revolutionary Army chief of staff; Flame-Flame Fruit |
| 33 | Shiryu | 45 | B | Blackbeard's swordsman, invisible |
| 34 | Portgas D. Ace | 44 | B | Whitebeard's 2nd division commander |
| 35 | Boa Hancock | 44 | B | Conqueror's Haki and petrification |
| 36 | Bartholomew Kuma | 44 | B | Paw-Paw Fruit; former Warlord |
| 37 | Donquixote Doflamingo | 43 | B | Awakened String-String Fruit |
| 38 | Rob Lucci | 43 | B | Awakened Zoan; fought Gear 5 |
| 39 | Queen | 43 | B | Kaido's All-Star, cyborg brachiosaurus |
| 40 | Jinbe | 42 | B | Fish-Man Karate master |
| 41 | Killer | 41 | B | Kid's first mate |
| 42 | Enel | 41 | B | Logia lightning; ruled Skypiea |
| 43 | Magellan | 41 | B | Impel Down's poison warden |
| 44 | X Drake | 40 | B | Ancient Zoan, Marine spy |
| 45 | Crocodile | 40 | B | Sand Logia; former Warlord |
| 46 | Gecko Moria | 39 | B | Shadow-stealing former Warlord |
| 47 | Koby | 38 | C | Marine rising star; Honesty Impact |
| 48 | Emporio Ivankov | 38 | C | Hormone fruit; Revolutionary commander |
| 49 | Franky | 37 | C | Cyborg shipwright |
| 50 | Nico Robin | 36 | C | Demonio Fleur |
| 51 | Brook | 36 | C | Soul King |
| 52 | Smoker | 36 | C | Smoke Logia vice admiral |
| 53 | Carrot | 34 | C | Sulong form |
| 54 | Tony Tony Chopper | 33 | C | Monster Point |
| 55 | Bartolomeo | 33 | C | Barrier fruit |
| 56 | Nami | 29 | C | Weather control with Zeus |
| 57 | Usopp | 28 | C | Sniper; Observation Haki |
| 58 | Perona | 28 | C | Negative Hollows |
| 59 | Bon Clay | 26 | D | Okama Kenpo |
| 60 | Buggy | 20 | D | Emperor by accident |
| 61 | Arlong | 15 | D | East Blue fish-man boss |
| 62 | Nefertari Vivi | 4 | D | Princess of Alabasta, not a fighter |

## Naruto

| # | Character | Power | Tier | Why |
| --- | --- | --- | --- | --- |
| 1 | Kaguya Otsutsuki | 65 | S | Progenitor of chakra; had to be sealed |
| 2 | Hagoromo Otsutsuki | 64 | S | Sage of Six Paths |
| 3 | Naruto Uzumaki | 63 | S | Six Paths Sage Mode |
| 4 | Sasuke Uchiha | 63 | S | Rinnegan with Six Paths power |
| 5 | Madara Uchiha | 62 | S | Ten-Tails jinchuriki |
| 6 | Obito Uchiha | 60 | A | Ten-Tails jinchuriki |
| 7 | Might Guy | 59 | A | Eighth Gate nearly killed Madara |
| 8 | Kurama | 58 | A | The Nine-Tailed Fox |
| 9 | Hashirama Senju | 56 | A | God of Shinobi |
| 10 | Kakashi Hatake | 54 | A | Double Mangekyo Susanoo, briefly |
| 11 | Pain | 52 | B | Flattened the Hidden Leaf |
| 12 | Minato Namikaze | 52 | B | Fourth Hokage, Flying Thunder God |
| 13 | Hiruzen Sarutobi | 51 | B | Third Hokage in his prime |
| 14 | Kabuto Yakushi | 51 | B | Sage Mode |
| 15 | Itachi Uchiha | 50 | B | Susanoo with the Totsuka Blade |
| 16 | Tobirama Senju | 50 | B | Second Hokage |
| 17 | Killer Bee | 50 | B | Perfect Eight-Tails jinchuriki |
| 18 | A (Fourth Raikage) | 49 | B | Lightning armour, speed near Minato |
| 19 | Onoki | 49 | B | Third Tsuchikage, Dust Release |
| 20 | Jiraiya | 48 | B | Sannin, Sage Mode |
| 21 | Gaara | 48 | B | Fifth Kazekage |
| 22 | Kisame Hoshigaki | 48 | B | The tailless tailed beast |
| 23 | Shisui Uchiha | 48 | B | Kotoamatsukami |
| 24 | Orochimaru | 47 | B | Sannin, near-immortal |
| 25 | Hanzo | 47 | B | Beat all three Sannin in his prime |
| 26 | Tsunade | 46 | B | Fifth Hokage, Strength of a Hundred |
| 27 | Danzo Shimura | 46 | B | Izanagi and Shisui's eye |
| 28 | Deidara | 45 | B | Explosive clay |
| 29 | Sasori | 45 | B | Puppet master with a hundred puppets |
| 30 | Kakuzu | 45 | B | Five hearts |
| 31 | Mei Terumi | 44 | B | Fifth Mizukage |
| 32 | Sakura Haruno | 44 | B | Strength of a Hundred Seal |
| 33 | Konan | 43 | B | Six hundred billion paper bombs |
| 34 | Darui | 42 | C | Black lightning |
| 35 | Kimimaro | 42 | C | Orochimaru's strongest follower |
| 36 | Chiyo | 41 | C | Veteran puppet master |
| 37 | Hidan | 40 | C | Immortal, curse ritual |
| 38 | Captain Yamato | 40 | C | Wood Release |
| 39 | Asuma Sarutobi | 40 | C | Wind chakra blades |
| 40 | Rock Lee | 40 | C | Taijutsu and the inner gates |
| 41 | Neji Hyuga | 38 | C | Byakugan prodigy |
| 42 | Zabuza Momochi | 38 | C | Demon of the Hidden Mist |
| 43 | Jugo | 38 | C | Source of the curse mark |
| 44 | Choji Akimichi | 37 | C | Butterfly mode |
| 45 | Shikamaru Nara | 36 | C | Strategist who beat Hidan |
| 46 | Temari | 36 | C | Wind style |
| 47 | Suigetsu Hozuki | 35 | C | Liquid body |
| 48 | Hinata Hyuga | 34 | C | Twin Lion Fists |
| 49 | Shino Aburame | 34 | C | Insect swarm |
| 50 | Kankuro | 34 | C | Puppeteer |
| 51 | Sai | 34 | C | Ink beasts |
| 52 | Haku | 33 | C | Ice mirrors |
| 53 | Kiba Inuzuka | 31 | C | Fights alongside Akamaru |
| 54 | Ino Yamanaka | 30 | C | Mind transfer |
| 55 | Konohamaru Sarutobi | 28 | D | Learned the Rasengan young |
| 56 | Tenten | 26 | D | Weapons specialist |
| 57 | Karin | 22 | D | Sensor and healer |
| 58 | Iruka Umino | 15 | D | Academy teacher |

## Jujutsu Kaisen

| # | Character | Power | Tier | Why |
| --- | --- | --- | --- | --- |
| 1 | Ryomen Sukuna | 48 | S | King of Curses; killed Gojo |
| 2 | Satoru Gojo | 47 | S | Limitless and the Six Eyes |
| 3 | Yuta Okkotsu | 43 | A | Copy and Rika |
| 4 | Yuji Itadori | 42 | A | End of series; finished Sukuna |
| 5 | Kenjaku | 42 | A | Centuries of stolen techniques |
| 6 | Yuki Tsukumo | 42 | A | Special grade; mass |
| 7 | Toji Fushiguro | 41 | A | Zero cursed energy; nearly killed young Gojo |
| 8 | Maki Zenin | 41 | A | Awakened to Toji's level |
| 9 | Kinji Hakari | 41 | A | Jackpot makes him unkillable |
| 10 | Suguru Geto | 40 | A | Special grade curse manipulator |
| 11 | Hajime Kashimo | 40 | A | Strongest sorcerer of his era |
| 12 | Yorozu | 39 | B | Heian-era construction user |
| 13 | Ryu Ishigori | 39 | B | Highest cursed energy output |
| 14 | Takako Uro | 38 | B | Bends the sky |
| 15 | Mahito | 38 | B | Reshapes souls |
| 16 | Jogo | 38 | B | Volcano curse |
| 17 | Hiromi Higuruma | 38 | B | Courtroom domain; a genius beginner |
| 18 | Choso | 37 | B | Blood manipulation |
| 19 | Uraume | 37 | B | Sukuna's ice-wielding servant |
| 20 | Megumi Fushiguro | 36 | B | Ten Shadows |
| 21 | Aoi Todo | 36 | B | Boogie Woogie |
| 22 | Hanami | 36 | B | Forest curse |
| 23 | Hana Kurusu | 36 | B | Host of Angel; nullifies techniques |
| 24 | Miguel | 36 | B | Stalled Gojo for minutes |
| 25 | Naoya Zenin | 35 | B | Projection Sorcery |
| 26 | Fumihiko Takaba | 35 | B | Whatever he finds funny comes true |
| 27 | Naobito Zenin | 34 | B | Fastest sorcerer after Gojo |
| 28 | Kento Nanami | 33 | B | Grade 1; Ratio |
| 29 | Mei Mei | 32 | B | Grade 1; crows |
| 30 | Atsuya Kusakabe | 32 | B | Strongest grade 1 without a technique |
| 31 | Mechamaru | 31 | C | Kokichi Muta's puppets |
| 32 | Toge Inumaki | 30 | C | Cursed Speech |
| 33 | Panda | 30 | C | Three cores |
| 34 | Noritoshi Kamo | 29 | C | Blood manipulation |
| 35 | Nobara Kugisaki | 28 | C | Straw Doll, Resonance |
| 36 | Mai Zenin | 20 | D | Can construct one bullet a day |
| 37 | Utahime Iori | 20 | D | Amplifies allies |
| 38 | Kasumi Miwa | 15 | D | Simple Domain |
| 39 | Junpei Yoshino | 12 | D | Had only just awakened |
| 40 | Kiyotaka Ijichi | 3 | D | Assistant manager |

## Bleach

| # | Character | Power | Tier | Why |
| --- | --- | --- | --- | --- |
| 1 | Yhwach | 62 | S | The Almighty: sees and rewrites the future |
| 2 | Ichigo Kurosaki | 60 | S | True Zangetsu |
| 3 | Sosuke Aizen | 60 | S | Fused with the Hogyoku; cannot be killed |
| 4 | Ichibe Hyosube | 58 | S | Leader of Squad Zero; controls names |
| 5 | Genryusai Yamamoto | 57 | A | Zanka no Tachi |
| 6 | Jugram Haschwalth | 56 | A | The Balance; Yhwach's other half |
| 7 | Kenpachi Zaraki | 56 | A | Bankai |
| 8 | Gerard Valkyrie | 56 | A | The Miracle |
| 9 | Gremmy Thoumeaux | 55 | A | Whatever he imagines becomes real |
| 10 | Senjumaru Shutara | 55 | A | Squad Zero; bankai |
| 11 | Lille Barro | 54 | A | The X-Axis |
| 12 | Kisuke Urahara | 54 | A | Bankai restructures anything |
| 13 | Shunsui Kyoraku | 54 | A | Captain-Commander; bankai |
| 14 | Retsu Unohana | 52 | A | The first Kenpachi |
| 15 | Mayuri Kurotsuchi | 52 | A | Prepared for everything |
| 16 | Isshin Kurosaki | 52 | A | Former captain, Ichigo's father |
| 17 | Askin Nakk Le Vaar | 52 | A | The Deathdealing |
| 18 | Byakuya Kuchiki | 51 | A | Senbonzakura Kageyoshi |
| 19 | Toshiro Hitsugaya | 51 | A | Completed bankai |
| 20 | Coyote Starrk | 51 | A | Primera Espada |
| 21 | Baraggan Louisenbairn | 51 | A | Segunda Espada; ages all he touches |
| 22 | Ulquiorra Cifer | 51 | A | Segunda Etapa |
| 23 | Uryu Ishida | 51 | A | The Antithesis |
| 24 | Gin Ichimaru | 50 | B | Bankai extends at absurd speed |
| 25 | Yoruichi Shihoin | 50 | B | Goddess of Flash |
| 26 | As Nodt | 50 | B | The Fear |
| 27 | Rukia Kuchiki | 49 | B | Bankai: absolute zero |
| 28 | Renji Abarai | 49 | B | True bankai |
| 29 | Jushiro Ukitake | 49 | B | Veteran captain |
| 30 | Tier Harribel | 48 | B | Tercera Espada |
| 31 | Grimmjow Jaegerjaquez | 48 | B | Sexta Espada, far stronger later |
| 32 | Shinji Hirako | 47 | B | Visored captain; inverts perception |
| 33 | Bazz-B | 47 | B | The Heat |
| 34 | Sajin Komamura | 46 | B | Humanization bankai |
| 35 | Nnoitra Gilga | 46 | B | Quinto Espada, toughest hierro |
| 36 | Nelliel Tu Odelschwanck | 46 | B | Former Tercera Espada |
| 37 | Bambietta Basterbine | 46 | B | The Explode |
| 38 | Kaname Tosen | 45 | B | Hollowfied former captain |
| 39 | Kensei Muguruma | 45 | B | Visored captain |
| 40 | Soi Fon | 44 | B | Two-strike kill |
| 41 | Yasutora Sado | 42 | B | Brazo Derecha de Gigante |
| 42 | Ikkaku Madarame | 40 | C | Hides his bankai |
| 43 | Shuhei Hisagi | 38 | C | Lieutenant of Squad 9 |
| 44 | Rangiku Matsumoto | 36 | C | Lieutenant of Squad 10 |
| 45 | Momo Hinamori | 30 | C | Kido specialist |
| 46 | Orihime Inoue | 30 | C | Rejects events; not a fighter |
| 47 | Hanataro Yamada | 10 | D | Squad 4 healer |
| 48 | Don Kanonji | 3 | D | TV spirit medium |
| 49 | Kon | 2 | D | A mod soul in a plush lion |

## Hunter × Hunter

| # | Character | Power | Tier | Why |
| --- | --- | --- | --- | --- |
| 1 | Meruem | 42 | S | Chimera Ant King after absorbing Youpi and Pouf |
| 2 | Isaac Netero | 40 | S | Hundred-Type Guanyin Bodhisattva |
| 3 | Gon Freecss | 39 | A | Adult form, a one-time vow |
| 4 | Neferpitou | 38 | A | Royal Guard; killed Kite |
| 5 | Menthuthuyoupi | 37 | A | Royal Guard; raw power |
| 6 | Ging Freecss | 37 | A | Top-five Nen user; feats mostly unseen |
| 7 | Zeno Zoldyck | 37 | A | Dragon Dive |
| 8 | Chrollo Lucilfer | 37 | A | Skill Hunter; killed Hisoka once |
| 9 | Silva Zoldyck | 36 | A | Head of the Zoldyck family |
| 10 | Hisoka Morow | 36 | A | Bungee Gum |
| 11 | Shaiapouf | 35 | A | Royal Guard; splits into clones |
| 12 | Illumi Zoldyck | 34 | B | Needle control |
| 13 | Killua Zoldyck | 34 | B | Godspeed |
| 14 | Kurapika | 34 | B | Emperor Time; deadly against the Troupe |
| 15 | Razor | 33 | B | Greed Island game master |
| 16 | Biscuit Krueger | 33 | B | Double-star hunter, true form |
| 17 | Uvogin | 33 | B | Strongest body in the Troupe |
| 18 | Feitan Portor | 33 | B | Rising Sun |
| 19 | Phinks Magcub | 33 | B | Ripper Cyclotron |
| 20 | Kite | 33 | B | Crazy Slots |
| 21 | Morel Mackernasey | 32 | B | Smoke; master tactician |
| 22 | Franklin Bordeau | 31 | B | Double Machine Gun |
| 23 | Machi Komacine | 30 | B | Nen threads |
| 24 | Nobunaga Hazama | 30 | B | Iaido within his En |
| 25 | Knuckle Bine | 29 | B | Hakoware bankrupts aura |
| 26 | Palm Siberia | 29 | B | Chimera form |
| 27 | Shizuku Murasaki | 28 | B | Blinky the vacuum |
| 28 | Shalnark | 28 | B | Controls people by antenna |
| 29 | Kalluto Zoldyck | 27 | C | Paper techniques |
| 30 | Alluka Zoldyck | 26 | C | Nanika grants wishes; not a fighter |
| 31 | Pakunoda | 24 | C | Reads memories |
| 32 | Leorio Paradinight | 22 | C | Remote punch |
| 33 | Zushi | 15 | D | Wing's young student |
| 34 | Tonpa | 5 | D | The rookie crusher |
| 35 | Komugi | 1 | D | Gungi champion, cannot fight |

## Demon Slayer

| # | Character | Power | Tier | Why |
| --- | --- | --- | --- | --- |
| 1 | Yoriichi Tsugikuni | 33 | S | Cornered Muzan alone |
| 2 | Muzan Kibutsuji | 32 | S | The Demon King |
| 3 | Kokushibo | 30 | A | Upper Rank One |
| 4 | Doma | 28 | A | Upper Rank Two |
| 5 | Gyomei Himejima | 27 | B | Strongest Hashira |
| 6 | Akaza | 27 | B | Upper Rank Three |
| 7 | Tanjiro Kamado | 25 | B | Sun Breathing with the mark |
| 8 | Sanemi Shinazugawa | 25 | B | Wind Hashira |
| 9 | Giyu Tomioka | 25 | B | Water Hashira |
| 10 | Muichiro Tokito | 24 | B | Mist Hashira; beat Gyokko alone |
| 11 | Obanai Iguro | 24 | B | Serpent Hashira |
| 12 | Kyojuro Rengoku | 24 | B | Flame Hashira |
| 13 | Mitsuri Kanroji | 23 | B | Love Hashira |
| 14 | Tengen Uzui | 23 | B | Sound Hashira |
| 15 | Hantengu | 23 | B | Upper Rank Four |
| 16 | Gyutaro | 23 | B | Upper Rank Six |
| 17 | Gyokko | 22 | B | Upper Rank Five |
| 18 | Zenitsu Agatsuma | 22 | B | Created a seventh Thunder form |
| 19 | Nezuko Kamado | 22 | B | Awakened demon form |
| 20 | Shinobu Kocho | 21 | C | Insect Hashira; poison |
| 21 | Inosuke Hashibira | 21 | C | Beast Breathing |
| 22 | Kanao Tsuyuri | 21 | C | Flower Breathing |
| 23 | Kaigaku | 21 | C | New Upper Rank Six |
| 24 | Genya Shinazugawa | 19 | C | Gains demon powers by eating them |
| 25 | Daki | 19 | C | Shares Upper Rank Six with Gyutaro |
| 26 | Enmu | 17 | C | Lower Rank One |
| 27 | Rui | 16 | C | Lower Rank Five |
| 28 | Sakonji Urokodaki | 16 | C | Former Water Hashira, now old |
| 29 | Murata | 7 | D | Ordinary slayer who keeps surviving |
| 30 | Hotaru Haganezuka | 2 | D | Swordsmith, not a fighter |
