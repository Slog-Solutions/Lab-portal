import type { CourseItem } from '@lab/shared';
import { activity, choice, gapsFrom, ids, say, stressWord, type ItemDraft } from '../build';
import type { CatalogActivity, CatalogTag, CatalogUnit } from '../types';

/**
 * Ser 10 "Stress and Rhythm section ... introduces learners to the
 * features of connected speech, including the rules governing sentence
 * stress, weak forms, linking, elision, assimilation and contraction, and
 * shifting stress ... a step by step tutorial with test-as-you-learn
 * features and extensive practice in the focus areas."
 */

// ---- Sentence stress --------------------------------------------------------------
// Content words carry a `*`; the last one takes the main (nuclear) stress.
const SENTENCES = [
  'I *want to *buy a *new *car.',
  'She *went to the *market on *Monday.',
  "We're *going to *visit my *grandmother.",
  'The *train *leaves at *nine.',
  'He *works in a *bank in the *city.',
  '*Open the *window, *please.',
  "I've *lost my *keys *again.",
  'They *live *near the *station.',
  'Can you *help me with my *homework?',
  'The *children are *playing in the *garden.',
  "I'd *like a *cup of *tea.",
  'We *had *dinner at a *restaurant.',
  "She's *learning to *drive.",
  '*Where did you *put the *book?',
  'My *brother is a *doctor.',
  'It was *raining *all *day.',
  'He *forgot to *call his *mother.',
  'The *meeting *starts at *ten.',
  'I *need to *finish this *report.',
  'We *walked along the *river.',
  '*Turn *left at the *bank.',
  'The *shop *closes at *six.',
  'She *bought a *red *dress.',
  "They're *watching a *film.",
  'I *usually *get up *early.',
  'The *bus was *late this *morning.',
  'He *speaks *three *languages.',
  'Could you *pass the *salt?',
  "We're *flying to *Delhi *tomorrow.",
  'The *students *finished their *exams.',
  'I *saw her at the *party.',
  "It's *cold in *winter.",
  'The *food was *delicious.',
  "I've *never *been to *London.",
  'She *teaches *English at a *school.',
  'My *phone *needs *charging.',
  'The *weather is *lovely *today.',
  'He *ran to *catch the *bus.',
  'We *met at the *library.',
  'The *museum is *closed on *Sundays.',
  'I *think it will *rain *later.',
  'She *called me *last *night.',
  'We *should *leave *soon.',
  'The *office is on the *second *floor.',
  'He *always *drinks *coffee.',
  'Did you *enjoy the *concert?',
  'They *moved to a *bigger *house.',
  'I *missed the *first *lesson.',
  'The *doctor will *see you *now.',
  'My *parents *live in a *village.',
];

function bare(word: string): string {
  return word.replace(/[*.,?!]/g, '');
}

function sentenceStressItems(sentence: string): ItemDraft[] {
  const words = sentence.split(' ');
  const starred = words.map((w, i) => (w.includes('*') ? i : -1)).filter((i) => i >= 0);
  const last = starred[starred.length - 1]!;
  const spoken = sentence.replace(/\*/g, '');
  const main: ItemDraft = {
    kind: 'stress',
    prompt: 'Listen. Tap the word with the strongest (main) stress.',
    units: words.map((w) => w.replace(/\*/g, '')),
    answer: last,
    audio: say(spoken),
    tag: 'cs.sentence-stress',
    explain: words.map((w) => (w.includes('*') ? bare(w).toUpperCase() : bare(w))).join(' '),
  };
  const weak = [...new Set(words.filter((w) => !w.includes('*')).map(bare))].filter((w) => w.length > 0).slice(0, 2);
  if (weak.length < 2) return [main];
  const content = bare(words[starred[0]!]!);
  return [
    main,
    choice(`"${spoken}" — which of these words is stressed?`, content, weak, {
      audio: say(spoken),
      tag: 'cs.sentence-stress',
      explain: 'Content words (nouns, main verbs, adjectives, adverbs) are stressed; grammar words usually are not.',
    }),
  ];
}

// ---- Weak forms --------------------------------------------------------------------
const WEAK_GAPS = [
  "I'd like [a] cup [of] tea.",
  "She's going [to] the bank.",
  'We [can] meet tomorrow.',
  'Fish [and] chips, please.',
  'I [was] late again.',
  "He's [from] Chennai.",
  'What [do] you want?',
  'They [have] finished.',
  'I [must] go now.',
  'Give [them] the money.',
  'Tell [her] the truth.',
  "It's [for] you.",
  'Look [at] the board.',
  'Some [of] the students left.',
  'She [has] been here before.',
  'We [were] at home.',
  'I want [to] go home.',
  'Wait [for] me.',
  'Where [does] he live?',
  "It's [a] nice day.",
  "I'll call [you] later.",
  '[The] bus is late.',
  'Tea [or] coffee?',
  'Good [but] expensive.',
  'I [should] go.',
  'You [could] try again.',
  'Ask [him] to wait.',
  'A glass [of] water.',
  "She's taller [than] me.",
  'Talk [to] him.',
  'Where [are] you going?',
  'What [was] that?',
  'Can [you] hear me?',
  'There [are] two options.',
  'Half [an] hour.',
  'He [can] swim.',
  'Have [some] water.',
  'They [were] tired.',
  'Lots [of] people came.',
  'Meet [us] at eight.',
  'I bought [a] new shirt.',
  'Send [them] an email.',
  'She [can] speak French.',
  'Salt [and] pepper.',
  'It [was] very cold.',
  'We went [to] the park.',
  'A piece [of] cake.',
  'Did [you] see it?',
  'This is [for] your brother.',
  'I [could] help you.',
];

