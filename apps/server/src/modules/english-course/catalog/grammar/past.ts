import { fill, mc, type Tense } from './helpers';

export const PAST_SIMPLE: Tense = {
  key: 'past-simple',
  title: 'Past simple',
  cefr: 'A1',
  group: 'past',
  hint: 'Past simple: verb + -ed (or an irregular past form) for finished actions. Questions and negatives use did/didn’t + base verb.',
  steps: [
    {
      title: 'How to form it',
      body: [
        '**Regular verbs:** add **-ed** — *work → worked*, *study → studied*, *stop → stopped*.',
        '**Irregular verbs** have their own form: *go → went*, *see → saw*, *buy → bought*, *have → had*. (**be**: *was / were*.)',
        '**Negative:** didn’t + base verb — *I didn’t go.* (not *didn’t went*)',
        '**Question:** Did + subject + base verb — *Did you call?* (not *Did you called?*)',
      ],
      examples: [
        ['We visited my grandparents last week.', 'regular: -ed'],
        ['She went to Goa in 2022.', 'irregular: went'],
        ['Did you see the match?', 'Did + base verb'],
      ],
      checks: [mc('I ___ a film last night.', 'watched', ['watch', 'watching']), fill('They ___ (buy) a new car last month.', ['bought'])],
    },
    {
      title: 'When we use it',
      body: [
        'A **finished action at a finished time** — the time is stated or understood: *I saw her yesterday.* *He lived in Delhi for five years* (but he doesn’t now).',
        'A **series of past actions** (a story): *I got up, had breakfast and left.*',
        'Compare the present perfect, which has no finished time: *I have seen that film.*',
      ],
      examples: [
        ['I saw her yesterday.', 'finished time'],
        ['I got up, had breakfast and left.', 'a series of actions'],
      ],
      checks: [mc('We ___ in Mumbai in 2015.', 'lived', ['have lived', 'live'])],
    },
    {
      title: 'Time words and common mistakes',
      body: [
        'Time words: **yesterday, last night / week / year, in 2020, two days ago, when I was a child.**',
        'Common mistakes: *She **didn’t went*** (after didn’t use the base verb), ***Did** you **saw**?* (did + see), *I **goed*** (irregular: went), *I have seen him **yesterday*** (finished time → past simple).',
      ],
      checks: [mc('She ___ to the party.', 'didn’t come', ['didn’t came', 'not came']), fill('___ (you / see) the news yesterday?', ['Did you see'])],
    },
  ],
  bank: [
    mc('I ___ a film last night.', 'watched', ['watch', 'have watched']),
    mc('She ___ to Goa in 2022.', 'went', ['goes', 'has gone']),
    mc('We ___ breakfast this morning.', 'didn’t have', ['don’t had', 'didn’t had']),
    mc('___ you call me yesterday?', 'Did', ['Do', 'Were']),
    mc('They ___ the match last Sunday.', 'won', ['win', 'winned']),
    mc('He ___ at home yesterday.', 'wasn’t', ['weren’t', 'didn’t']),
    mc('I ___ my glasses, so I couldn’t read.', 'forgot', ['forget', 'have forgot']),
    mc('When ___ you arrive?', 'did', ['do', 'have']),
    mc('The film ___ at nine yesterday.', 'started', ['starts', 'starting']),
    mc('She ___ her keys on the bus.', 'left', ['leaved', 'leave']),
    mc('We ___ dinner and then went for a walk.', 'had', ['have', 'having']),
    mc('Mahesh ___ up late last Saturday.', 'got', ['gets', 'get']),
    mc('Where ___ you buy that bag?', 'did', ['do', 'have']),
    mc('The children ___ very tired after the trip.', 'were', ['was', 'did']),
    fill('I ___ (visit) my grandparents last week.', ['visited']),
    fill('She ___ (not / come) to the party.', ['didn’t come', 'did not come']),
    fill('___ (you / see) the news yesterday?', ['Did you see']),
    fill('We ___ (buy) a new TV last month.', ['bought']),
    fill('He ___ (study) hard, so he passed.', ['studied']),
    fill('They ___ (be) at the cinema last night.', ['were']),
  ],
};

