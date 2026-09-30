import { fill, mc, type Tense } from './helpers';

export const PRESENT_SIMPLE: Tense = {
  key: 'present-simple',
  title: 'Present simple',
  cefr: 'A1',
  group: 'present',
  hint: 'Present simple: the base verb, with -s/-es after he, she, it. Questions and negatives use do/does + base verb.',
  steps: [
    {
      title: 'How to form it',
      body: [
        '**I / you / we / they:** the base verb — *I work*, *they live*.',
        '**He / she / it:** add **-s** (or **-es** after -s, -sh, -ch, -x, -o; **-ies** after consonant + y) — *she works*, *he watches*, *it studies*.',
        '**Negative:** do not / does not + base verb — *I don’t work*, *she doesn’t work*.',
        '**Question:** Do / Does + subject + base verb — *Do you work?*, *Does she work?*',
      ],
      examples: [
        ['My sister works in a hospital.', 'he/she/it + -s'],
        ['She doesn’t like coffee.', 'does not + base verb'],
        ['Do they live near here?', 'Do + subject + base verb'],
      ],
      checks: [mc('He ___ to school by bus.', 'goes', ['go', 'going']), fill('She ___ (watch) TV every evening.', ['watches'])],
    },
    {
      title: 'When we use it',
      body: [
        'Habits and routines: *I get up at six every day.*',
        'Facts that are always true: *The sun rises in the east.*',
        'Timetables: *The train leaves at 7.15.*',
      ],
      examples: [
        ['I get up at six every day.', 'habit'],
        ['Water boils at one hundred degrees.', 'fact'],
        ['The film starts at eight.', 'timetable'],
      ],
      checks: [mc('Ice ___ when it gets warm.', 'melts', ['melt', 'is melting'])],
    },
    {
      title: 'Time words and common mistakes',
      body: [
        'Time words: **always, usually, often, sometimes, never, every day, on Mondays, once a week.** They usually go *before* the main verb: *She **often** walks to work.*',
        'Common mistakes: *She **go** to school* (add -s), *Does she **works**?* (after does, use the base verb), *He **don’t** like tea* (use doesn’t).',
      ],
      checks: [mc('Does your brother ___ football?', 'play', ['plays', 'playing']), mc('They ___ like fish.', 'don’t', ['doesn’t', 'isn’t'])],
    },
  ],
  bank: [
    mc('My brother ___ football every Saturday.', 'plays', ['play', 'is playing']),
    mc('They ___ in a small flat near the station.', 'live', ['lives', 'living']),
    mc('The train to Pune ___ at 6.30 every morning.', 'leaves', ['leave', 'leaving']),
    mc('___ you speak Hindi?', 'Do', ['Are', 'Does']),
    mc('She ___ like spicy food.', 'doesn’t', ['don’t', 'isn’t']),
    mc('Water ___ at 100 degrees Celsius.', 'boils', ['boil', 'is boiling']),
    mc('How often ___ he check his email?', 'does', ['do', 'is']),
    mc('I ___ up at six o’clock on weekdays.', 'get', ['gets', 'am getting']),
    mc('___ your sister work in a bank?', 'Does', ['Do', 'Is']),
    mc('We ___ TV in the morning.', 'don’t watch', ['doesn’t watch', 'not watch']),
    mc('The shop ___ on Sundays.', 'doesn’t open', ['don’t open', 'not opens']),
    mc('Ravi usually ___ his homework after dinner.', 'does', ['do', 'doing']),
    mc('The sun ___ in the east.', 'rises', ['rise', 'is rising']),
    mc('My parents ___ tea, but I prefer coffee.', 'like', ['likes', 'are liking']),
    fill('She ___ (study) English at night school.', ['studies']),
    fill('My dad ___ (not / drink) coffee.', ['doesn’t drink', 'does not drink']),
    fill('___ (she / have) a car?', ['Does she have']),
    fill('The bus ___ (stop) outside my house.', ['stops']),
    fill('My cat ___ (watch) birds from the window all day.', ['watches']),
    fill('We ___ (not / go) to school on Sunday.', ['don’t go', 'do not go']),
  ],
};