// [sentence, word, how it sounds here, the other form]
const WEAK_STRONG: Array<[string, string, string, string]> = [
  ['I can swim.', 'can', '/kən/', '/kæn/'],
  ['Yes, I can.', 'can', '/kæn/', '/kən/'],
  ["I'm from Delhi.", 'from', '/frəm/', '/frɒm/'],
  ['Where are you from?', 'from', '/frɒm/', '/frəm/'],
  ['Look at this.', 'at', '/ət/', '/æt/'],
  ['What are you looking at?', 'at', '/æt/', '/ət/'],
  ['This is for you.', 'for', '/fə/', '/fɔː/'],
  ['Who is it for?', 'for', '/fɔː/', '/fə/'],
  ['I was tired.', 'was', '/wəz/', '/wɒz/'],
  ['Yes, I was.', 'was', '/wɒz/', '/wəz/'],
  ['I want to go.', 'to', '/tə/', '/tuː/'],
  ['I want to.', 'to', '/tuː/', '/tə/'],
  ['They have finished.', 'have', '/həv/', '/hæv/'],
  ['I have a car.', 'have', '/hæv/', '/həv/'],
  ['I saw them.', 'them', '/ðəm/', '/ðem/'],
  ['Nice but expensive.', 'but', '/bət/', '/bʌt/'],
];

// ---- Linking -----------------------------------------------------------------------
const LINK_CHOICES = ['a /w/ sound', 'a /j/ sound', 'an /r/ sound', 'the consonant moves onto the vowel'];
const LINKS: Record<'w' | 'j' | 'r' | 'cv', string[]> = {
  w: ['no idea', 'two apples', 'go on', 'do it', 'two eggs', 'blue eyes', 'who is', 'so easy', 'how old', 'new idea', 'too often', 'go away', 'know it', 'you are'],
  j: ['my aunt', 'free art', 'I agree', 'the end', 'my uncle', 'three apples', 'see it', 'be on time', 'they are', 'stay in', 'why are', 'he is', 'she asked', 'very old'],
  r: ['near it', 'our office', 'far away', 'four eggs', 'where is', 'after all', 'here it is', 'more of', 'your English', 'there are', 'for ever', 'teacher is', 'car alarm', 'better idea'],
  cv: ['come in', 'take it', 'turn off', 'pick it up', 'an apple', 'get up', 'look at', 'find out', 'first of all', 'not at all', 'stand up', 'half an hour', 'lots of', 'fill it in'],
};
const LINK_ANSWER = { w: LINK_CHOICES[0]!, j: LINK_CHOICES[1]!, r: LINK_CHOICES[2]!, cv: LINK_CHOICES[3]! };
const LINK_EXPLAIN = {
  w: 'After /uː/, /əʊ/ or /aʊ/, a small /w/ joins the next vowel: go‿(w)on.',
  j: 'After /iː/, /eɪ/, /aɪ/ or /ɔɪ/, a small /j/ joins the next vowel: I‿(y)agree.',
  r: 'A written r at the end of a word is pronounced when the next word starts with a vowel: far‿(r)away.',
  cv: 'A final consonant joins the vowel of the next word: tur‿noff, pi‿ki‿tup.',
};

function linkItems(): ItemDraft[] {
  return (Object.keys(LINKS) as Array<keyof typeof LINKS>).flatMap((type) =>
    LINKS[type].map(
      (phrase): ItemDraft => ({
        kind: 'choice',
        prompt: `Listen to "${phrase}". How do the words join?`,
        choices: LINK_CHOICES,
        answer: LINK_ANSWER[type],
        audio: say(phrase),
        tag: 'cs.linking',
        explain: LINK_EXPLAIN[type],
      }),
    ),
  );
}

