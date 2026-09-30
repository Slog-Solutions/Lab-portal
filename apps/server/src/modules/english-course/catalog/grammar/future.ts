import { fill, mc, type Tense } from './helpers';

export const FUTURE_WILL: Tense = {
  key: 'future-will',
  title: 'Future with will',
  cefr: 'A2',
  group: 'future',
  hint: 'Will + base verb: predictions, promises, offers and decisions made at the moment of speaking.',
  steps: [
    {
      title: 'How to form it',
      body: [
        '**will + base verb** — the same for every subject: *I will go*, *she will go*, *they will go*. Short form: **’ll**.',
        '**Negative:** will not / **won’t** + base verb — *He won’t come.*',
        '**Question:** Will + subject + base verb — *Will you help me?*',
      ],
      examples: [
        ['I’ll call you tonight.', 'will + base verb'],
        ['She won’t be late.', 'will not + base verb'],
        ['Will you help me?', 'question / request'],
      ],
      checks: [mc('It ___ rain tomorrow.', 'will', ['is', 'does']), fill('I ___ (not / tell) anyone.', ['won’t tell', 'will not tell'])],
    },
    {
      title: 'When we use it',
      body: [
        '**Predictions** (what we think or believe): *I think it will rain tomorrow.*',
        '**Promises and offers:** *I’ll help you carry those bags.*',
        '**Decisions made at the moment of speaking:** *It’s cold — I’ll close the window.*',
        'For plans already decided, use **going to** (next lesson): *I’m going to study medicine.*',
      ],
      examples: [
        ['I think it will rain tomorrow.', 'prediction'],
        ['I’ll help you with those bags.', 'offer'],
        ['There’s someone at the door. I’ll get it.', 'decision now'],
      ],
      checks: [mc('Don’t worry. I ___ help you.', 'will', ['am', 'do'])],
    },
    {
      title: 'Time words and common mistakes',
      body: [
        'Words often used: **tomorrow, next week, soon, in 2030, I think, probably, perhaps, I’m sure.**',
        'After *if* and *when* (time clauses) we use the **present**, not will: *If it **rains**, I’ll stay home.* (not *If it will rain*)',
        'Common mistakes: *I will **to** go* (no *to*), *She **wills** come* (will never changes), *He will **goes*** (base verb).',
      ],
      checks: [mc('If I hear anything, I ___ you.', 'will call', ['call', 'am call']), fill('___ (you / help) me?', ['Will you help'])],
    },
  ],
  bank: [
    mc('I think it ___ tomorrow.', 'will rain', ['rains', 'is rain']),
    mc('It’s cold. I ___ the window.', 'will close', ['close', 'closed']),
    mc('Don’t worry. I ___ help you.', 'will', ['am', 'do']),
    mc('Do you think she ___ the exam?', 'will pass', ['passes', 'pass']),
    mc('Next year I ___ 25.', 'will be', ['being', 'was']),
    mc('They ___ come to the party. They’re busy.', 'won’t', ['don’t', 'aren’t']),
    mc('Who do you think ___ win the match?', 'will', ['is', 'does']),
    mc('I promise I ___ tell anyone.', 'won’t', ['don’t', 'am not']),
    mc('There’s someone at the door. I ___ it.', 'will get', ['get', 'got']),
    mc('___ you help me with this bag, please?', 'Will', ['Does', 'Are']),
    mc('Tomorrow ___ sunny.', 'will be', ['will is', 'will being']),
    mc('I’m sure you ___ this book.', 'will love', ['are love', 'did love']),
    mc('Perhaps we ___ a taxi.', 'will take', ['take', 'took']),
    mc('If I hear anything, I ___ you.', 'will call', ['call', 'am call']),
    fill('I ___ (call) you tonight.', ['will call', '’ll call', 'll call']),
    fill('It ___ (not / be) easy.', ['won’t be', 'will not be']),
    fill('___ (you / help) me?', ['Will you help']),
    fill('I think she ___ (win).', ['will win', '’ll win', 'll win']),
    fill('Don’t worry. I ___ (not / tell) anyone.', ['won’t tell', 'will not tell']),
    fill('Tomorrow ___ (be) a holiday.', ['will be']),
  ],
};