export const PRESENT_CONTINUOUS: Tense = {
  key: 'present-continuous',
  title: 'Present continuous',
  cefr: 'A1',
  group: 'present',
  hint: 'Present continuous: am/is/are + verb-ing, for actions happening now or around now. State verbs (like, know, want) are not used in it.',
  steps: [
    {
      title: 'How to form it',
      body: [
        '**am / is / are + verb-ing:** *I am working*, *she is working*, *they are working*.',
        '**Negative:** add not — *I’m not working*, *he isn’t working*, *we aren’t working*.',
        '**Question:** swap the subject and am/is/are — *Are you working?*, *What is she doing?*',
        'Spelling: *run → running* (double the consonant), *make → making* (drop the e).',
      ],
      examples: [
        ['I am reading a book.', 'am + -ing'],
        ['She isn’t sleeping.', 'is not + -ing'],
        ['What are you doing?', 'question'],
      ],
      checks: [
        mc('Look! The children ___ in the garden.', 'are playing', ['play', 'is playing']),
        fill('He ___ (not / listen) to me.', ['isn’t listening', 'is not listening']),
      ],
    },
    {
      title: 'When we use it',
      body: [
        'Actions happening **now**: *Please be quiet — the baby is sleeping.*',
        'Temporary situations **around now**: *I’m staying with my cousin this week.*',
        'Changes and trends: *Prices are rising.*',
        '**State verbs** (like, love, know, want, need, understand, believe) are normally *not* used in the continuous: *I **like** this song* (not *I am liking*).',
      ],
      examples: [
        ['Listen! Someone is knocking at the door.', 'now'],
        ['I’m staying with my cousin this week.', 'temporary'],
        ['I know the answer.', 'state verb — simple, not continuous'],
      ],
      checks: [mc('I ___ the answer. Let me tell you.', 'know', ['am knowing', 'knowing'])],
    },
    {
      title: 'Time words and common mistakes',
      body: [
        'Time words: **now, at the moment, right now, today, this week, currently, look!, listen!**',
        'Common mistakes: *She **is work** now* (add -ing), *They **working** now* (don’t forget are), *I **am wanting** a coffee* (want is a state verb).',
      ],
      checks: [mc('Why ___ she crying?', 'is', ['does', 'are']), fill('Shh! The baby ___ (sleep).', ['is sleeping'])],
    },
  ],
  bank: [
    mc('Please be quiet. The baby ___.', 'is sleeping', ['sleeps', 'sleeping']),
    mc('Look! It ___ outside.', 'is raining', ['rains', 'rain']),
    mc('I ___ for a new job at the moment.', 'am looking', ['look', 'looks']),
    mc('What ___ you doing right now?', 'are', ['do', 'is']),
    mc('They ___ dinner at the moment.', 'aren’t having', ['don’t have', 'isn’t having']),
    mc('Why ___ she crying?', 'is', ['does', 'are']),
    mc('We ___ in a hotel this week because our flat is being painted.', 'are staying', ['stay', 'stayed']),
    mc('He ___ a shower, so he can’t answer the phone.', 'is taking', ['takes', 'take']),
    mc('Are the children ___ in the garden?', 'playing', ['play', 'plays']),
    mc('Right now my sister ___ for her exams.', 'is studying', ['studies', 'study']),
    mc('Listen! Somebody ___ at the door.', 'is knocking', ['knocks', 'knock']),
    mc('I ___ this song. Can you play it again?', 'like', ['am liking', 'liking'], 'Like is a state verb, so it is not used in the continuous.'),
    mc('She ___ on the phone now.', 'is talking', ['talks', 'talk']),
    mc('Why are you ___ a coat? It’s very hot.', 'wearing', ['wear', 'wears']),
    fill('Shh! The children ___ (sleep).', ['are sleeping']),
    fill('___ (I / not / work) today — it’s a holiday.', ['I’m not working', 'I am not working']),
    fill('What ___ (he / do) in the kitchen?', ['is he doing']),
    fill('The students ___ (take) an exam now.', ['are taking']),
    fill('It ___ (not / rain) at the moment.', ['isn’t raining', 'is not raining']),
    fill('Look! The bus ___ (come).', ['is coming']),
  ],
};