export const PAST_CONTINUOUS: Tense = {
  key: 'past-continuous',
  title: 'Past continuous',
  cefr: 'A2',
  group: 'past',
  hint: 'Past continuous: was/were + verb-ing, for an action in progress at a moment in the past, often interrupted by a past simple action.',
  steps: [
    {
      title: 'How to form it',
      body: [
        '**was / were + verb-ing:** *I was working*, *you were working*, *she was working*, *they were working*.',
        '**Negative:** wasn’t / weren’t + -ing — *We weren’t sleeping.*',
        '**Question:** Was / Were + subject + -ing — *What were you doing?*',
      ],
      examples: [
        ['I was cooking dinner.', 'was + -ing'],
        ['They weren’t listening.', 'were not + -ing'],
        ['What were you doing at nine?', 'question'],
      ],
      checks: [mc('We ___ TV at eight last night.', 'were watching', ['was watching', 'are watching']), fill('She ___ (not / work).', ['wasn’t working', 'was not working'])],
    },
    {
      title: 'When we use it',
      body: [
        'An action **in progress at a moment in the past:** *At nine o’clock I was having breakfast.*',
        'A **long action interrupted by a short one** — long action in the past continuous, short one in the past simple: *I **was walking** home when it **started** to rain.*',
        '**Two actions at the same time:** *She was reading while he was cooking.*',
      ],
      examples: [
        ['I was walking home when it started to rain.', 'long action + interruption'],
        ['She was reading while he was cooking.', 'at the same time'],
      ],
      checks: [mc('I ___ dinner when the phone rang.', 'was cooking', ['cooked', 'am cooking'])],
    },
    {
      title: 'Time words and common mistakes',
      body: [
        'Words: **while, when, at that moment, at 8 o’clock last night, all evening.**',
        'Common mistakes: *They **was** playing* (they were), *I **was know*** (was knowing isn’t used; state verbs stay simple: *I **knew***), *I was **walk*** (-ing).',
      ],
      checks: [mc('What ___ he doing when you called?', 'was', ['were', 'did']), fill('We ___ (walk) home when it started to rain.', ['were walking'])],
    },
  ],
  bank: [
    mc('I ___ TV when the phone rang.', 'was watching', ['am watching', 'watch']),
    mc('They ___ football at five o’clock yesterday.', 'were playing', ['was playing', 'are playing']),
    mc('What ___ you doing at 8 pm?', 'were', ['did', 'are']),
    mc('It ___ when we left the house.', 'was raining', ['is raining', 'rains']),
    mc('While I ___ the dishes, I dropped a plate.', 'was washing', ['were washing', 'was wash']),
    mc('We ___ when the lights went out.', 'were having dinner', ['was having dinner', 'have dinner']),
    mc('Mona ___ at that time.', 'wasn’t listening', ['weren’t listening', 'didn’t listening']),
    mc('Was it ___ when you left?', 'snowing', ['snow', 'snows']),
    mc('The kids ___ in the garden all afternoon.', 'were playing', ['was playing', 'are playing']),
    mc('I saw an accident while I ___ to work.', 'was walking', ['were walking', 'am walking']),
    mc('What ___ he doing when you called?', 'was', ['were', 'did']),
    mc('At midnight, we ___.', 'were still working', ['was still working', 'are still working']),
    mc('They ___ TV; they were asleep.', 'weren’t watching', ['wasn’t watching', 'aren’t watching']),
    mc('She ___ her phone when she fell.', 'was holding', ['holded', 'were holding']),
    fill('I ___ (cook) when he arrived.', ['was cooking']),
    fill('They ___ (not / pay) attention.', ['weren’t paying', 'were not paying']),
    fill('What ___ (you / do) at nine last night?', ['were you doing']),
    fill('We ___ (walk) home when it started to rain.', ['were walking']),
    fill('She ___ (talk) on the phone while she was driving.', ['was talking']),
    fill('The baby ___ (sleep) when I came in.', ['was sleeping']),
  ],
};