export const GOING_TO: Tense = {
  key: 'going-to',
  title: 'Future with going to',
  cefr: 'A2',
  group: 'future',
  hint: 'Be going to + base verb: plans and intentions already decided, and predictions based on evidence you can see now.',
  steps: [
    {
      title: 'How to form it',
      body: [
        '**am / is / are + going to + base verb:** *I am going to study*, *she is going to study*, *they are going to study*.',
        '**Negative:** am not / isn’t / aren’t going to — *He isn’t going to come.*',
        '**Question:** Am / Is / Are + subject + going to + base verb — *What are you going to do?*',
      ],
      examples: [
        ['I’m going to visit my grandmother.', 'am + going to'],
        ['She isn’t going to come.', 'is not + going to'],
        ['What are you going to do?', 'question'],
      ],
      checks: [mc('We ___ going to buy a car.', 'are', ['is', 'will']), fill('She ___ (not / come).', ['isn’t going to come', 'is not going to come'])],
    },
    {
      title: 'When we use it',
      body: [
        '**Plans and intentions** decided **before** speaking: *I’m going to learn the guitar* (I have decided).',
        '**Predictions with evidence** you can see or feel now: *Look at those clouds — it’s going to rain.*',
        'Compare **will**: a decision made *at the moment* of speaking — *The phone’s ringing. I’ll answer it.*',
      ],
      examples: [
        ['I’m going to learn the guitar.', 'plan'],
        ['Look at those clouds! It’s going to rain.', 'evidence'],
      ],
      checks: [mc('Watch out! You ___ fall!', 'are going to', ['will to', 'go to'])],
    },
    {
      title: 'Time words and common mistakes',
      body: [
        'Words: **tomorrow, next week, this weekend, soon, in a few days, when I grow up.**',
        'Common mistakes: *She **is go to** visit* (going), *They **going to** leave* (don’t forget are), *I’m going to **to** study* (no second to).',
      ],
      checks: [
        mc('When ___ you going to tell her?', 'are', ['will', 'do']),
        fill('Look out! The glass ___ (fall).', ['is going to fall']),
      ],
    },
  ],
  bank: [
    mc('Look at those clouds! It ___ rain.', 'is going to', ['goes to', 'will to']),
    mc('I ___ study medicine. I’ve decided.', 'am going to', ['will to', 'am']),
    mc('What ___ you going to do this weekend?', 'are', ['will', 'do']),
    mc('She ___ have a baby in May.', 'is going to', ['goes to', 'will to']),
    mc('We ___ buy a new car next month.', 'are going to', ['is going to', 'go to']),
    mc('He ___ pass if he doesn’t study.', 'isn’t going to', ['doesn’t going to', 'not going to']),
    mc('Watch out! You ___ fall!', 'are going to', ['will to', 'go to']),
    mc('Are they ___ to sell the house?', 'going', ['go', 'will']),
    mc('My brother ___ be a pilot when he grows up.', 'is going to', ['are going to', 'goes to']),
    mc('I ___ visit my aunt tomorrow. I already bought the tickets.', 'am going to', ['am go to', 'going to']),
    mc('The sky is red. It ___ be a hot day.', 'is going to', ['goes to', 'will to']),
    mc('We ___ have a party on Friday. Would you like to come?', 'are going to', ['is going to', 'will to']),
    mc('When ___ you going to tell her?', 'are', ['will', 'do']),
    mc('They ___ get married in June.', 'are going to', ['is going to', 'are go to']),
    fill('I ___ (visit) my grandmother tomorrow.', ['am going to visit']),
    fill('She ___ (not / come) to the party.', ['isn’t going to come', 'is not going to come']),
    fill('What ___ (you / do) next week?', ['are you going to do']),
    fill('Look out! The glass ___ (fall).', ['is going to fall']),
    fill('We ___ (start) a new project in May.', ['are going to start']),
    fill('___ (it / rain) today?', ['Is it going to rain']),
  ],
};

