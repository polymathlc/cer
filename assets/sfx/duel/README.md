# 🎴 Ember Duel — sound effects

The duel has sound out of the box with **no files in this folder at all**: `app.js`
synthesises every cue with the Web Audio API (`_duelSynthHit` / `_duelSynthHeal` /
`_duelSynthSlay`), which costs the page nothing and works on a school laptop
with a bad connection.

Dropping real recorded effects in here **replaces** the synthesised ones, cue for
cue, with no code change.

## How to add real sounds

1. Download the effects you want from a free sound library. Anything whose
   licence allows use in a product without attribution is fine — the usual ones:

   | Site | Licence | Notes |
   |---|---|---|
   | <https://mixkit.co/free-sound-effects/> | Mixkit free licence | No attribution, no account needed |
   | <https://pixabay.com/sound-effects/> | Pixabay content licence | No attribution |
   | <https://kenney.nl/assets?q=audio> | CC0 | "Impact Sounds" and "RPG Audio" are the right packs |
   | <https://freesound.org/> | mixed — **check each file** | Prefer the CC0 ones |
   | <https://opengameart.org/> | mixed — **check each file** | Prefer the CC0 ones |

   Search terms that land on the right thing: *impact*, *punch*, *sword hit*,
   *heavy impact*, *explosion boom*, *magic heal*, *heal chime*, *monster death*.

2. Save them into this folder as `.mp3` (or `.ogg` / `.wav` — anything the
   browser can decode). Keep each one **short**: 0.2–0.8 s. A cue with a long
   tail overlaps the next blow.

3. Copy `manifest.example.json` to `manifest.json` and point each cue at its
   file. **`manifest.json` is the switch** — until it exists the app makes one
   request, gets a 404, and stays on the synth forever.

4. Note what you used and under what licence in `CREDITS.md` next to this file.

## The cues

Damage cues are picked by how much damage a single blow does — that is the
"the larger the damage, the more dramatic the sound" rule, and the tiers live in
`DUEL_HIT_TIERS` in `app.js`. A hit on your own hero counts as 2 damage more
than it is, because that is the one that can end the duel.

| Cue | Fires on | What to pick |
|---|---|---|
| `hit1` | 1–2 damage | A light tap or a small blade tick |
| `hit2` | 3–5 damage | An ordinary punch or sword hit |
| `hit3` | 6–9 damage | A heavy impact with some low end |
| `hit4` | 10+ damage | A boom — explosion, cannon, something enormous |
| `heal1` | 1–4 healing | A short bright chime |
| `heal2` | 5+ healing | A fuller, longer magical shimmer |
| `slay`  | a minion dies | A dark falling thud |

Each of the four damage tiers also sets how hard the screen shakes
(`quake`, 1–4). The shake is CSS (`.duel-quake-1` … `-4` in `index.html`) and is
suppressed entirely under `prefers-reduced-motion`.

## Remote files

A manifest value may be a full `https://` URL instead of a filename, so the
sounds can be served from a CDN rather than bundled:

```json
{ "hit4": "https://example.com/sfx/boom.mp3" }
```

The file's host must allow cross-origin reads (`Access-Control-Allow-Origin`),
because the app decodes it through `fetch` + `decodeAudioData`. Anything that
fails to load or decode falls silently back to the synth. Bundling is the safer
choice: a hotlink that stops working takes the sound with it.

## Students can always turn it off

The 🔊 button in the duel's top bar silences the mode; the choice is remembered
in `localStorage` under `sq_duel_sfx`.