export const PAST_PERFECT: Tense = {
  key: 'past-perfect',
  title: 'Past perfect',
  cefr: 'B1',
  group: 'past',
  hint: 'Past perfect: had + past participle, for an action that happened before another past action or time.',
  steps: [
    {
      title: 'How to form it',
      body: [
        '**had + past participle:** the same for every subject — *I had finished*, *she had finished*, *they had finished*.',
        '**Negative:** hadn’t + past participle — *He hadn’t eaten.*',
        '**Question:** Had + subject + past participle — *Had you met her before?*',
      ],
      examples: [
        ['When I arrived, the film had started.', 'had + participle'],
        ['She hadn’t eaten anything.', 'had not + participle'],
        ['Had you met her before?', 'question'],
      ],
      checks: [mc('They ___ already left.', 'had', ['have', 'has']), fill('He ___ (not / finish) his work.', ['hadn’t finished', 'had not finished'])],
    },
    {
      title: 'When we use it',
      body: [
        'To show that one past action happened **before** another: *When I got to the station, the train **had left**.* (First the train left, then I arrived.)',
        'Often after **after, before, by the time, when, because, as soon as**: *She was upset because she **had lost** her passport.*',
        'Put the events in order in your head: earlier → **past perfect**, later → **past simple**.',
      ],
      examples: [
        ['When I got to the station, the train had left.', 'the train left first'],
        ['After he had eaten, he watched TV.', 'eating came first'],
      ],
      checks: [mc('By the time we arrived, the concert ___.', 'had started', ['started', 'has started'])],
    },
    {
      title: 'Time words and common mistakes',
      body: [
        'Words: **already, just, never … before, by the time, after, before, when.**',
        'With *before* and *after* the order is already clear, so the past simple is often fine: *I had never seen snow before I **moved** to Canada.*',
        'Common mistakes: *He **has** left when I arrived* (use had), *She **had went*** (had **gone**), *I had **see*** (had seen).',
      ],
      checks: [
        mc('She felt better after she ___ some rest.', 'had taken', ['has taken', 'take']),
        fill('After she ___ (read) the letter, she cried.', ['had read']),
      ],
    },
  ],
  bank: [
    mc('When I arrived, the film ___.', 'had already started', ['has already started', 'have already started']),
    mc('She was upset because she ___ her passport.', 'had lost', ['has lost', 'have lost']),
    mc('I had never seen snow before I ___ to Canada.', 'moved', ['had moved', 'have moved']),
    mc('By the time we got to the station, the train ___.', 'had left', ['has left', 'leaves']),
    mc('After he ___ dinner, he watched TV.', 'had eaten', ['has eaten', 'eats']),
    mc('They ___ for an hour when the bus finally came.', 'had waited', ['has waited', 'have waited']),
    mc('___ you finished your homework before dinner?', 'Had', ['Have', 'Did']),
    mc('He said he ___ the report already.', 'had written', ['has written', 'writes']),
    mc('The teacher was angry because nobody ___ the homework.', 'had done', ['has done', 'have done']),
    mc('Mohan felt better after he ___ some rest.', 'had taken', ['has taken', 'take']),
    mc('We ___ already left when it started to rain.', 'had', ['have', 'were']),
    mc('She ___ English before she moved to London.', 'had studied', ['has studied', 'studies']),
    mc('I realised that I ___ my wallet at home.', 'had left', ['have left', 'leave']),
    mc('By the time I called, he ___ out.', 'had gone', ['has gone', 'goes']),
    fill('When we arrived, the concert ___ (begin).', ['had begun']),
    fill('She ___ (not / eat) anything before the exam.', ['hadn’t eaten', 'had not eaten']),
    fill('___ (they / finish) the work before you came?', ['Had they finished']),
    fill('I ___ (see) that film before, so I didn’t go.', ['had seen']),
    fill('He ___ (already / leave) when I got there.', ['had already left']),
    fill('After she ___ (read) the letter, she cried.', ['had read']),
  ],
};