export const PRESENT_PERFECT: Tense = {
  key: 'present-perfect',
  title: 'Present perfect',
  cefr: 'A2',
  group: 'present',
  hint: 'Present perfect: have/has + past participle, for experiences, recent news, and situations that started in the past and continue now. Do not use it with a finished time (yesterday, last week, in 2019).',
  steps: [
    {
      title: 'How to form it',
      body: [
        '**have / has + past participle:** *I have finished*, *she has finished*.',
        'Regular verbs add -ed (*worked*); irregular ones must be learnt: *go → gone*, *see → seen*, *write → written*, *eat → eaten*.',
        '**Negative:** haven’t / hasn’t + past participle — *He hasn’t called.*',
        '**Question:** Have / Has + subject + past participle — *Have you ever been to Goa?*',
      ],
      examples: [
        ['I have finished my homework.', 'have + participle'],
        ['She hasn’t seen that film.', 'has not + participle'],
        ['Have you ever been to Japan?', 'question with ever'],
      ],
      checks: [mc('She has ___ her keys.', 'lost', ['lose', 'losed']), fill('They ___ (already / arrive).', ['have already arrived'])],
    },
    {
      title: 'When we use it',
      body: [
        '**Life experience** (no time given): *I have visited Jaipur twice.*',
        '**Recent events with a result now:** *I’ve lost my keys* (so I can’t get in).',
        '**Unfinished time — for and since:** *We have lived here **for** ten years / **since** 2015.*',
        'If the time is finished and stated (yesterday, last year, in 2020), use the **past simple**: *I **saw** it last week.*',
      ],
      examples: [
        ['I have visited Jaipur twice.', 'experience'],
        ['We have lived here since 2015.', 'unfinished time'],
        ['I saw that film last week.', 'finished time — past simple'],
      ],
      checks: [mc('I ___ that film last week.', 'saw', ['have seen', 'has seen'])],
    },
    {
      title: 'Time words and common mistakes',
      body: [
        'Time words: **ever, never, just, already, yet, so far, recently, for, since.**',
        '*Yet* goes at the end of negatives and questions: *I haven’t finished **yet**.* *Already* goes before the participle: *I’ve **already** finished.*',
        'Common mistakes: *She **has live** here* (live**d**), *I have seen him **yesterday*** (finished time → past simple), *I **have** finish* (finish**ed**).',
      ],
      checks: [
        mc('He ___ his homework yet.', 'hasn’t finished', ['hasn’t finish', 'doesn’t finished']),
        fill('___ (you / ever / eat) Chinese food?', ['Have you ever eaten']),
      ],
    },
  ],
  bank: [
    mc('I ___ this film three times.', 'have seen', ['saw', 'have saw']),
    mc('She ___ in Delhi since 2019.', 'has lived', ['lived', 'is living']),
    mc('___ you ever been to Japan?', 'Have', ['Did', 'Are']),
    mc('They ___ just arrived.', 'have', ['has', 'are']),
    mc('My brother ___ his wallet, so he can’t pay.', 'has lost', ['have lost', 'is losing']),
    mc('We ___ each other for ten years.', 'have known', ['know', 'knew']),
    mc('How long ___ you worked here?', 'have', ['did', 'are']),
    mc('He ___ his homework yet.', 'hasn’t finished', ['hasn’t finish', 'doesn’t finished']),
    mc('This is the best meal I ___ ever eaten.', 'have', ['did', 'has']),
    mc('I ___ to the dentist last week.', 'went', ['have been', 'have gone'], 'Last week is a finished time, so use the past simple.'),
    mc('Has Mona ___ her email yet?', 'checked', ['check', 'checks']),
    mc('We ___ our new car for two weeks.', 'have had', ['have', 'are having']),
    mc('It’s the first time she ___ a horse.', 'has ridden', ['rides', 'rode']),
    mc('She has ___ three books this month.', 'read', ['reads', 'reading']),
    fill('I ___ (finish) my report.', ['have finished']),
    fill('She ___ (not / see) that film yet.', ['hasn’t seen', 'has not seen']),
    fill('___ (you / ever / eat) Chinese food?', ['Have you ever eaten']),
    fill('They ___ (live) here since 2015.', ['have lived']),
    fill('He ___ (break) his arm, so he can’t write.', ['has broken']),
    fill('We ___ (already / book) the tickets.', ['have already booked']),
  ],
};