export const FUTURE_CONTINUOUS: Tense = {
  key: 'future-continuous',
  title: 'Future continuous',
  cefr: 'B1',
  group: 'future',
  hint: 'Will be + verb-ing: an action that will be in progress at a moment in the future.',
  steps: [
    {
      title: 'How to form it',
      body: [
        '**will be + verb-ing:** *I will be working*, *she will be working*. Short form: *I’ll be working.*',
        '**Negative:** won’t be + -ing — *We won’t be using the car.*',
        '**Question:** Will + subject + be + -ing — *Will you be using the car tonight?*',
      ],
      examples: [
        ['This time tomorrow I’ll be lying on a beach.', 'will be + -ing'],
        ['We won’t be using the car.', 'will not be + -ing'],
        ['Will you be using the car tonight?', 'question'],
      ],
      checks: [mc('At noon she ___ in a meeting.', 'will be sitting', ['will sitting', 'will been sitting']), fill('I ___ (wait) outside.', ['will be waiting', '’ll be waiting'])],
    },
    {
      title: 'When we use it',
      body: [
        'An action **in progress at a particular future time:** *At 8 tomorrow I’ll be having breakfast.*',
        'Things that will happen **as a matter of course** (not a special plan): *I’ll be seeing Raj tomorrow* (we work together).',
        'A **polite way to ask about someone’s plans:** *Will you be using the printer this afternoon?*',
      ],
      examples: [
        ['At eight tomorrow I’ll be having breakfast.', 'in progress at a future time'],
        ['Will you be using the printer this afternoon?', 'polite question'],
      ],
      checks: [mc('Don’t phone at seven; I ___ dinner.', 'will be cooking', ['will cooking', 'will be cook'])],
    },
    {
      title: 'Time words and common mistakes',
      body: [
        'Words: **this time tomorrow, at 10 o’clock tomorrow, next week, in July, when you arrive.**',
        'State verbs (know, like, want) do not take the continuous: *I’ll **know** the results on Friday.*',
        'Common mistakes: *will **being*** (be), *will be **work*** (-ing), *will **working*** (will be working).',
      ],
      checks: [mc('What ___ you be doing at nine tomorrow?', 'will', ['are', 'do']), fill('They ___ (not / work) on Sunday.', ['won’t be working', 'will not be working'])],
    },
  ],
  bank: [
    mc('This time tomorrow I ___ on a beach.', 'will be lying', ['will lying', 'lie']),
    mc('Don’t call at eight. We ___ dinner then.', 'will be having', ['will having', 'had']),
    mc('At noon she ___ in a meeting.', 'will be sitting', ['will sitting', 'will been sitting']),
    mc('___ you be using the car tonight?', 'Will', ['Do', 'Are']),
    mc('This time next week, we ___ in Paris.', 'will be travelling', ['will travelling', 'are travel']),
    mc('I’ll ___ waiting outside the station.', 'be', ['am', 'been']),
    mc('He ___ be sleeping when we arrive — it’s very late.', 'will', ['is', 'does']),
    mc('In ten years, many people ___ from home.', 'will be working', ['will working', 'will been working']),
    mc('What ___ you be doing at nine tomorrow?', 'will', ['are', 'do']),
    mc('She won’t ___ at the office tomorrow; she’s on leave.', 'be working', ['working', 'works']),
    mc('Next Saturday I ___ my exams, so I won’t be able to come.', 'will be taking', ['will taking', 'am took']),
    mc('The plane ___ over the Alps at this time.', 'will be flying', ['will flying', 'flown']),
    mc('Don’t phone me at seven; I ___ dinner.', 'will be cooking', ['will cooking', 'will be cook']),
    mc('This time tomorrow they ___ the match.', 'will be watching', ['will watching', 'are watch']),
    fill('This time next week I ___ (sit) on a beach.', ['will be sitting', '’ll be sitting']),
    fill('At 10 tomorrow, she ___ (teach).', ['will be teaching', '’ll be teaching']),
    fill('___ (you / use) the car this evening?', ['Will you be using']),
    fill('They ___ (not / work) on Sunday.', ['won’t be working', 'will not be working']),
    fill('In July, we ___ (travel) around Europe.', ['will be travelling', 'will be traveling']),
    fill('What ___ (you / do) at midnight?', ['will you be doing']),
  ],
};

