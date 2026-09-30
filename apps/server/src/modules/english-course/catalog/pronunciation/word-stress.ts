import { activity, choice, ids, say, stressPhrase, stressWord } from '../build';
import type { CatalogTag, CatalogUnit } from '../types';

/** Ser 10 "word and phrasal stress helps learners to recognize where the
 * stress falls in words of more than one syllable, and in short phrases
 * ... through a variety of fun exercise types". */

const TWO_SYLLABLE = [
  '*ta-ble', '*hap-py', '*win-dow', '*doc-tor', '*mo-ther', '*wa-ter', '*yel-low', '*pen-cil', '*mo-ney', '*vil-lage',
  '*hus-band', '*gar-den', '*sis-ter', '*cof-fee', '*a-pple', 'to-*day', 'be-*gin', 'a-*gain', 'ho-*tel', 're-*lax',
  'a-*round', 'de-*cide', 'for-*get', 'po-*lice', 'ex-*plain', 'com-*plete', 'ba-*lloon', 'can-*teen', 'gui-*tar', 'Ja-*pan',
];

const THREE_SYLLABLE = [
  '*beau-ti-ful', 'com-*pu-ter', 'ba-*na-na', '*hos-pi-tal', '*fa-mi-ly', 'to-*ma-to', '*ca-me-ra', '*in-ter-net', 'im-*por-tant', 're-*mem-ber',
  '*yes-ter-day', 'to-*mor-row', '*pho-to-graph', '*del-i-cate', 'en-gi-*neer', 'Ja-pa-*nese', 'un-der-*stand', 'in-tro-*duce', 'af-ter-*noon', '*con-fi-dent',
  'de-*vel-op', '*el-e-phant', 'mu-*si-cian', '*hol-i-day', '*cus-to-mer', '*en-er-gy', 'di-*rec-tor', 'po-*ta-to', 'ex-*ci-ting', '*pop-u-lar',
  'ex-*pen-sive', '*in-dus-try', 'vol-un-*teer', 're-com-*mend', 'dis-ap-*pear',
];

const FOUR_PLUS = [
  'pho-*to-gra-pher', 'pho-to-*gra-phic', 'e-*con-o-my', 'e-co-*nom-ic', '*ne-ces-sa-ry', 'in-*tel-li-gent', 'u-ni-*ver-si-ty', 'com-mu-ni-*ca-tion',
  'ed-u-*ca-tion', 'in-for-*ma-tion', 'ex-*pe-ri-ence', '*tel-e-vi-sion', 'ge-*og-ra-phy', 'a-*vail-a-ble', 're-*spon-si-ble', 'par-*tic-u-lar',
  'en-vi-ron-*men-tal', 'per-so-*nal-i-ty', 'op-por-*tu-ni-ty', 'math-e-*mat-ics', '*dic-tion-a-ry', 'un-*for-tu-nate-ly', 'in-ter-*na-tion-al', 're-*la-tion-ship',
];

/** Word families where a suffix moves the stress. */
const SUFFIX_FAMILIES = [
  '*pho-to-graph', 'pho-*to-gra-pher', 'pho-to-*gra-phic',
  '*pol-i-tics', 'po-*lit-i-cal', 'pol-i-*ti-cian',
  'a-*cad-e-my', 'ac-a-*dem-ic',
  '*dem-o-crat', 'de-*moc-ra-cy', 'dem-o-*crat-ic',
  '*his-to-ry', 'his-*to-ri-cal', 'his-*to-ri-an',
  '*ma-gic', 'ma-*gi-cian',
  '*mu-sic', 'mu-*si-cian',
  'e-*lec-tric', 'e-lec-*tri-ci-ty', 'e-lec-*tri-cian',
  '*per-son', 'per-so-*nal-i-ty',
];