export const PRESENT_PERFECT_CONTINUOUS: Tense = {
  key: 'present-perfect-continuous',
  title: 'Present perfect continuous',
  cefr: 'B1',
  group: 'present',
  hint: 'Present perfect continuous: have/has been + verb-ing, for an activity that started in the past and is still going on, or has just stopped and has a visible result.',
  steps: [
    {
      title: 'How to form it',
      body: [
        '**have / has + been + verb-ing:** *I have been waiting*, *she has been working*.',
        '**Negative:** haven’t / hasn’t been + -ing — *It hasn’t been raining.*',
        '**Question:** Have / Has + subject + been + -ing — *How long have you been learning English?*',
      ],
      examples: [
        ['I have been waiting for an hour.', 'have been + -ing'],
        ['She hasn’t been sleeping well.', 'has not been + -ing'],
        ['How long have you been learning English?', 'question'],
      ],
      checks: [mc('They have been ___ tennis since nine o’clock.', 'playing', ['play', 'played']), fill('It ___ (rain) all day.', ['has been raining'])],
    },
    {
      title: 'When we use it',
      body: [
        '**An activity that started in the past and is still going on** — the activity itself matters, with *for* or *since*: *I’ve been studying since six.*',
        '**An activity that has just stopped, with a visible result:** *Your hands are dirty — have you been working in the garden?*',
        'Compare: *I’ve **been reading** this book* (the activity — maybe unfinished) and *I’ve **read** this book* (finished, a result).',
      ],
      examples: [
        ['I’ve been studying since six o’clock.', 'still going on'],
        ['Her eyes are red. She has been crying.', 'visible result'],
      ],
      checks: [mc('Her eyes are red. She ___.', 'has been crying', ['cries', 'cried'])],
    },
    {
      title: 'Time words and common mistakes',
      body: [
        'Time words: **for, since, all day, all week, lately, recently, how long.**',
        'State verbs (know, like, have = own) do not take the continuous: *I’ve **known** her for years* (not *I’ve been knowing*).',
        'Common mistakes: *I have **been wait*** (-ing), *She **has been work*** (-ing), *I **am waiting** for an hour* (for an hour → present perfect continuous).',
      ],
      checks: [
        mc('We ___ for a new flat since June.', 'have been looking', ['are looking', 'look']),
        fill('How long ___ (you / wait)?', ['have you been waiting']),
      ],
    },
  ],
  bank: [
    mc('I ___ for you for an hour!', 'have been waiting', ['am waiting', 'waited']),
    mc('She’s tired because she ___ all day.', 'has been working', ['is working', 'worked']),
    mc('How long ___ you been learning English?', 'have', ['did', 'are']),
    mc('It ___ for three days. The streets are flooded.', 'has been raining', ['rains', 'is raining']),
    mc('They ___ tennis since nine o’clock.', 'have been playing', ['are playing', 'play']),
    mc('Why are your hands dirty? — I ___ in the garden.', 'have been working', ['work', 'am working']),
    mc('He ___ here for long.', 'hasn’t been working', ['isn’t working', 'hasn’t working']),
    mc('We ___ for a new flat since June.', 'have been looking', ['are looking', 'look']),
    mc('I ___ this book all week. It’s really good.', 'have been reading', ['read', 'am reading']),
    mc('Her eyes are red. She ___.', 'has been crying', ['cries', 'cried']),
    mc('What have you been ___ lately?', 'doing', ['do', 'did']),
    mc('I ___ for you for ages! Where have you been?', 'have been looking', ['look', 'am looking']),
    mc('The phone ___ for ten minutes. Why doesn’t anyone answer?', 'has been ringing', ['has ring', 'is ringing']),
    mc('Sam ___ football since he was six.', 'has been playing', ['is playing', 'played']),
    fill('I ___ (learn) French for two years.', ['have been learning']),
    fill('She ___ (not / sleep) well recently.', ['hasn’t been sleeping', 'has not been sleeping']),
    fill('How long ___ (you / wait)?', ['have you been waiting']),
    fill('They ___ (build) the bridge since 2021.', ['have been building']),
    fill('We ___ (talk) for hours.', ['have been talking']),
    fill('He ___ (run), so he is out of breath.', ['has been running']),
  ],
};

export const PRESENT_TENSES: Tense[] = [PRESENT_SIMPLE, PRESENT_CONTINUOUS, PRESENT_PERFECT, PRESENT_PERFECT_CONTINUOUS];
