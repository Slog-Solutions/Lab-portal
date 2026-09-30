import { activity, say } from '../build';
import type { CatalogActivity, CatalogTag, CatalogUnit } from '../types';

/** Ser 10 "Similar sounds ... recognizing and distinguishing
 * similar-sounding letters (minimal pairs)" — one game per contrast. */
interface Contrast {
  key: string;
  a: string;
  b: string;
  title: string;
  tip: string;
  pairs: Array<[string, string]>;
  cefr: 'A1' | 'A2' | 'B1';
}

const CONTRASTS: Contrast[] = [
  {
    key: 'i-ii',
    a: 'ɪ',
    b: 'iː',
    title: 'ship or sheep?',
    tip: '/iː/ is long with spread lips; /ɪ/ is short and relaxed.',
    cefr: 'A1',
    pairs: [['ship', 'sheep'], ['sit', 'seat'], ['fill', 'feel'], ['live', 'leave'], ['hit', 'heat'], ['bin', 'bean'], ['chip', 'cheap'], ['fit', 'feet'], ['still', 'steal'], ['rich', 'reach']],
  },
  {
    key: 'ae-e',
    a: 'æ',
    b: 'e',
    title: 'bad or bed?',
    tip: 'Open your mouth wider for /æ/.',
    cefr: 'A1',
    pairs: [['bad', 'bed'], ['man', 'men'], ['sat', 'set'], ['pan', 'pen'], ['bag', 'beg'], ['had', 'head'], ['sad', 'said'], ['dad', 'dead'], ['band', 'bend']],
  },
  {
    key: 'ae-uh',
    a: 'æ',
    b: 'ʌ',
    title: 'cat or cut?',
    tip: '/ʌ/ is short and central, with the mouth only half open.',
    cefr: 'A2',
    pairs: [['cat', 'cut'], ['hat', 'hut'], ['bag', 'bug'], ['cap', 'cup'], ['ran', 'run'], ['match', 'much'], ['fan', 'fun'], ['bat', 'but'], ['lack', 'luck'], ['ankle', 'uncle']],
  },
  {
    key: 'uh-aa',
    a: 'ʌ',
    b: 'ɑː',
    title: 'hut or heart?',
    tip: '/ɑː/ is long and open, from the back of the mouth.',
    cefr: 'A2',
    pairs: [['hut', 'heart'], ['cut', 'cart'], ['much', 'march'], ['bun', 'barn'], ['cup', 'carp'], ['come', 'calm'], ['luck', 'lark'], ['buck', 'bark'], ['hum', 'harm']],
  },
  {
    key: 'o-oo',
    a: 'ɒ',
    b: 'ɔː',
    title: 'cot or caught?',
    tip: '/ɔː/ is long, with rounded lips pushed forward.',
    cefr: 'A2',
    pairs: [['cot', 'caught'], ['pot', 'port'], ['don', 'dawn'], ['shot', 'short'], ['spot', 'sport'], ['fox', 'forks'], ['cod', 'cord'], ['wok', 'walk']],
  },
  {
    key: 'u-uu',
    a: 'ʊ',
    b: 'uː',
    title: 'full or fool?',
    tip: '/uː/ is long, with tightly rounded lips.',
    cefr: 'A2',
    pairs: [['full', 'fool'], ['pull', 'pool'], ['look', 'Luke'], ['soot', 'suit'], ["hood", "who'd"], ['could', 'cooed'], ['foot', 'food']],
  },
  {
    key: 'er-aa',
    a: 'ɜː',
    b: 'ɑː',
    title: 'heard or hard?',
    tip: '/ɜː/ is made in the centre of the mouth with spread lips.',
    cefr: 'B1',
    pairs: [['heard', 'hard'], ['fur', 'far'], ['stir', 'star'], ['firm', 'farm'], ['hurt', 'heart'], ['purse', 'pass'], ['burn', 'barn'], ['curl', 'Carl']],
  },
  {
    key: 'er-or',
    a: 'ɜː',
    b: 'ɔː',
    title: 'work or walk?',
    tip: 'Round your lips for /ɔː/; keep them spread for /ɜː/.',
    cefr: 'A2',
    pairs: [['work', 'walk'], ['word', 'ward'], ['bird', 'board'], ['shirt', 'short'], ['firm', 'form'], ['turn', 'torn'], ['burn', 'born'], ['stir', 'store'], ['fur', 'four']],
  },
  {
    key: 'ei-e',
    a: 'eɪ',
    b: 'e',
    title: 'late or let?',
    tip: '/eɪ/ moves — it glides from /e/ towards /ɪ/.',
    cefr: 'A1',
    pairs: [['late', 'let'], ['wait', 'wet'], ['pain', 'pen'], ['sale', 'sell'], ['taste', 'test'], ['gate', 'get'], ['main', 'men'], ['raid', 'red'], ['date', 'debt'], ['lace', 'less']],
  },
  {
    key: 'ou-or',
    a: 'əʊ',
    b: 'ɔː',
    title: 'coat or caught?',
    tip: '/əʊ/ glides; /ɔː/ stays still and long.',
    cefr: 'B1',
    pairs: [['coat', 'caught'], ['low', 'law'], ['boat', 'bought'], ['so', 'saw'], ['woke', 'walk'], ['hole', 'hall'], ['pose', 'pause'], ['bowl', 'ball'], ['load', 'lord']],
  },
  {
    key: 'p-b',
    a: 'p',
    b: 'b',
    title: 'pin or bin?',
    tip: '/p/ has a puff of air and no voice; /b/ is voiced.',
    cefr: 'A1',
    pairs: [['pin', 'bin'], ['pear', 'bear'], ['pack', 'back'], ['pig', 'big'], ['cap', 'cab'], ['rope', 'robe'], ['pull', 'bull'], ['pay', 'bay'], ['pie', 'buy'], ['pet', 'bet']],
  },
  {
    key: 't-d',
    a: 't',
    b: 'd',
    title: 'tie or die?',
    tip: '/d/ is voiced — feel your throat vibrate.',
    cefr: 'A1',
    pairs: [['tie', 'die'], ['time', 'dime'], ['ten', 'den'], ['try', 'dry'], ['write', 'ride'], ['bet', 'bed'], ['cart', 'card'], ['town', 'down'], ['tear', 'dear'], ['set', 'said']],
  },
  {
    key: 'k-g',
    a: 'k',
    b: 'ɡ',
    title: 'coat or goat?',
    tip: '/ɡ/ is voiced; /k/ is a voiceless puff of air.',
    cefr: 'A1',
    pairs: [['coat', 'goat'], ['cold', 'gold'], ['back', 'bag'], ['card', 'guard'], ['came', 'game'], ['lock', 'log'], ['class', 'glass'], ['curl', 'girl'], ['pick', 'pig'], ['cot', 'got']],
  },
  {
    key: 'f-v',
    a: 'f',
    b: 'v',
    title: 'fan or van?',
    tip: 'Same mouth position — /v/ adds voice.',
    cefr: 'A2',
    pairs: [['fan', 'van'], ['fine', 'vine'], ['few', 'view'], ['leaf', 'leave'], ['safe', 'save'], ['ferry', 'very'], ['fail', 'veil'], ['proof', 'prove'], ['half', 'halve']],
  },
  {
    key: 'th-s',
    a: 'θ',
    b: 's',
    title: 'think or sink?',
    tip: 'For /θ/ your tongue touches your top teeth; for /s/ it stays behind them.',
    cefr: 'A2',
    pairs: [['think', 'sink'], ['thick', 'sick'], ['thumb', 'sum'], ['mouth', 'mouse'], ['path', 'pass'], ['thing', 'sing'], ['faith', 'face'], ['worth', 'worse'], ['thought', 'sort'], ['theme', 'seem']],
  },
  {
    key: 'th-t',
    a: 'θ',
    b: 't',
    title: 'three or tree?',
    tip: '/θ/ is a continuous hiss through the teeth; /t/ is a short stop.',
    cefr: 'A2',
    pairs: [['three', 'tree'], ['thin', 'tin'], ['both', 'boat'], ['thank', 'tank'], ['thought', 'taught'], ['tenth', 'tent'], ['thigh', 'tie'], ['thorn', 'torn'], ['theme', 'team']],
  },
  {
    key: 'dh-d',
    a: 'ð',
    b: 'd',
    title: 'they or day?',
    tip: 'For /ð/ the tongue is between the teeth and the sound continues.',
    cefr: 'A2',
    pairs: [['they', 'day'], ['then', 'den'], ['there', 'dare'], ['those', 'doze'], ['though', 'dough'], ['breathe', 'breed'], ['worthy', 'wordy'], ['lather', 'ladder']],
  },
  {
    key: 's-sh',
    a: 's',
    b: 'ʃ',
    title: 'see or she?',
    tip: 'Round your lips and pull the tongue back a little for /ʃ/.',
    cefr: 'A1',
    pairs: [['see', 'she'], ['sip', 'ship'], ['sell', 'shell'], ['sort', 'short'], ['save', 'shave'], ['mess', 'mesh'], ['sign', 'shine'], ['seat', 'sheet'], ['gas', 'gash']],
  },
  {
    key: 'sh-ch',
    a: 'ʃ',
    b: 'tʃ',
    title: 'ship or chip?',
    tip: '/tʃ/ starts with a stop, like /t/; /ʃ/ is a continuous sound.',
    cefr: 'A2',
    pairs: [['ship', 'chip'], ['shop', 'chop'], ['share', 'chair'], ['sheep', 'cheap'], ['wash', 'watch'], ['shoes', 'choose'], ['cash', 'catch'], ['dish', 'ditch'], ['shin', 'chin'], ['mash', 'match']],
  },
  {
    key: 'j-y',
    a: 'dʒ',
    b: 'j',
    title: 'jet or yet?',
    tip: '/j/ is a glide with no contact; /dʒ/ starts with the tongue touching the roof of the mouth.',
    cefr: 'B1',
    pairs: [['jet', 'yet'], ['jam', 'yam'], ['joke', 'yolk'], ['jeer', 'year'], ['Jess', 'yes'], ['jail', 'Yale'], ['major', 'mayor']],
  },
  {
    key: 'l-r',
    a: 'l',
    b: 'r',
    title: 'light or right?',
    tip: 'For /l/ the tongue touches behind the top teeth; for /r/ it touches nothing.',
    cefr: 'A1',
    pairs: [['light', 'right'], ['lead', 'read'], ['long', 'wrong'], ['lock', 'rock'], ['glass', 'grass'], ['fly', 'fry'], ['collect', 'correct'], ['lane', 'rain'], ['lamp', 'ramp'], ['play', 'pray']],
  },
  {
    key: 'v-w',
    a: 'v',
    b: 'w',
    title: 'vest or west?',
    tip: '/v/ uses teeth on the lip; /w/ uses rounded lips only.',
    cefr: 'A2',
    pairs: [['vest', 'west'], ['vet', 'wet'], ['vine', 'wine'], ['verse', 'worse'], ['veil', 'whale'], ['vent', 'went'], ['vow', 'wow'], ['viper', 'wiper'], ['vary', 'wary']],
  },
  {
    key: 'n-ng',
    a: 'n',
    b: 'ŋ',
    title: 'sin or sing?',
    tip: '/ŋ/ is made at the back of the mouth — and has no /ɡ/ after it.',
    cefr: 'B1',
    pairs: [['sin', 'sing'], ['thin', 'thing'], ['ran', 'rang'], ['win', 'wing'], ['ban', 'bang'], ['kin', 'king'], ['fan', 'fang'], ['sun', 'sung'], ['run', 'rung']],
  },
  {
    key: 'h-none',
    a: 'h',
    b: '—',
    title: 'hair or air?',
    tip: '/h/ is just breath before the vowel. Do not drop it, and do not add it.',
    cefr: 'A2',
    pairs: [['hair', 'air'], ['hear', 'ear'], ['hand', 'and'], ['heart', 'art'], ['hold', 'old'], ['heat', 'eat'], ['high', 'eye'], ['hill', 'ill'], ['hate', 'eight'], ['hedge', 'edge']],
  },
];

