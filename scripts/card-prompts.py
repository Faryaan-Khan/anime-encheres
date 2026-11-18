"""Writes docs/card-art-prompts.csv: one image-generation prompt per character.

Each prompt = shared style + the character's tier style + the character in their
peak form. Tiers follow tierOf() in src/data/characters.ts (share of the
universe's strongest). File names are the character ids the game looks for in
src/assets/cards/. Edit PEAK below to steer a character's form or scene.
"""
import csv, json, re, unicodedata
from pathlib import Path

root = Path(__file__).resolve().parent.parent
rosters = json.loads((root / 'src/data/rosters.json').read_text())
NAMES = {'dragon-ball': 'Dragon Ball', 'one-piece': 'One Piece', 'naruto': 'Naruto',
         'jujutsu-kaisen': 'Jujutsu Kaisen', 'bleach': 'Bleach',
         'hunter-x-hunter': 'Hunter x Hunter', 'demon-slayer': 'Demon Slayer'}

def slug(name):
    s = unicodedata.normalize('NFD', name)
    s = ''.join(c for c in s if not unicodedata.combining(c)).lower()
    return re.sub(r'^-|-$', '', re.sub(r'[^a-z0-9]+', '-', s))

def tier(power, top):
    r = power / top
    return 'S' if r >= .93 else 'A' if r >= .82 else 'B' if r >= .66 else 'C' if r >= .45 else 'D'

BASE = ('Vertical trading-card illustration, 5:7 portrait. Semi-realistic anime key-visual style: '
        'faithful to the character\'s official design, detailed rendering, cinematic lighting, sharp focus. '
        'One character only, centered, head and upper body in the top two thirds, nothing important in the '
        'bottom fifth. No text, no letters, no logos, no watermark, no card border or frame.')

TIER = {
    'S': ('LEGENDARY: the character at full, unleashed power in their most iconic moment. Low-angle hero shot, '
          'overwhelming aura and energy erupting around them, crackling lightning and floating debris, '
          'god-like presence, epic colour-graded background, intense rim light and glowing particles.'),
    'A': ('ELITE: powered up and battle-ready in a dynamic, confident pose. Strong visible aura, '
          'energy effects and motion, dramatic background from their world, bold lighting.'),
    'B': ('STRONG: a cool, ready stance showing their signature ability. Subtle aura or effect, '
          'atmospheric background from their world, good contrast lighting.'),
    'C': ('SKILLED: a calm, characterful pose with a hint of their ability. Light effects, '
          'simple scenic background from their world, soft natural lighting.'),
    'D': ('EVERYDAY: a relaxed, friendly, slightly playful pose, no power effects. '
          'Plain soft-coloured background, gentle lighting.'),
}

# Peak forms and signature moments for the strongest of each universe. Everyone
# else uses their rating note and "strongest canon form".
PEAK = {
    'Zeno': 'the tiny Omni-King on his throne, calm and childlike while whole universes dissolve into white light behind him',
    'Grand Priest': 'the serene Grand Priest with his halo and staff, presiding over the Tournament of Power',
    'Whis': 'Whis with his staff and halo, effortlessly calm, a galaxy swirling behind him',
    'Vados': 'Vados with her staff and halo, calm and amused, cosmic background',
    'Beerus': 'Beerus, God of Destruction, holding a crackling Hakai energy orb, purple-black divine aura',
    'Gogeta': 'Super Saiyan Blue Gogeta firing a massive blue energy blast',
    'Frieza': 'Black Frieza: sleek black body with violet glow, menacing smile, dark energy',
    'Champa': 'Champa, God of Destruction of Universe 6, charging a destruction orb',
    'Vegito': 'Super Saiyan Blue Vegito wielding a blue spirit sword',
    'Imu': 'Imu as a shadowy silhouette on the Empty Throne, glowing eyes, ominous holy-land backdrop',
    'Rocks D. Xebec': 'Rocks D. Xebec, legendary pirate captain on the stormy shores of God Valley',
    'Gol D. Roger': 'Gol D. Roger, King of the Pirates, clashing with black-red Conqueror\'s Haki lightning',
    'Whitebeard': 'Whitebeard in his prime with his bisento, the air cracking like glass from his quake power',
    'Shanks': 'Shanks swinging his sword wrapped in red-black Conqueror\'s Haki lightning',
    'Monkey D. Luffy': 'Gear 5 Luffy: white hair and clothes, cloud-like smoke, laughing wildly as the Sun God',
    'Monkey D. Garp': 'Garp, Hero of the Marines, throwing his Galaxy Impact punch',
    'Kaido': 'Kaido in his hybrid dragon form with his iron club, storm clouds and thunder',
    'Loki': 'Loki, giant prince of Elbaf, unleashing his dragon-fruit power',
    'Kaguya Otsutsuki': 'Kaguya, Rabbit Goddess, Byakugan and third Rinne-Sharingan eye glowing, red moon behind her',
    'Hagoromo Otsutsuki': 'Hagoromo, Sage of Six Paths, with his staff and floating Truth-Seeking Balls',
    'Naruto Uzumaki': 'Naruto in Six Paths Sage Mode with the golden Kurama cloak and Truth-Seeking Balls',
    'Sasuke Uchiha': 'Sasuke with the Rinnegan, Perfect Susanoo drawing an enormous lightning arrow',
    'Madara Uchiha': 'Madara as the Ten-Tails jinchuriki: pale Six Paths form, Truth-Seeking Balls, Rinnegan',
    'Ryomen Sukuna': 'Sukuna in his true four-armed form, Malevolent Shrine domain behind him, drawing a flame arrow',
    'Satoru Gojo': 'Gojo blindfold off, Six Eyes glowing blue, conjuring Hollow Purple: the moment he awakens as the honored one',
    'Yhwach': 'Yhwach, the Almighty, eyes full of countless pupils, vast Quincy wings of light',
    'Ichigo Kurosaki': 'Ichigo with both True Zangetsu blades, unleashing a Getsuga Tensho',
    'Sosuke Aizen': 'Aizen fused with the Hogyoku, butterfly-winged transformation, utterly calm',
    'Ichibe Hyosube': 'Ichibe, leader of Squad Zero, wielding his great brush as ink-black darkness spreads',
    'Meruem': 'Meruem after absorbing Youpi and Pouf: wings unfurled, overwhelming aura',
    'Isaac Netero': 'Netero in prayer as the giant Hundred-Type Guanyin Bodhisattva rises behind him',
    'Yoriichi Tsugikuni': 'Yoriichi with his crimson blade, Sun Breathing flames arcing, Demon Slayer mark on his face',
    'Muzan Kibutsuji': 'Muzan, the Demon King, in his final monstrous form with lashing flesh whips',
}

rows = []
for uid, roster in rosters.items():
    top = max(p for _, p, _ in roster)
    for rank, (name, power, note) in enumerate(roster, 1):
        t = tier(power, top)
        subject = PEAK.get(name) or f'{name} in their strongest canon form ({note})'
        prompt = f'{name} from {NAMES[uid]}: {subject}. {TIER[t]} {BASE}'
        rows.append([NAMES[uid], rank, name, t, f'{slug(name)}.png', subject, prompt])

out = root / 'docs/card-art-prompts.csv'
with out.open('w', newline='', encoding='utf-8') as f:
    w = csv.writer(f)
    w.writerow(['Universe', 'Rank', 'Character', 'Tier', 'File name', 'Peak form / scene', 'Prompt'])
    w.writerows(rows)
print(len(rows), sum(1 for r in rows if r[2] in PEAK), {t: sum(1 for r in rows if r[3] == t) for t in 'SABCD'})