// [noun, verb, noun sentence, verb sentence]
const NOUN_VERB: Array<[string, string, string, string]> = [
  ['*re-cord', 're-*cord', 'She broke the world record.', 'Please record the meeting.'],
  ['*pre-sent', 'pre-*sent', 'Thank you for the present.', 'I will present my project tomorrow.'],
  ['*ob-ject', 'ob-*ject', 'What is that strange object?', 'Nobody will object to the plan.'],
  ['*pro-duce', 'pro-*duce', 'The shop sells fresh produce.', 'These farms produce rice.'],
  ['*in-crease', 'in-*crease', 'There was an increase in prices.', 'They will increase the price.'],
  ['*pro-test', 'pro-*test', 'There was a protest in the city.', 'The workers protest every year.'],
  ['*re-bel', 're-*bel', 'He was a rebel as a teenager.', 'Teenagers often rebel against rules.'],
  ['*con-duct', 'con-*duct', 'His conduct was excellent.', 'She will conduct the orchestra.'],
  ['*ex-port', 'ex-*port', 'Tea is our main export.', 'We export tea to many countries.'],
  ['*im-port', 'im-*port', 'Oil is a major import.', 'They import cars from Japan.'],
  ['*per-mit', 'per-*mit', 'You need a permit to park here.', 'The rules do not permit phones.'],
  ['*sus-pect', 'sus-*pect', 'The police arrested a suspect.', 'I suspect he is lying.'],
  ['*con-flict', 'con-*flict', 'The conflict lasted for years.', 'The two reports conflict.'],
  ['*pro-gress', 'pro-*gress', 'You have made good progress.', 'Work will progress slowly.'],
  ['*in-sult', 'in-*sult', 'That was a terrible insult.', 'Please do not insult him.'],
  ['*de-crease', 'de-*crease', 'There was a decrease in sales.', 'Sales will decrease this year.'],
];

// Odd one out: [answer (different pattern), three others]
const ODD_ONE_OUT: Array<[string, string[]]> = [
  ['table', ['hotel', 'again', 'begin']],
  ['police', ['happy', 'window', 'doctor']],
  ['hospital', ['banana', 'tomato', 'potato']],
  ['important', ['family', 'beautiful', 'camera']],
  ['remember', ['afternoon', 'understand', 'engineer']],
  ['delicate', ['Japanese', 'volunteer', 'introduce']],
  ['tomorrow', ['photograph', 'yesterday', 'holiday']],
  ['television', ['economy', 'photographer', 'geography']],
  ['experience', ['education', 'information', 'communication']],
  ['guitar', ['garden', 'sister', 'coffee']],
  ['water', ['relax', 'decide', 'forget']],
  ['customer', ['computer', 'director', 'exciting']],
  ['expensive', ['popular', 'energy', 'industry']],
  ['pencil', ['canteen', 'balloon', 'Japan']],
  ['available', ['university', 'personality', 'opportunity']],
];

// Compound noun vs adjective + noun: [notation, meaning shown, spoken]
const COMPOUNDS: Array<[string, string, string]> = [
  ['*green house', 'a greenhouse (a glass building for growing plants)', 'a greenhouse'],
  ['green *house', 'a house that is painted green', 'a green house'],
  ['*black bird', 'a blackbird (a type of bird)', 'a blackbird'],
  ['black *bird', 'any bird that is black', 'a black bird'],
  ['*black board', 'a blackboard in a classroom', 'the blackboard'],
  ['black *board', 'a board painted black', 'a black board'],
  ['*hot dog', 'a hot dog (a sausage in bread)', 'a hot dog'],
  ['hot *dog', 'a dog that feels hot', 'a hot dog on a summer day'],
  ['*English teacher', 'a teacher of English', 'an English teacher'],
  ['English *teacher', 'a teacher who is English', 'an English teacher'],
  ['*bus stop', 'compound noun', 'the bus stop'],
  ['*post office', 'compound noun', 'the post office'],
  ['*car park', 'compound noun', 'the car park'],
  ['*swimming pool', 'compound noun', 'the swimming pool'],
  ['*credit card', 'compound noun', 'a credit card'],
  ['*traffic light', 'compound noun', 'the traffic light'],
  ['*tooth brush', 'compound noun', 'a toothbrush'],
  ['*book shop', 'compound noun', 'a bookshop'],
  ['big *car', 'adjective + noun', 'a big car'],
  ['old *friend', 'adjective + noun', 'an old friend'],
  ['cold *water', 'adjective + noun', 'cold water'],
  ['new *phone', 'adjective + noun', 'a new phone'],
];