// ---- Elision -----------------------------------------------------------------------
const ELISION: Array<[string, string, string[]]> = [
  ['next door', '/t/ in "next"', ['/d/ in "door"', 'nothing is lost']],
  ['last night', '/t/ in "last"', ['/n/ in "night"', 'nothing is lost']],
  ['handbag', 'the /d/', ['the /b/', 'the /h/']],
  ['sandwich', 'the /d/', ['the /w/', 'the /n/']],
  ['Wednesday', 'the first /d/', ['the /z/', 'the /n/']],
  ['friendship', 'the /d/', ['the /ʃ/', 'the /n/']],
  ['old man', '/d/ in "old"', ['/l/ in "old"', '/m/ in "man"']],
  ['must be', '/t/ in "must"', ['/s/ in "must"', '/b/ in "be"']],
  ['just now', '/t/ in "just"', ['/s/ in "just"', '/n/ in "now"']],
  ['left side', '/t/ in "left"', ['/f/ in "left"', '/s/ in "side"']],
  ['facts', 'the /t/', ['the /k/', 'the /s/']],
  ['asked', 'the /k/', ['the /s/', 'the /t/']],
  ['clothes', 'the /ð/', ['the /z/', 'the /l/']],
  ['cupboard', 'the /p/', ['the /b/', 'the /d/']],
  ['listen', 'the /t/ (it is silent)', ['the /s/', 'the /n/']],
  ['Christmas', 'the /t/ (it is silent)', ['the /s/', 'the /m/']],
  ['castle', 'the /t/ (it is silent)', ['the /s/', 'the /l/']],
  ['exactly', 'the /t/', ['the /k/', 'the /l/']],
  ['mostly', 'the /t/', ['the /s/', 'the /l/']],
  ['postman', 'the /t/', ['the /s/', 'the /m/']],
  ['windmill', 'the /d/', ['the /n/', 'the /m/']],
  ['kindness', 'the /d/', ['the /n/', 'the /s/']],
  ['grandmother', 'the /d/', ['the /n/', 'the /m/']],
  ['soft drink', '/t/ in "soft"', ['/f/ in "soft"', '/d/ in "drink"']],
  ['first class', '/t/ in "first"', ['/s/ in "first"', '/k/ in "class"']],
  ['send them', '/d/ in "send"', ['/n/ in "send"', '/ð/ in "them"']],
  ['hand me', '/d/ in "hand"', ['/n/ in "hand"', '/m/ in "me"']],
  ["don't know", '/t/ in "don\'t"', ['/n/ in "don\'t"', '/n/ in "know"']],
  ["can't be", '/t/ in "can\'t"', ['/n/ in "can\'t"', '/b/ in "be"']],
  ['interesting', 'the first "e" (IN-tres-ting)', ['the "i" of -ing', 'nothing is lost']],
  ['chocolate', 'the second "o" (CHOC-lət)', ['the first "o"', 'the "a"']],
  ['different', 'the first "e" (DIF-rənt)', ['the second "e"', 'nothing is lost']],
  ['family', 'the "i" (FAM-ly)', ['the "a"', 'the "y"']],
  ['vegetable', 'the second "e" (VEJ-tə-bl)', ['the first "e"', 'the "a"']],
  ['comfortable', 'the "or" (KUMF-tə-bl)', ['the "a"', 'the "o"']],
  ['camera', 'the "e" (CAM-rə)', ['the first "a"', 'the last "a"']],
  ['temperature', 'the "e" after "p" (TEM-prə-chə)', ['the "u"', 'the "a"']],
  ['restaurant', 'the "au" (REST-ront)', ['the "e"', 'the "a"']],
  ['every', 'the second "e" (EV-ry)', ['the first "e"', 'the "y"']],
  ['secretary', 'the "a" (SEC-rə-try)', ['the first "e"', 'the "y"']],
  ['history', 'the "o" (HIS-try)', ['the "i"', 'the "y"']],
  ['evening', 'the second "e" (EEV-ning)', ['the first "e"', 'the "i"']],
  ['government', 'the first "n" (GUV-ə-mənt)', ['the "e"', 'the "t"']],
  ['next week', '/t/ in "next"', ['/k/ in "week"', 'nothing is lost']],
  ['stand still', '/d/ in "stand"', ['/n/ in "stand"', '/t/ in "still"']],
  ['best friend', '/t/ in "best"', ['/s/ in "best"', '/f/ in "friend"']],
  ['world cup', '/d/ in "world"', ['/l/ in "world"', '/k/ in "cup"']],
  ['mind the gap', '/d/ in "mind"', ['/n/ in "mind"', '/ð/ in "the"']],
  ['past tense', 'the first /t/ (in "past")', ['/s/ in "past"', '/s/ in "tense"']],
  ['blind man', '/d/ in "blind"', ['/n/ in "blind"', '/m/ in "man"']],
];