export const FUTURE_PERFECT: Tense = {
  key: 'future-perfect',
  title: 'Future perfect',
  cefr: 'B2',
  group: 'future',
  hint: 'Will have + past participle: an action that will be completed before a moment in the future.',
  steps: [
    {
      title: 'How to form it',
      body: [
        '**will have + past participle:** *I will have finished*, *she will have finished*. Short form: *I’ll have finished.*',
        '**Negative:** won’t have + past participle — *He won’t have arrived.*',
        '**Question:** Will + subject + have + past participle — *Will you have finished by six?*',
      ],
      examples: [
        ['I’ll have finished by six.', 'will have + participle'],
        ['He won’t have arrived by then.', 'will not have + participle'],
        ['Will you have finished by six?', 'question'],
      ],
      checks: [mc('She will have ___ by Friday.', 'finished', ['finish', 'finishing']), fill('They ___ (arrive) by noon.', ['will have arrived', '’ll have arrived'])],
    },
    {
      title: 'When we use it',
      body: [
        'An action that will be **finished before a future time:** *By 2030, she will have finished her studies.*',
        'Often with **by** (by Friday, by the time, by then, by the end of the year): *By the time you arrive, we’ll have eaten.*',
        'Think of standing at a future moment and looking back: the action is already done.',
      ],
      examples: [
        ['By 2030 she will have finished her studies.', 'completed before a future time'],
        ['By the time you arrive, we’ll have eaten.', 'by the time'],
      ],
      checks: [mc('By next June, I ___ from university.', 'will have graduated', ['will have graduate', 'would graduated'])],
    },
    {
      title: 'Time words and common mistakes',
      body: [
        'Words: **by, by then, by the time, by the end of, before, in two years.**',
        'Do not confuse *by* (finished before) with *until* (continues up to): *I’ll be here **until** six* but *I’ll have left **by** six.*',
        'Common mistakes: *will have **finish*** (finished), *will **has** finished* (will have), *will **finished*** (will have finished).',
      ],
      checks: [mc('___ you have finished by six?', 'Will', ['Do', 'Have']), fill('By next year, I ___ (save) enough money.', ['will have saved', '’ll have saved'])],
    },
  ],
  bank: [
    mc('By 2030, scientists ___ a cure.', 'will have found', ['will have find', 'will found']),
    mc('She ___ the report by Friday.', 'will have finished', ['will has finished', 'would finish']),
    mc('By the time you arrive, we ___ dinner.', 'will have eaten', ['will have eat', 'have eaten']),
    mc('___ you have finished by six?', 'Will', ['Do', 'Have']),
    mc('He ___ his exams by then.', 'won’t have finished', ['won’t finished', 'hasn’t finished']),
    mc('In two years, I ___ here for ten years.', 'will have worked', ['will worked', 'have worked']),
    mc('By next month, they ___ married for 25 years.', 'will have been', ['will be been', 'will have be']),
    mc('We ___ all the money by the end of the trip.', 'will have spent', ['will have spend', 'are spending']),
    mc('By this time tomorrow, the exam ___.', 'will have finished', ['will have finish', 'has finished']),
    mc('I ___ the book by the time you come back.', 'won’t have read', ['didn’t read', 'don’t read']),
    mc('By the end of the year, how many countries ___ you have visited?', 'will', ['did', 'are']),
    mc('They ___ the building by next spring.', 'will have completed', ['will have completing', 'would have completing']),
    mc('By 2040, cars ___ completely electric.', 'will have become', ['will became', 'have become']),
    mc('By the time we get home, the match ___.', 'will have finished', ['will have finish', 'has finished']),
    fill('By 2030, she ___ (finish) her studies.', ['will have finished', '’ll have finished']),
    fill('I ___ (not / complete) the project by Friday.', ['won’t have completed', 'will not have completed']),
    fill('___ (they / arrive) by noon?', ['Will they have arrived']),
    fill('By the end of May, we ___ (live) here for ten years.', ['will have lived', '’ll have lived']),
    fill('He ___ (leave) before you get there.', ['will have left', '’ll have left']),
    fill('By next year, I ___ (save) enough money.', ['will have saved', '’ll have saved']),
  ],
};