// Phrasal verbs (particle stressed) and nouns made from them (first part stressed)
const PHRASAL: Array<[string, string]> = [
  ['get *up', 'I get up at six.'],
  ['turn *off', 'Please turn off the light.'],
  ['give *up', "Don't give up!"],
  ['put *on', 'Put on your coat.'],
  ['pick *up', 'Can you pick up the box?'],
  ['find *out', 'I need to find out the time.'],
  ['come *back', 'Come back soon.'],
  ['sit *down', 'Please sit down.'],
  ['turn it *off', 'Turn it off, please.'],
  ['pick them *up', 'Pick them up at five.'],
  ['*break down', 'The car had a breakdown.'],
  ['broke *down', 'The car broke down.'],
  ['*take off', 'Take-off is at ten.'],
  ['took *off', 'The plane took off at ten.'],
  ['*check in', 'Check-in closes at nine.'],
  ['checked *in', 'We checked in at nine.'],
];

// Contrastive stress: [context, reply notation]
const CONTRASTIVE: Array<[string, string]> = [
  ['A: Did you buy a red car?', 'No, I bought a *blue car.'],
  ['A: Is your sister a doctor?', 'No, my *brother is a doctor.'],
  ['A: Do you live in Pune?', 'No, I *work in Pune.'],
  ['A: Is the meeting on Tuesday?', "No, it's on *Thursday."],
  ['A: Did Ravi call you?', 'No, *Meera called me.'],
  ['A: Do you want tea?', 'No, I want *coffee.'],
  ['A: Is it seven o\'clock?', "No, it's *eight o'clock."],
  ['A: Did you walk here?', 'No, I *drove here.'],
  ['A: Is this your bag?', "No, it's *her bag."],
  ['A: Have you finished the report?', "I've *started it."],
  ['A: Are there five students?', 'There are *fifteen students.'],
  ['A: Did you say the left door?', 'I said the *right door.'],
];

export const WORD_STRESS_TAGS: Record<string, CatalogTag> = {
  'stress.word': { label: 'Word stress', activityKey: 'pron.stress.intro' },
  'stress.suffix': { label: 'Stress in word families', activityKey: 'pron.stress.families' },
  'stress.noun-verb': { label: 'Noun and verb stress', activityKey: 'pron.stress.noun-verb' },
  'stress.phrase': { label: 'Phrase and compound stress', activityKey: 'pron.phrase.compounds' },
  'stress.contrast': { label: 'Contrastive stress', activityKey: 'pron.phrase.contrastive' },
};