// ---- Assimilation ------------------------------------------------------------------
interface AssimilationGroup {
  from: string;
  to: string;
  options: string[];
  phrases: string[];
  coalescent?: boolean;
}
const ASSIMILATION: AssimilationGroup[] = [
  { from: 'n', to: 'm', options: ['/n/', '/m/', '/ŋ/'], phrases: ['ten boys', 'green park', 'in bed', 'one more', 'brown paper', 'ten people', 'on purpose', 'sun block', 'ten minutes', 'fine breeze'] },
  { from: 'n', to: 'ŋ', options: ['/n/', '/m/', '/ŋ/'], phrases: ['ten cars', 'in case', 'one game', 'green grass', 'brown coat', 'in Greece', 'main gate', 'on camera'] },
  { from: 't', to: 'p', options: ['/t/', '/p/', '/k/'], phrases: ['that man', 'white paper', 'hot potato', 'great moment', 'get back', 'that boy'] },
  { from: 't', to: 'k', options: ['/t/', '/p/', '/k/'], phrases: ['white coat', 'that girl', 'great game', 'hot coffee', 'that car', 'quite good', 'sit calmly', 'hot cake'] },
  { from: 'd', to: 'b', options: ['/d/', '/b/', '/ɡ/'], phrases: ['good boy', 'bad man', 'red pen', 'sad people', 'hard bed', 'good morning'] },
  { from: 'd', to: 'ɡ', options: ['/d/', '/b/', '/ɡ/'], phrases: ['good girl', 'red car', 'bad cold', 'hard case', 'bad guy', 'good cook', 'bread crumbs', 'old castle'] },
  { from: 's', to: 'ʃ', options: ['/s/', '/ʃ/', '/z/'], phrases: ['this shop', 'nice shoes', 'bus shelter', 'horse show', 'this year', 'miss you'] },
  { from: 'z', to: 'ʒ', options: ['/z/', '/ʒ/', '/s/'], phrases: ['is she', 'does she', 'these shoes', 'cheese shop', 'as you', 'has your'] },
  { from: 't', to: 'tʃ', options: ['/tʃ/', '/dʒ/', '/t/ + /j/, unchanged'], coalescent: true, phrases: ["don't you", 'what you', 'meet you', "can't you", 'last year', 'not yet'] },
  { from: 'd', to: 'dʒ', options: ['/tʃ/', '/dʒ/', '/d/ + /j/, unchanged'], coalescent: true, phrases: ['did you', 'would you', 'could you', 'need you', 'and you', 'behind you'] },
];

function assimilationItems(): ItemDraft[] {
  return ASSIMILATION.flatMap((g) =>
    g.phrases.map((phrase) => {
      const first = phrase.split(' ')[0]!;
      const prompt = g.coalescent
        ? `In fast speech, the /${g.from}/ at the end of "${first}" and the /j/ in "${phrase}" join into one sound. Which?`
        : `In fast speech, what does the last sound of "${first}" become in "${phrase}"?`;
      return {
        kind: 'choice' as const,
        prompt,
        choices: g.options,
        answer: `/${g.to}/`,
        audio: say(phrase),
        tag: 'cs.assimilation',
        explain: g.coalescent
          ? `/${g.from}/ + /j/ → /${g.to}/: "${phrase}" sounds like one word.`
          : `/${g.from}/ becomes /${g.to}/ to get ready for the next sound.`,
      };
    }),
  );
}

// ---- Contractions ------------------------------------------------------------------
const CONTRACTION_GAPS: Array<[string, string[]]> = [
  ["[I'm] going home.", ['I am']],
  ["[She's] a nurse.", ['she is']],
  ["[They're] late.", ['they are']],
  ["[We've] finished.", ['we have']],
  ["[You'll] love it.", ['you will']],
  ["[He'd] already left.", ['he had']],
  ["[I'd] like some water.", ['I would']],
  ["[It's] been a long day.", ['it has']],
  ["[Don't] worry.", ['do not']],
  ["[Can't] you see?", ['cannot', 'can not']],
  ["I [won't] be long.", ['will not']],
  ["She [isn't] here.", ['is not']],
  ["They [aren't] ready.", ['are not']],
  ["He [didn't] call.", ['did not']],
  ["We [haven't] eaten.", ['have not']],
  ["It [wasn't] me.", ['was not']],
  ["You [shouldn't] go.", ['should not']],
  ["[There's] a problem.", ['there is']],
  ["[Let's] start.", ['let us']],
  ["[What's] your name?", ['what is']],
  ["[Where's] the station?", ['where is']],
  ["[Who's] there?", ['who is']],
  ["[That's] right.", ['that is']],
  ["[We're] here.", ['we are']],
  ["[You've] got mail.", ['you have']],
  ["[They'll] be fine.", ['they will']],
  ["[She'll] call you.", ['she will']],
  ["[I've] seen it.", ['I have']],
  ["[He's] got a car.", ['he has']],
  ["It [doesn't] matter.", ['does not']],
  ["They [weren't] home.", ['were not']],
  ["I [couldn't] sleep.", ['could not']],
  ["You [mustn't] run.", ['must not']],
  ["He [hasn't] arrived.", ['has not']],
  ["[We'd] better go.", ['we had']],
  ["[You'd] love it.", ['you would']],
  ["[It'll] rain later.", ['it will']],
  ["[How's] your mother?", ['how is']],
  ["[Here's] your ticket.", ['here is']],
  ["[They've] gone.", ['they have']],
];