export const FUTURE_PERFECT_CONTINUOUS: Tense = {
  key: 'future-perfect-continuous',
  title: 'Future perfect continuous',
  cefr: 'C1',
  group: 'future',
  hint: 'Will have been + verb-ing: how long an activity will have been going on by a moment in the future.',
  steps: [
    {
      title: 'How to form it',
      body: [
        '**will have been + verb-ing:** *I will have been working*, *they will have been waiting*. Short form: *I’ll have been working.*',
        '**Negative:** won’t have been + -ing — *She won’t have been sleeping.*',
        '**Question:** Will + subject + have been + -ing — *How long will you have been studying?*',
      ],
      examples: [
        ['By July I’ll have been teaching here for ten years.', 'will have been + -ing'],
        ['How long will you have been living here?', 'question'],
      ],
      checks: [mc('By noon they will have been ___ for six hours.', 'driving', ['drive', 'driven']), fill('By 6 pm he ___ (drive) all day.', ['will have been driving', '’ll have been driving'])],
    },
    {
      title: 'When we use it',
      body: [
        'To stress the **duration** of an activity **up to a future time:** *By midnight they will have been dancing for six hours.*',
        'Usually with **for** and **by**: *By next June, I’ll have been working here for a year.*',
        'Compare: *will have worked* (simply completed) and *will have been working* (how long the activity has lasted by then).',
      ],
      examples: [
        ['By midnight they’ll have been dancing for six hours.', 'duration up to a future time'],
        ['By June I’ll have been working here for a year.', 'for + by'],
      ],
      checks: [mc('By the end of the match they ___ for ninety minutes.', 'will have been playing', ['will be played', 'have been playing'])],
    },
    {
      title: 'Time words and common mistakes',
      body: [
        'Words: **for, by, by the time, by then, how long, at this rate.**',
        'This tense is uncommon; most speakers use the future perfect or *will be … ing* instead. State verbs (know, be) take the simple form: *By June I’ll have **known** her for ten years.*',
        'Common mistakes: *will have **be** working* (been), *will have been **work*** (-ing), *will **been** working* (will have been).',
      ],
      checks: [mc('How long ___ they have been married by then?', 'will', ['have', 'are']), fill('By midnight, they ___ (dance) for six hours.', ['will have been dancing', '’ll have been dancing'])],
    },
  ],
  bank: [
    mc('By June, she ___ here for five years.', 'will have been working', ['will be working', 'will have been work']),
    mc('By the time he retires, he ___ for the company for 40 years.', 'will have been working', ['will be working', 'has been working']),
    mc('Next month, we ___ together for a decade.', 'will have been living', ['will be living', 'will live']),
    mc('How long ___ you have been studying by the time you finish?', 'will', ['have', 'did']),
    mc('By noon, they ___ for six hours.', 'will have been driving', ['will be driving', 'will drive']),
    mc('In December, I ___ this course for exactly a year.', 'will have been taking', ['will take', 'am taking']),
    mc('By 2028, the company ___ electric cars for twenty years.', 'will have been making', ['will be made', 'will make']),
    mc('When you arrive, I ___ for two hours.', 'will have been waiting', ['will wait', 'have waited']),
    mc('By next week, it ___ for a month without a break.', 'will have been raining', ['will rain', 'rains']),
    mc('By the end of the match, they ___ for ninety minutes.', 'will have been playing', ['will play', 'have been played']),
    mc('Won’t he ___ waiting for long by then?', 'have been', ['be', 'been']),
    mc('By 5 pm I ___ for eight hours.', 'will have been studying', ['will study', 'am studying']),
    mc('Next year, he ___ as a pilot for thirty years.', 'will have been working', ['will be working', 'has been working']),
    mc('How long ___ they have been married by the time of the party?', 'will', ['have', 'are']),
    fill('By July, I ___ (teach) here for ten years.', ['will have been teaching', '’ll have been teaching']),
    fill('She ___ (not / work) here long by then.', ['won’t have been working', 'will not have been working']),
    fill('How long ___ (you / live) here by next June?', ['will you have been living']),
    fill('By midnight, they ___ (dance) for six hours.', ['will have been dancing', '’ll have been dancing']),
    fill('By 6 pm, he ___ (drive) all day.', ['will have been driving', '’ll have been driving']),
    fill('In May, we ___ (run) the shop for a year.', ['will have been running', '’ll have been running']),
  ],
};

export const FUTURE_TENSES: Tense[] = [FUTURE_WILL, GOING_TO, FUTURE_CONTINUOUS, FUTURE_PERFECT, FUTURE_PERFECT_CONTINUOUS];
