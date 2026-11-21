#!/usr/bin/env python3
"""Turn the owner's card pictures into the game's card files.

    python3 scripts/card_art.py <card-art folder> [--all] [--dry-run]

The folder holds one sub-folder per universe ("Dragon Ball", "One Piece" ...), each
with pictures named after the character as the game shows it ("Grand Priest.png").
Pictures directly in the folder, outside a universe folder, are ignored.

For each picture that is new or changed since last time (compared by content hash,
kept in src/assets/cards/sources.json; --all redoes everything):

- the universe folder and the file name are matched to a character (exact, or a close
  spelling, which is reported);
- a picture wider than the card's 5:7 shape is cut to it around the point named in
  src/assets/cards/crops.json (fraction of the width; the middle if not named), a taller
  one from the top;
- a character new to src/data/faces.json gets a guessed face position ("guess": true),
  which a person must then set by looking at the card: x and y of the face's centre and
  its size, as fractions of the card's width and height. Profile pictures zoom on it;
- it is saved as src/assets/cards/<id>.webp (420x588, quality 80) and listed in
  src/assets/cards/CREDITS.md.

Needs: pip install pillow. (An anime face detector was tried and found almost none of
these painted faces, so faces are placed by hand.)
"""

import datetime
import difflib
import hashlib
import json
import re
import sys
import unicodedata
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CARDS = ROOT / 'src/assets/cards'
FACES = ROOT / 'src/data/faces.json'
SOURCES = CARDS / 'sources.json'
CREDITS = CARDS / 'CREDITS.md'
ROSTERS = ROOT / 'src/data/rosters.json'
UNIVERSE_NAMES = {
    'dragon-ball': 'Dragon Ball', 'one-piece': 'One Piece', 'naruto': 'Naruto',
    'jujutsu-kaisen': 'Jujutsu Kaisen', 'bleach': 'Bleach', 'hunter-x-hunter': 'Hunter x Hunter',
    'demon-slayer': 'Demon Slayer',
}
SIZE = (420, 588)
CROPS = CARDS / 'crops.json'
PICTURE = re.compile(r'\.(png|jpe?g|webp|avif)$', re.I)


def slug(name: str) -> str:
    """Same as slug() in src/data/characters.ts."""
    s = unicodedata.normalize('NFD', name)
    s = ''.join(c for c in s if not unicodedata.combining(c)).lower()
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-')



def main(argv):
    args = [a for a in argv if not a.startswith('--')]
    if not args:
        sys.exit(__doc__)
    source = Path(args[0])
    redo_all, dry = '--all' in argv, '--dry-run' in argv
    rosters = json.loads(ROSTERS.read_text())
    sources = json.loads(SOURCES.read_text()) if SOURCES.exists() else {}
    faces = json.loads(FACES.read_text()) if FACES.exists() else {}
    credits = CREDITS.read_text()
    crops = json.loads(CROPS.read_text()) if CROPS.exists() else {}
    done, skipped, problems = [], [], []

    for folder in sorted(p for p in source.iterdir() if p.is_dir()):
        verse = next((u for u, n in UNIVERSE_NAMES.items() if slug(n) == slug(folder.name)), None)
        if not verse:
            close = difflib.get_close_matches(slug(folder.name), [slug(n) for n in UNIVERSE_NAMES.values()], 1, 0.8)
            verse = next((u for u, n in UNIVERSE_NAMES.items() if close and slug(n) == close[0]), None)
        if not verse:
            problems.append(f'folder "{folder.name}": not a universe of the game')
            continue
        names = {slug(n): n for n, *_ in rosters[verse]}
        for file in sorted(p for p in folder.iterdir() if PICTURE.search(p.name)):
            key = slug(file.stem)
            cid = key if key in names else None
            if not cid:
                close = difflib.get_close_matches(key, list(names), 1, 0.85)
                if close:
                    cid = close[0]
                    problems.append(f'"{folder.name}/{file.name}" read as {names[cid]} (close spelling)')
                else:
                    problems.append(f'"{folder.name}/{file.name}": no character of that name in {UNIVERSE_NAMES[verse]}')
                    continue
            digest = hashlib.sha1(file.read_bytes()).hexdigest()
            if not redo_all and sources.get(cid) == digest and (CARDS / f'{cid}.webp').exists():
                skipped.append(cid)
                continue
            im = Image.open(file).convert('RGB')
            w, h = im.size
            if w / h > 5 / 7 + 0.005:
                nw = round(h * 5 / 7)
                x0 = int(min(max(crops.get(cid, 0.5) * w - nw / 2, 0), w - nw))
                im = im.crop((x0, 0, x0 + nw, h))
            elif w / h < 5 / 7 - 0.005:
                im = im.crop((0, 0, w, round(w * 7 / 5)))
            card = im.resize(SIZE, Image.LANCZOS)
            if cid not in faces or faces[cid].get('guess'):
                faces[cid] = {'x': 0.5, 'y': 0.2, 'size': 0.4, 'guess': True}
                problems.append(f'{names[cid]}: set its face in src/data/faces.json (now a guess)')
            elif cid in sources:
                problems.append(f'{names[cid]}: picture changed, check its face in src/data/faces.json')
            if not dry:
                card.save(CARDS / f'{cid}.webp', 'WEBP', quality=80, method=6)
                sources[cid] = digest
                if f'| {cid}.webp |' not in credits:
                    today = datetime.date.today().isoformat()
                    credits = credits.rstrip('\n') + (
                        f'\n| {cid}.webp | {names[cid]} ({UNIVERSE_NAMES[verse]}) | '
                        f'AI-generated by the owner | {today} |\n'
                    )
            done.append(names[cid])

    if not dry:
        SOURCES.write_text(json.dumps(dict(sorted(sources.items())), indent=1) + '\n')
        FACES.write_text(json.dumps(dict(sorted(faces.items())), indent=1) + '\n')
        CREDITS.write_text(credits)
    print(f'{len(done)} done, {len(skipped)} unchanged')
    if done:
        print('  ' + ', '.join(done))
    for p in problems:
        print('! ' + p)


if __name__ == '__main__':
    main(sys.argv[1:])