// [sentence, contraction, meaning, other meanings]
const CONTRACTION_MEANING: Array<[string, string, string, string[]]> = [
  ["She'd already left.", "'d", 'had', ['would']],
  ["She'd like a coffee.", "'d", 'would', ['had']],
  ["He's got a car.", "'s", 'has', ['is']],
  ["He's a doctor.", "'s", 'is', ['has']],
  ["It's been raining.", "'s", 'has', ['is']],
  ["It's raining.", "'s", 'is', ['has']],
  ["We'd better go.", "'d", 'had', ['would']],
  ["I'd rather stay.", "'d", 'would', ['had']],
  ["They'd finished before we came.", "'d", 'had', ['would']],
  ["They'd help if you asked.", "'d", 'would', ['had']],
  ["She's finished her work.", "'s", 'has', ['is']],
  ["She's working today.", "'s", 'is', ['has']],
  ["Who's seen my keys?", "'s", 'has', ['is']],
  ["Who's calling?", "'s", 'is', ['has']],
  ["Let's go.", "'s", 'us', ['is', 'has']],
  ["What's happened?", "'s", 'has', ['is']],
  ["Where's he going?", "'s", 'is', ['has']],
  ["You'd better hurry.", "'d", 'had', ['would']],
  ["He'd never seen snow before.", "'d", 'had', ['would']],
  ["He'd love to come.", "'d", 'would', ['had']],
  ["I won't tell anyone.", "won't", 'will not', ['want not', 'would not']],
  ["You shan't be late.", "shan't", 'shall not', ['should not', 'can not']],
  ["I can't find it.", "can't", 'cannot', ['could not', 'can it']],
  ["You mustn't smoke here.", "mustn't", 'must not', ['may not', 'need not']],
  ["They aren't coming.", "aren't", 'are not', ['were not', 'is not']],
  ["It isn't fair.", "isn't", 'is not', ['was not', 'are not']],
];

// ---- Shifting stress ---------------------------------------------------------------
// [word alone, word before a noun, sentence (alone), phrase (before a noun)]
const SHIFTING: Array<[string, string, string, string]> = [
  ['thir-*teen', '*thir-teen', 'She is thirteen.', 'thirteen people'],
  ['four-*teen', '*four-teen', 'I am fourteen.', 'fourteen days'],
  ['fif-*teen', '*fif-teen', 'It costs fifteen.', 'fifteen minutes'],
  ['six-*teen', '*six-teen', 'He is sixteen.', 'sixteen students'],
  ['eigh-*teen', '*eigh-teen', 'She turned eighteen.', 'eighteen months'],
  ['nine-*teen', '*nine-teen', 'The answer is nineteen.', 'nineteen years'],
  ['Ja-pa-*nese', '*Ja-pa-nese', 'She is Japanese.', 'Japanese food'],
  ['Chi-*nese', '*Chi-nese', 'He speaks Chinese.', 'Chinese tea'],
  ['af-ter-*noon', '*af-ter-noon', 'See you this afternoon.', 'afternoon tea'],
  ['un-*known', '*un-known', 'The cause is unknown.', 'an unknown man'],
  ['down-*stairs', '*down-stairs', 'She went downstairs.', 'the downstairs room'],
  ['Por-tu-*guese', '*Por-tu-guese', 'He is Portuguese.', 'Portuguese wine'],
  ['an-*tique', '*an-tique', 'This chair is antique.', 'an antique shop'],
  ['well-*known', '*well-known', 'The song is well known.', 'a well-known actor'],
  ['old-*fash-ioned', '*old-fash-ioned', 'His style is old-fashioned.', 'old-fashioned clothes'],
  ['o-ver-*night', '*o-ver-night', 'We stayed overnight.', 'an overnight bus'],
  ['sec-ond-*hand', '*sec-ond-hand', 'I bought it second-hand.', 'a second-hand car'],
  ['bad-*tem-pered', '*bad-tem-pered', 'He was bad-tempered.', 'a bad-tempered man'],
  ['sev-en-*teen', '*sev-en-teen', 'My brother is seventeen.', 'seventeen questions'],
  ['Vi-et-nam-*ese', '*Vi-et-nam-ese', 'Her mother is Vietnamese.', 'Vietnamese coffee'],
  ['up-*stairs', '*up-stairs', 'The bedroom is upstairs.', 'the upstairs window'],
  ['out-*side', '*out-side', "Let's wait outside.", 'the outside wall'],
];

function shiftingItems(): ItemDraft[] {
  return SHIFTING.flatMap(([alone, before, sentence, phrase]) => {
    const word = alone.replace(/\*/g, '').split('-').join('');
    const label = word === 'wellknown' ? 'well-known' : word;
    return [
      stressWord(alone, { prompt: `"${sentence}" — tap the stressed syllable of "${label}".`, spoken: sentence, tag: 'cs.shifting' }),
      stressWord(before, {
        prompt: `"${phrase}" — tap the stressed syllable of "${label}".`,
        spoken: phrase,
        tag: 'cs.shifting',
        explain: 'Before a stressed noun, the stress moves to the front to keep the rhythm regular.',
      }),
    ];
  });
}