export const WORD_STRESS_UNIT: CatalogUnit = {
  key: 'pron-word-stress',
  title: 'Stress & Rhythm 1: Word Stress',
  description: 'Which syllable is strongest? Learn the patterns, then test your ear.',
  activities: [
    activity({
      key: 'pron.stress.intro',
      title: 'Word stress: step by step',
      kind: 'tutorial',
      cefr: 'A2',
      skill: 'pronunciation',
      mode: 'practice',
      intro: 'A step-by-step tutorial. Read, listen, then answer the check questions before you move on.',
      steps: [
        {
          title: 'What is word stress?',
          body: [
            'In English, words with more than one syllable have one **strong** syllable. It is longer, louder and higher than the others.',
            'Getting the stress wrong can make a word hard to understand — even if every sound is right.',
          ],
          examples: [
            { speech: say('banana'), note: 'ba-NA-na' },
            { speech: say('computer'), note: 'com-PU-ter' },
            { speech: say('photograph'), note: 'PHO-to-graph' },
          ],
          checkItemIds: ids(1),
        },
        {
          title: 'Weak syllables',
          body: [
            'The syllables around the stress are usually **weak**. Their vowel often becomes the schwa /ə/.',
            'Listen: in "banana" only the middle "a" is a full /ɑː/. The other two are short /ə/ sounds.',
          ],
          examples: [
            { speech: say('banana'), note: 'bə-NAA-nə' },
            { speech: say('doctor'), note: 'DOC-tə' },
            { speech: say('today'), note: 'tə-DAY' },
          ],
          checkItemIds: ids(2, 3),
        },
        {
          title: 'Two-syllable words',
          body: [
            'Most two-syllable **nouns and adjectives** are stressed on the first syllable: TA-ble, HAP-py.',
            'Most two-syllable **verbs** are stressed on the second syllable: re-LAX, de-CIDE.',
          ],
          examples: [
            { speech: say('window'), note: 'WIN-dow (noun)' },
            { speech: say('happy'), note: 'HAP-py (adjective)' },
            { speech: say('decide'), note: 'de-CIDE (verb)' },
          ],
          checkItemIds: ids(4, 5),
        },
        {
          title: 'Suffixes that pull the stress',
          body: [
            'Words ending in **-tion, -sion, -ic, -ical, -ity, -ian** are stressed on the syllable just before the ending.',
            'in-for-MA-tion, e-co-NOM-ic, u-ni-VER-si-ty, mu-SI-cian.',
          ],
          examples: [
            { speech: say('information'), note: 'in-for-MA-tion' },
            { speech: say('economic'), note: 'e-co-NOM-ic' },
            { speech: say('electricity'), note: 'e-lec-TRI-ci-ty' },
          ],
          checkItemIds: ids(6, 7),
        },
        {
          title: 'Compound nouns',
          body: ['Two words joined into one noun are usually stressed on the **first** part: BUS stop, BOOK shop, CREDit card.'],
          examples: [
            { speech: say('bus stop'), note: 'BUS stop' },
            { speech: say('post office'), note: 'POST office' },
          ],
          checkItemIds: ids(8),
        },
      ],
      items: [
        stressWord('ba-*na-na', { tag: 'stress.word' }),
        choice('Which vowel do the weak syllables of "banana" have?', '/ə/ (schwa)', ['/æ/', '/ɑː/'], { tag: 'stress.word' }),
        stressWord('*doc-tor', { tag: 'stress.word' }),
        stressWord('*gar-den', { tag: 'stress.word' }),
        stressWord('ex-*plain', { tag: 'stress.word' }),
        stressWord('ed-u-*ca-tion', { tag: 'stress.suffix' }),
        stressWord('ge-*og-ra-phy', { tag: 'stress.suffix', explain: 'ge-OG-ra-phy — -graphy words stress the syllable before it' }),
        stressPhrase('*credit card', { tag: 'stress.phrase' }),
      ],
    }),
    activity({
      key: 'pron.stress.two',
      title: 'Two-syllable words',
      kind: 'quiz',
      cefr: 'A1',
      skill: 'pronunciation',
      mode: 'practice',
      sampleSize: 12,
      items: TWO_SYLLABLE.map((w) => stressWord(w, { tag: 'stress.word' })),
    }),
    activity({
      key: 'pron.stress.three',
      title: 'Three-syllable words',
      kind: 'quiz',
      cefr: 'A2',
      skill: 'pronunciation',
      mode: 'practice',
      sampleSize: 12,
      items: THREE_SYLLABLE.map((w) => stressWord(w, { tag: 'stress.word' })),
    }),
    activity({
      key: 'pron.stress.long',
      title: 'Longer words',
      kind: 'quiz',
      cefr: 'B1',
      skill: 'pronunciation',
      mode: 'practice',
      sampleSize: 12,
      items: FOUR_PLUS.map((w) => stressWord(w, { tag: 'stress.word' })),
    }),
    activity({
      key: 'pron.stress.families',
      title: 'Word families: photograph, photographer, photographic',
      kind: 'quiz',
      cefr: 'B1',
      skill: 'pronunciation',
      mode: 'practice',
      intro: 'Adding a suffix can move the stress. Listen carefully to each member of the family.',
      items: SUFFIX_FAMILIES.map((w) => stressWord(w, { tag: 'stress.suffix' })),
    }),
    activity({
      key: 'pron.stress.noun-verb',
      title: 'REcord or reCORD? Nouns and verbs',
      kind: 'quiz',
      cefr: 'B1',
      skill: 'pronunciation',
      mode: 'practice',
      intro: 'Some words are nouns with stress on the first syllable and verbs with stress on the second.',
      sampleSize: 12,
      items: NOUN_VERB.flatMap(([noun, verb, nounSentence, verbSentence]) => {
        const word = noun.replace(/[-*]/g, '');
        return [
          stressWord(noun, { prompt: `"${nounSentence}" — tap the stressed syllable of "${word}".`, spoken: nounSentence, tag: 'stress.noun-verb' }),
          stressWord(verb, { prompt: `"${verbSentence}" — tap the stressed syllable of "${word}".`, spoken: verbSentence, tag: 'stress.noun-verb' }),
        ];
      }),
    }),
    activity({
      key: 'pron.stress.odd',
      title: 'Odd one out: stress patterns',
      kind: 'quiz',
      cefr: 'A2',
      skill: 'pronunciation',
      mode: 'practice',
      intro: 'Three words share a stress pattern. Find the one that is different. Tap a word to hear it.',
      items: ODD_ONE_OUT.map(([odd, others]) =>
        choice('Which word has a different stress pattern?', odd, others, {
          audio: [...others, odd].sort().map((w) => ({ text: w, voice: 'en_GB' as const })),
          tag: 'stress.word',
        }),
      ),
    }),
    activity({
      key: 'pron.stress.test',
      title: 'Word stress test',
      kind: 'quiz',
      cefr: 'B1',
      skill: 'pronunciation',
      mode: 'test',
      intro: 'A different set of words every time. Results and review areas at the end.',
      sampleSize: 20,
      items: [
        ...[...TWO_SYLLABLE, ...THREE_SYLLABLE, ...FOUR_PLUS].map((w) => stressWord(w, { tag: 'stress.word' })),
        ...SUFFIX_FAMILIES.map((w) => stressWord(w, { tag: 'stress.suffix' })),
      ],
    }),
  ],
};