function pairItems(c: Contrast, tagged: boolean) {
  const label = c.b === '—' ? `/${c.a}/ or no /${c.a}/` : `/${c.a}/ or /${c.b}/`;
  return c.pairs.flatMap(([x, y]) =>
    [x, y].map((spoken) =>
      ({
        kind: 'choice' as const,
        prompt: 'Which word do you hear?',
        // Always shown in the same x | y order, so the game reads as one pair.
        choices: [x, y],
        answer: spoken,
        audio: say(spoken),
        ...(tagged ? { tag: `pairs.${c.key}` } : {}),
        explain: `${x} / ${y} — ${label}`,
      }),
    ),
  );
}

const games: CatalogActivity[] = CONTRASTS.map((c) =>
  activity({
    key: `pron.pairs.${c.key}`,
    title: c.b === '—' ? `/${c.a}/ — ${c.title}` : `/${c.a}/ and /${c.b}/ — ${c.title}`,
    kind: 'pairs-game',
    cefr: c.cefr,
    skill: 'pronunciation',
    mode: 'practice',
    intro: c.tip,
    sampleSize: 12,
    items: pairItems(c, true),
  }),
);

export const MINIMAL_PAIRS_TAGS: Record<string, CatalogTag> = Object.fromEntries(
  CONTRASTS.map((c) => [`pairs.${c.key}`, { label: c.b === '—' ? `/${c.a}/ at the start of words` : `/${c.a}/ and /${c.b}/`, activityKey: `pron.pairs.${c.key}` }]),
);

export const MINIMAL_PAIRS_UNIT: CatalogUnit = {
  key: 'pron-similar-sounds',
  title: 'Similar Sounds',
  description: 'Minimal pairs — words that differ by one sound. Hear the word, pick the right one, and keep your streak going.',
  activities: [
    ...games,
    activity({
      key: 'pron.pairs.challenge',
      title: 'Similar Sounds Challenge (mixed)',
      kind: 'pairs-game',
      cefr: 'B1',
      skill: 'pronunciation',
      mode: 'test',
      intro: 'Twenty pairs from every contrast. No hints until the end — then see which sounds need more practice.',
      sampleSize: 20,
      items: CONTRASTS.flatMap((c) => pairItems(c, true)),
    }),
  ],
};

export const MINIMAL_PAIR_WORD_COUNT = CONTRASTS.reduce((n, c) => n + c.pairs.length * 2, 0);