// ---- Banks -------------------------------------------------------------------------
const BANKS = {
  sentence: SENTENCES.flatMap(sentenceStressItems),
  weak: [
    ...WEAK_GAPS.flatMap((s) => gapsFrom(s, { tag: 'cs.weak-forms', explain: 'Grammar words are usually said in their weak form, often with /ə/.' })),
    ...WEAK_STRONG.map(([sentence, word, form, other]) =>
      choice(`"${sentence}" — how is "${word}" pronounced here?`, form, [other], {
        audio: say(sentence),
        tag: 'cs.weak-forms',
        explain: 'At the end of a sentence, or when stressed, a grammar word keeps its strong form.',
      }),
    ),
  ],
  linking: linkItems(),
  elision: ELISION.map(([phrase, lost, others]) =>
    choice(`In natural speech, which sound disappears in "${phrase}"?`, lost, others, { audio: say(phrase), tag: 'cs.elision' }),
  ),
  assimilation: assimilationItems(),
  contractions: [
    ...CONTRACTION_GAPS.flatMap(([sentence, full]) => {
      const contraction = /\[([^\]]+)\]/.exec(sentence)![1]!;
      return gapsFrom(sentence, {
        prompt: 'Listen and type the missing word — the short form or the full form.',
        tag: 'cs.contractions',
        accept: { [contraction]: full },
        explain: `${contraction} = ${full[0]}`,
      });
    }),
    ...CONTRACTION_MEANING.map(([sentence, short, meaning, others]) =>
      choice(`"${sentence}" — what does "${short}" mean here?`, meaning, others, { audio: say(sentence), tag: 'cs.contractions' }),
    ),
  ],
  shifting: shiftingItems(),
} satisfies Record<string, ItemDraft[]>;

function practice(key: string, title: string, bank: ItemDraft[], cefr: CatalogActivity['cefr'], intro: string): CatalogActivity {
  return activity({ key, title, kind: 'quiz', cefr, skill: 'pronunciation', mode: 'practice', intro, sampleSize: 15, items: bank });
}

/** A bank item reused as a tutorial's "check" question, found by content
 * rather than position so reordering a bank can't silently swap it. */
function find(bank: ItemDraft[], kind: ItemDraft['kind'], needle: string): ItemDraft {
  const hit = bank.find((i) => i.kind === kind && JSON.stringify(i).includes(needle));
  if (!hit) throw new Error(`no ${kind} item containing "${needle}"`);
  return hit;
}

export const CONNECTED_SPEECH_TAGS: Record<string, CatalogTag> = {
  'cs.sentence-stress': { label: 'Sentence stress', activityKey: 'pron.cs.sentence-stress' },
  'cs.weak-forms': { label: 'Weak forms', activityKey: 'pron.cs.weak-forms' },
  'cs.linking': { label: 'Linking', activityKey: 'pron.cs.linking' },
  'cs.elision': { label: 'Elision (lost sounds)', activityKey: 'pron.cs.elision' },
  'cs.assimilation': { label: 'Assimilation (changing sounds)', activityKey: 'pron.cs.assimilation' },
  'cs.contractions': { label: 'Contractions', activityKey: 'pron.cs.contractions' },
  'cs.shifting': { label: 'Shifting stress', activityKey: 'pron.cs.shifting' },
};