export const PAST_PERFECT_CONTINUOUS: Tense = {
  key: 'past-perfect-continuous',
  title: 'Past perfect continuous',
  cefr: 'B2',
  group: 'past',
  hint: 'Past perfect continuous: had been + verb-ing, for an activity that was going on up to a moment in the past, often explaining a result at that time.',
  steps: [
    {
      title: 'How to form it',
      body: [
        '**had + been + verb-ing:** *I had been working*, *they had been waiting*.',
        '**Negative:** hadn’t been + -ing — *She hadn’t been sleeping.*',
        '**Question:** Had + subject + been + -ing — *How long had you been waiting?*',
      ],
      examples: [
        ['I had been working all night.', 'had been + -ing'],
        ['She hadn’t been sleeping well.', 'had not been + -ing'],
        ['How long had you been waiting?', 'question'],
      ],
      checks: [mc('They had been ___ for an hour.', 'waiting', ['wait', 'waited']), fill('I ___ (work) all day.', ['had been working'])],
    },
    {
      title: 'When we use it',
      body: [
        'An activity that **continued up to a moment in the past**, often with *for* or *since*: *By noon, they **had been driving** for six hours.*',
        'An activity that explains **a situation in the past:** *Her eyes were red. She **had been crying**.*',
        'Compare: *had been waiting* (how long the activity lasted) and *had waited* (simply finished).',
      ],
      examples: [
        ['By noon they had been driving for six hours.', 'duration up to a past moment'],
        ['Her eyes were red. She had been crying.', 'explains the situation'],
      ],
      checks: [mc('The ground was wet. It ___.', 'had been raining', ['has been raining', 'was rain'])],
    },
    {
      title: 'Time words and common mistakes',
      body: [
        'Words: **for, since, all morning, how long, by the time, when.**',
        'State verbs (know, like, be) stay simple: *She **had known** him for years.*',
        'Common mistakes: *had **be** waiting* (been), *had been **wait*** (-ing), *has been waiting* (use **had** in a past story).',
      ],
      checks: [mc('How long ___ you been studying before the exam?', 'had', ['have', 'did']), fill('We ___ (drive) for six hours when the car broke down.', ['had been driving'])],
    },
  ],
  bank: [
    mc('She was tired because she ___ all night.', 'had been working', ['has been working', 'was been working']),
    mc('When he arrived, I ___ for two hours.', 'had been waiting', ['have been waiting', 'was been waiting']),
    mc('The ground was wet. It ___.', 'had been raining', ['has been raining', 'was rain']),
    mc('How long ___ you been studying before the exam?', 'had', ['have', 'did']),
    mc('They ___ for long when the storm hit.', 'hadn’t been sailing', ['haven’t been sailing', 'hadn’t sailing']),
    mc('He ___ smoking for years before he quit.', 'had been', ['has been', 'was been']),
    mc('I was out of breath because I ___.', 'had been running', ['have been running', 'had be running']),
    mc('Her eyes were red — she ___.', 'had been crying', ['has been crying', 'had cry']),
    mc('They ___ the house for months before they sold it.', 'had been painting', ['have been painting', 'had painting']),
    mc('Why was she so angry? — Someone ___ her bike.', 'had been using', ['has been using', 'was been using']),
    mc('The team ___ hard for months before they won.', 'had been training', ['have been training', 'are training']),
    mc('I ___ long when the phone rang.', 'hadn’t been sleeping', ['haven’t been sleeping', 'hadn’t sleeping']),
    mc('___ it been snowing before you left?', 'Had', ['Has', 'Was']),
    mc('Ramesh ___ for the company for ten years when it closed.', 'had been working', ['has been working', 'was been working']),
    fill('I ___ (look) for my glasses for an hour before I found them.', ['had been looking']),
    fill('She ___ (not / feel) well for days before she saw a doctor.', ['hadn’t been feeling', 'had not been feeling']),
    fill('How long ___ (they / wait) when the bus came?', ['had they been waiting']),
    fill('The children ___ (play) outside, so they were dirty.', ['had been playing']),
    fill('He ___ (work) all night, so he fell asleep at his desk.', ['had been working']),
    fill('We ___ (drive) for six hours when the car broke down.', ['had been driving']),
  ],
};

export const PAST_TENSES: Tense[] = [PAST_SIMPLE, PAST_CONTINUOUS, PAST_PERFECT, PAST_PERFECT_CONTINUOUS];