export const PHRASE_STRESS_UNIT: CatalogUnit = {
  key: 'pron-phrase-stress',
  title: 'Stress & Rhythm 2: Phrase Stress',
  description: 'Stress in short phrases: compound nouns, phrasal verbs and contrast.',
  activities: [
    activity({
      key: 'pron.phrase.compounds',
      title: 'GREENhouse or green HOUSE?',
      kind: 'quiz',
      cefr: 'B1',
      skill: 'pronunciation',
      mode: 'practice',
      intro: 'Compound nouns stress the first part. An adjective + noun stresses the noun.',
      items: COMPOUNDS.map(([notation, meaning, spoken]) =>
        stressPhrase(notation, { prompt: `${meaning}. Tap the word with the main stress.`, spoken, tag: 'stress.phrase' }),
      ),
    }),
    activity({
      key: 'pron.phrase.phrasal',
      title: 'Phrasal verbs and their nouns',
      kind: 'quiz',
      cefr: 'B1',
      skill: 'pronunciation',
      mode: 'practice',
      intro: 'A phrasal verb stresses the particle (turn OFF). A noun made from it stresses the first part (a BREAKdown).',
      items: PHRASAL.map(([notation, sentence]) =>
        stressPhrase(notation, { prompt: `"${sentence}" — tap the stressed word.`, spoken: sentence, tag: 'stress.phrase' }),
      ),
    }),
    activity({
      key: 'pron.phrase.contrastive',
      title: 'Stress for contrast',
      kind: 'quiz',
      cefr: 'B1',
      skill: 'pronunciation',
      mode: 'practice',
      intro: 'We stress the word that corrects or contrasts with what someone said.',
      items: CONTRASTIVE.map(([context, reply]) => ({
        ...stressPhrase(reply, { prompt: `${context} — B answers. Which word should B stress?`, tag: 'stress.contrast' }),
        audio: [
          { text: context.replace(/^A: /, ''), voice: 'en_US' as const, speaker: 'A' },
          { text: reply.replace('*', ''), voice: 'en_GB' as const, speaker: 'B' },
        ],
      })),
    }),
  ],
};