export const CONNECTED_SPEECH_UNIT: CatalogUnit = {
  key: 'pron-connected-speech',
  title: 'Stress & Rhythm 3: Connected Speech',
  description: 'How words change when they join together — step-by-step tutorials with test-as-you-learn checks, then extensive practice.',
  activities: [
    activity({
      key: 'pron.cs.sentence-stress',
      title: 'Tutorial: sentence stress',
      kind: 'tutorial',
      cefr: 'A2',
      skill: 'pronunciation',
      mode: 'practice',
      steps: [
        {
          title: 'Content words and grammar words',
          body: [
            '**Content words** carry the meaning: nouns, main verbs, adjectives, adverbs, question words. They are stressed.',
            '**Grammar words** hold the sentence together: a, the, to, of, and, is, can... They are usually unstressed and quick.',
          ],
          examples: [
            { speech: say('I want to buy a new car.'), note: 'I WANT to BUY a NEW CAR' },
            { speech: say('She went to the market on Monday.'), note: 'she WENT to the MARket on MONday' },
          ],
          checkItemIds: ids(1, 2),
        },
        {
          title: 'The main stress',
          body: [
            'One stress is stronger than the others. In a normal sentence it falls on the **last content word**.',
            'This is where the voice moves most — it tells the listener the important new information.',
          ],
          examples: [
            { speech: say('The train leaves at nine.'), note: 'the TRAIN LEAVES at NINE' },
            { speech: say("I've never been to London."), note: "I've NEVer BEEN to LONdon" },
          ],
          checkItemIds: ids(3, 4),
        },
        {
          title: 'Stress-timed rhythm',
          body: [
            'English keeps a regular beat between stressed syllables. Unstressed syllables in between are squeezed to fit the beat.',
            'So "CATS EAT FISH" and "the CATS will have EATen the FISH" take about the same time to say — three beats each.',
          ],
          examples: [
            { speech: say('Cats eat fish.'), note: 'CATS · EAT · FISH' },
            { speech: say('The cats will have eaten the fish.'), note: 'the CATS will have · EATen the · FISH' },
          ],
          checkItemIds: ids(5),
        },
      ],
      items: [
        find(BANKS.sentence, 'choice', 'I want to buy a new car.'),
        find(BANKS.sentence, 'choice', 'She went to the market on Monday.'),
        find(BANKS.sentence, 'stress', 'The train leaves at nine.'),
        find(BANKS.sentence, 'stress', "I've never been to London."),
        choice('Why does "the cats will have eaten the fish" take about as long as "cats eat fish"?', 'Both have three stressed beats', ['They have the same number of words', 'Grammar words are always silent'], {
          tag: 'cs.sentence-stress',
        }),
      ],
    }),
    practice('pron.cs.sentence-stress.practice', 'Practice: sentence stress', BANKS.sentence, 'A2', 'Find the stressed words and the main stress.'),

    activity({
      key: 'pron.cs.weak-forms',
      title: 'Tutorial: weak forms',
      kind: 'tutorial',
      cefr: 'B1',
      skill: 'pronunciation',
      mode: 'practice',
      steps: [
        {
          title: 'Strong and weak forms',
          body: [
            'Many grammar words have two pronunciations. The **weak form** (usually with /ə/) is the normal one in a sentence.',
            'to → /tə/, for → /fə/, of → /əv/, and → /ən/, can → /kən/, was → /wəz/, them → /ðəm/.',
          ],
          examples: [
            { speech: say("I'd like a cup of tea."), note: 'a /ə/, of /əv/' },
            { speech: say('Fish and chips, please.'), note: 'and /ən/' },
          ],
          checkItemIds: ids(1, 2),
        },
        {
          title: 'When the strong form is used',
          body: [
            'Use the **strong form** when the word is at the end of a sentence, is stressed for contrast, or is said on its own.',
            '"Where are you FROM?" /frɒm/ — but "I\'m from /frəm/ Delhi".',
          ],
          examples: [
            { speech: say('I can swim.'), note: 'can /kən/' },
            { speech: say('Yes, I can.'), note: 'can /kæn/' },
          ],
          checkItemIds: ids(3, 4),
        },
      ],
      items: [
        find(BANKS.weak, 'gap', "I'd like ___ cup of tea."),
        find(BANKS.weak, 'gap', 'Fish ___ chips, please.'),
        find(BANKS.weak, 'choice', '"I can swim."'),
        find(BANKS.weak, 'choice', '"Yes, I can."'),
      ],
    }),
    practice('pron.cs.weak-forms.practice', 'Practice: weak forms', BANKS.weak, 'B1', 'Weak words are hard to hear. Listen carefully and fill the gap.'),

    activity({
      key: 'pron.cs.linking',
      title: 'Tutorial: linking',
      kind: 'tutorial',
      cefr: 'B1',
      skill: 'pronunciation',
      mode: 'practice',
      steps: [
        {
          title: 'Consonant to vowel',
          body: ['When a word ends in a consonant and the next starts with a vowel, the consonant moves across: "turn off" sounds like "tur-noff".'],
          examples: [
            { speech: say('turn off'), note: 'tur‿noff' },
            { speech: say('pick it up'), note: 'pi‿ki‿tup' },
          ],
          checkItemIds: ids(1),
        },
        {
          title: 'Vowel to vowel: /w/ and /j/',
          body: [
            'Between two vowels we slip in a tiny sound. After /uː/, /əʊ/, /aʊ/ it is **/w/**; after /iː/, /eɪ/, /aɪ/, /ɔɪ/ it is **/j/**.',
          ],
          examples: [
            { speech: say('go on'), note: 'go‿(w)on' },
            { speech: say('I agree'), note: 'I‿(y)agree' },
          ],
          checkItemIds: ids(2, 3),
        },
        {
          title: 'Linking /r/',
          body: ['In British English a written r at the end of a word is silent — unless the next word starts with a vowel. Then you hear it: "far away" → "fa-raway".'],
          examples: [
            { speech: say('far away'), note: 'fa‿(r)away' },
            { speech: say('four eggs'), note: 'fou‿(r)eggs' },
          ],
          checkItemIds: ids(4),
        },
      ],
      items: ['"turn off"', '"go on"', '"I agree"', '"far away"'].map((n) => find(BANKS.linking, 'choice', n)),
    }),
    practice('pron.cs.linking.practice', 'Practice: linking', BANKS.linking, 'B1', 'Decide how each pair of words joins together.'),

    activity({
      key: 'pron.cs.elision',
      title: 'Tutorial: elision (lost sounds)',
      kind: 'tutorial',
      cefr: 'B1',
      skill: 'pronunciation',
      mode: 'practice',
      steps: [
        {
          title: 'Lost /t/ and /d/',
          body: [
            'In natural speech, /t/ and /d/ between two consonants often disappear: "next door" → "nex door", "handbag" → "hanbag".',
            'This is not lazy — it is how fluent speakers make speech smooth.',
          ],
          examples: [
            { speech: say('next door'), note: 'nex(t) door' },
            { speech: say('handbag'), note: 'han(d)bag' },
            { speech: say('last night'), note: 'las(t) night' },
          ],
          checkItemIds: ids(1, 2),
        },
        {
          title: 'Lost vowels',
          body: ['An unstressed vowel can disappear completely: "chocolate" has two syllables, "family" often has two, "different" two.'],
          examples: [
            { speech: say('chocolate'), note: 'CHOC-lət' },
            { speech: say('different'), note: 'DIF-rənt' },
            { speech: say('vegetable'), note: 'VEJ-tə-bl' },
          ],
          checkItemIds: ids(3),
        },
      ],
      items: ['"next door"', '"handbag"', '"chocolate"'].map((n) => find(BANKS.elision, 'choice', n)),
    }),
    practice('pron.cs.elision.practice', 'Practice: elision', BANKS.elision, 'B1', 'Which sound drops out in natural speech?'),

    activity({
      key: 'pron.cs.assimilation',
      title: 'Tutorial: assimilation (changing sounds)',
      kind: 'tutorial',
      cefr: 'B2',
      skill: 'pronunciation',
      mode: 'practice',
      steps: [
        {
          title: 'Sounds get ready for the next sound',
          body: [
            'A sound at the end of a word can change to be more like the first sound of the next word.',
            '/n/ before /p b m/ becomes /m/: "ten boys" → "tem boys". /t/ before /k ɡ/ becomes /k/: "white coat" → "whi**k** coat".',
          ],
          examples: [
            { speech: say('ten boys'), note: 'te(m) boys' },
            { speech: say('good girl'), note: 'goo(g) girl' },
            { speech: say('white coat'), note: 'whi(k) coat' },
          ],
          checkItemIds: ids(1, 2),
        },
        {
          title: 'Two sounds become one',
          body: ['/t/ or /d/ followed by /j/ join into a new sound: "don\'t you" → "donchoo", "did you" → "dijoo". /s/ + /ʃ/ → /ʃ/: "this shop" → "thi-shop".'],
          examples: [
            { speech: say("don't you"), note: '/tʃ/' },
            { speech: say('did you'), note: '/dʒ/' },
            { speech: say('this shop'), note: '/ʃ/' },
          ],
          checkItemIds: ids(3),
        },
      ],
      items: ['"ten boys"', '"good girl"', `"don't you"`].map((n) => find(BANKS.assimilation, 'choice', n)),
    }),
    practice('pron.cs.assimilation.practice', 'Practice: assimilation', BANKS.assimilation, 'B2', 'How do the sounds change in fast speech?'),

    activity({
      key: 'pron.cs.contractions',
      title: 'Tutorial: contractions',
      kind: 'tutorial',
      cefr: 'A2',
      skill: 'pronunciation',
      mode: 'practice',
      steps: [
        {
          title: 'Short forms',
          body: ["In speech, pronouns and auxiliary verbs join: I am → I'm, they are → they're, we have → we've, he will → he'll, do not → don't."],
          examples: [
            { speech: say("I'm going home."), note: "I'm = I am" },
            { speech: say("They're late."), note: "they're = they are" },
          ],
          checkItemIds: ids(1),
        },
        {
          title: "Which one is it? 's and 'd",
          body: [
            "**'s** can be *is* or *has*: \"He's a doctor\" (is), \"He's got a car\" (has). Look at the next word — a past participle (been, finished) means *has*.",
            "**'d** can be *had* or *would*: \"She'd left\" (had), \"She'd like\" (would). A past participle means *had*; an infinitive (like, love) means *would*.",
          ],
          examples: [
            { speech: say("She'd already left."), note: "'d = had" },
            { speech: say("She'd like a coffee."), note: "'d = would" },
          ],
          checkItemIds: ids(2, 3),
        },
      ],
      items: [
        find(BANKS.contractions, 'gap', '___ going home.'),
        find(BANKS.contractions, 'choice', "She'd already left."),
        find(BANKS.contractions, 'choice', "She'd like a coffee."),
      ],
    }),
    practice('pron.cs.contractions.practice', 'Practice: contractions', BANKS.contractions, 'A2', "Hear the short forms and work out what they mean."),

    activity({
      key: 'pron.cs.shifting',
      title: 'Tutorial: shifting stress',
      kind: 'tutorial',
      cefr: 'B2',
      skill: 'pronunciation',
      mode: 'practice',
      steps: [
        {
          title: 'Stress that moves',
          body: [
            'Some words change their stress to keep the rhythm regular. Said alone, "thirteen" is thir-TEEN. Before a stressed noun it becomes THIR-teen PEOple — so two stresses do not bump into each other.',
          ],
          examples: [
            { speech: say('She is thirteen.'), note: 'thir-TEEN' },
            { speech: say('thirteen people'), note: 'THIR-teen PEO-ple' },
            { speech: say('Japanese food'), note: 'JA-pa-nese FOOD' },
          ],
          checkItemIds: ids(1, 2),
        },
      ],
      items: [find(BANKS.shifting, 'stress', 'She is thirteen.'), find(BANKS.shifting, 'stress', '"thirteen people"')],
    }),
    practice('pron.cs.shifting.practice', 'Practice: shifting stress', BANKS.shifting, 'B2', 'Is the word alone, or before a noun?'),

    activity({
      key: 'pron.cs.test',
      title: 'Stress & Rhythm test',
      kind: 'quiz',
      cefr: 'B2',
      skill: 'pronunciation',
      mode: 'test',
      intro: 'Twenty-five questions from every area of connected speech — different every time. At the end you will see which areas to review.',
      sampleSize: 25,
      items: Object.values(BANKS).flat(),
    }),
  ],
};

/** Every audio-bearing item in the three Stress & Rhythm units, counted by
 * the catalog spec against Ser 10's "over 600 sound items". */
export function countSoundItems(items: CourseItem[]): number {
  return items.filter((i) => 'audio' in i && i.audio && i.audio.length > 0).length;
}
