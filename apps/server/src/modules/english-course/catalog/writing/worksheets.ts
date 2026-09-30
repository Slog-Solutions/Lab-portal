import type { CefrLevel } from '@lab/shared';

/**
 * CEFR content worksheets (Ser 10: "Content Worksheet should include
 * different exercise covering all four key skills, reading, writing,
 * speaking and listening, [and] follow CEFR"). Each worksheet is one
 * situation worked through in all four skills:
 *   reading   — a text and comprehension questions
 *   listening — a short recording (voiced by the course's offline voice)
 *   language  — grammar/vocabulary in context
 *   speaking  — a spoken answer, recorded
 *   writing   — a written task with a model answer
 * All texts are original.
 */

/** [question, answer, wrong answers] */
export type Q = [string, string, string[]];

export interface Worksheet {
  key: string;
  title: string;
  cefr: CefrLevel;
  topic: string;
  passage: { title: string; text: string };
  reading: Q[];
  listening: { script: string; question: Q };
  /** Multiple-choice or typed language items, as [kind, ...]. */
  language: Array<{ kind: 'mc'; sentence: string; answer: string; wrong: string[] } | { kind: 'fill'; text: string; answers: string[] }>;
  speaking: string;
  writing: {
    task: string;
    minWords: number;
    /** Words/phrases the task asks for; `mustUseMin` of them must appear. */
    mustUse: string[];
    mustUseMin: number;
    model: string;
    checklist: string[];
  };
}

export const WORKSHEETS: Worksheet[] = [
  {
    key: 'about-me',
    title: 'About me',
    cefr: 'A1',
    topic: 'Personal information',
    passage: {
      title: 'Sana’s profile',
      text: `My name is Sana. I am fifteen years old. I live in Pune with my mother, my father and my little brother. I go to school by bus. My favourite subject is English. On Saturdays I play cricket with my friends.`,
    },
    reading: [
      ['How old is Sana?', 'fifteen', ['fourteen', 'sixteen']],
      ['How does Sana go to school?', 'by bus', ['on foot', 'by car']],
      ['What does Sana do on Saturdays?', 'She plays cricket.', ['She goes to school.', 'She studies English.']],
    ],
    listening: {
      script: 'Hello. My name is Dev. I am from Delhi. I have one sister and two brothers.',
      question: ['How many brothers does Dev have?', 'two', ['one', 'three']],
    },
    language: [
      { kind: 'mc', sentence: 'My brother ___ twelve years old.', answer: 'is', wrong: ['am', 'are'] },
      { kind: 'mc', sentence: 'I ___ to school by bus.', answer: 'go', wrong: ['goes', 'going'] },
      { kind: 'fill', text: 'She ___ (live) in Pune.', answers: ['lives'] },
    ],
    speaking: 'Say four sentences about yourself: your name, your age, where you live and your favourite subject.',
    writing: {
      task: 'Write about yourself: your name, your age, your family and what you like.',
      minWords: 30,
      mustUse: ['name', 'live', 'like', 'family', 'school'],
      mustUseMin: 2,
      model:
        'My name is Sana and I am fifteen years old. I live in Pune with my family. I have a little brother and he is nine. I go to school by bus every day. My favourite subject is English because my teacher is very kind. I like cricket, and I play with my friends on Saturday.',
      checklist: ['I wrote my name and my age.', 'Names and the first word of each sentence start with a capital letter.', 'Every sentence ends with a full stop.', 'I checked my spelling.'],
    },
  },
  {
    key: 'invitation',
    title: 'An invitation',
    cefr: 'A2',
    topic: 'Invitations and plans',
    passage: {
      title: 'Email from Rohan',
      text: `Hi Meera,

I'm having a birthday party next Saturday at my house. It starts at four o'clock and finishes at about nine. My mother is making a big chocolate cake, and we are going to play games in the garden. If it rains, we will stay inside and watch a film.

Can you come? Please tell me by Wednesday. Bring a friend if you like!

Rohan`,
    },
    reading: [
      ['When is the party?', 'next Saturday', ['next Sunday', 'on Wednesday']],
      ['What is Rohan’s mother doing?', 'making a cake', ['playing games', 'watching a film']],
      ['What will they do if it rains?', 'watch a film inside', ['play in the garden', 'cancel the party']],
    ],
    listening: {
      script:
        'Hello Rohan, it is Meera. Thank you for the invitation. I would love to come, but I am visiting my grandmother on Saturday morning. I can arrive at half past five. Is that all right?',
      question: ['When can Meera arrive?', 'at half past five', ['at four o’clock', 'on Wednesday']],
    },
    language: [
      { kind: 'mc', sentence: 'The party ___ at four o’clock.', answer: 'starts', wrong: ['start', 'starting'] },
      { kind: 'mc', sentence: 'If it rains, we ___ inside.', answer: 'will stay', wrong: ['stay', 'stayed'] },
      { kind: 'fill', text: 'My mother ___ (make) a cake now.', answers: ['is making'] },
    ],
    speaking: 'Leave a voice message for Rohan. Say that you can come and say what time you will arrive.',
    writing: {
      task: 'Write a reply to Rohan. Thank him, say whether you can come, and say what you will bring.',
      minWords: 50,
      mustUse: ['thank you', 'thanks', 'can', 'come', 'bring', 'sorry'],
      mustUseMin: 3,
      model:
        'Hi Rohan, Thank you for inviting me to your party. I would love to come! I cannot arrive at four o’clock because I am visiting my grandmother in the morning, but I can be there at half past five. I will bring a box of sweets and a game for the garden. Please tell your mother that the cake sounds delicious. I am really looking forward to it. See you on Saturday! Meera',
      checklist: ['I began with Hi/Dear and ended with my name.', 'I answered all three questions in the task.', 'I used will for things I promise to do.', 'I checked capital letters, full stops and spelling.'],
    },
  },
  {
    key: 'last-weekend',
    title: 'Last weekend',
    cefr: 'A2',
    topic: 'Past events',
    passage: {
      title: 'A trip to Jaipur',
      text: `Last weekend my family visited my uncle in Jaipur. We left home early on Saturday and drove for five hours. In the afternoon we walked around the old city and bought some colourful bags. In the evening my aunt cooked a delicious dinner.

On Sunday we visited a big fort, took many photographs and came home late. I was very tired, but I had a wonderful time.`,
    },
    reading: [
      ['How did the family travel to Jaipur?', 'by car', ['by train', 'by plane']],
      ['What did they buy in the old city?', 'colourful bags', ['photographs', 'dinner']],
      ['How did the writer feel at the end of the trip?', 'tired but happy', ['angry', 'bored']],
    ],
    listening: {
      script: 'Good morning, this is the railway station. The train to Jaipur leaves at ten fifteen from platform four.',
      question: ['Which platform does the train leave from?', 'platform four', ['platform ten', 'platform fifteen']],
    },
    language: [
      { kind: 'mc', sentence: 'We ___ to Jaipur last weekend.', answer: 'went', wrong: ['go', 'have gone'] },
      { kind: 'mc', sentence: 'She ___ a lot of photographs.', answer: 'took', wrong: ['taked', 'take'] },
      { kind: 'fill', text: 'They ___ (not / stay) in a hotel.', answers: ['didn’t stay', 'did not stay'] },
    ],
    speaking: 'Tell a partner about your last weekend. Say where you went and what you did.',
    writing: {
      task: 'Write about your last weekend. Use the past simple, and link your ideas with words like first, then, after that.',
      minWords: 60,
      mustUse: ['first', 'then', 'after that', 'finally', 'in the evening', 'in the morning'],
      mustUseMin: 2,
      model:
        'Last weekend I visited my grandparents in a small town near Nashik. First, we took the bus on Saturday morning, and the journey lasted about three hours. Then my grandmother cooked lunch for all of us, and we ate in the garden. In the afternoon I played cards with my cousins. After that we walked to the river and watched the sunset. On Sunday I helped my grandfather in the garden, and finally we came home by train. I was tired, but I had a lovely weekend.',
      checklist: ['All my main verbs are in the past simple (went, ate, played...).', 'I used at least two linking words (first, then, after that).', 'I wrote about both days.', 'I checked my spelling and full stops.'],
    },
  },
  {
    key: 'online-shopping',
    title: 'Shopping online',
    cefr: 'B1',
    topic: 'Opinions',
    passage: {
      title: 'Online or in the shop?',
      text: `More and more people are buying things online. The main attraction is convenience: you can compare prices in minutes, order at midnight and have the parcel delivered to your door. Prices are often lower as well, because online shops do not have to pay for expensive buildings.

However, online shopping has its disadvantages. You cannot touch or try on what you are buying, so clothes sometimes arrive in the wrong size. Returning them can be slow and annoying. Some people also miss the pleasure of spending an afternoon in a busy market, talking to shopkeepers and discovering things they were not looking for.

In my opinion, the best approach is to use both: buy simple things such as books online, and visit real shops for anything where quality or fit matters.`,
    },
    reading: [
      ['What is the writer’s main point?', 'both ways of shopping have advantages', ['shops will soon disappear', 'online shopping is always cheaper']],
      ['Why are online prices often lower?', 'online shops save the cost of buildings', ['they sell worse products', 'delivery is free']],
      ['What problem with clothes does the writer mention?', 'they may not fit', ['they are too expensive', 'they are not fashionable']],
      ['The writer suggests buying books…', 'online', ['only in markets', 'only second-hand']],
    ],
    listening: {
      script:
        'Hello, you have reached Green Valley Books. Our shop is open from nine to six, Monday to Saturday. If you want to order a book, please press one. To speak to someone about a delivery, press two.',
      question: ['What should you press to ask about a delivery?', 'two', ['one', 'nine']],
    },
    language: [
      { kind: 'mc', sentence: 'I bought this phone online ___ it was cheaper.', answer: 'because', wrong: ['so', 'although'] },
      { kind: 'mc', sentence: 'The parcel ___ delivered yesterday.', answer: 'was', wrong: ['is', 'were'] },
      { kind: 'fill', text: 'If I ___ (have) more money, I would buy a new laptop.', answers: ['had'] },
    ],
    speaking: 'Do you prefer shopping online or in shops? Speak for about a minute and give two reasons.',
    writing: {
      task: 'Do you prefer shopping online or in shops? Write an opinion paragraph. Give reasons and at least one example.',
      minWords: 80,
      mustUse: ['because', 'however', 'for example', 'in my opinion', 'also', 'although'],
      mustUseMin: 3,
      model:
        'In my opinion, shopping in real shops is better than shopping online, although I use both. The main reason is that I can see and touch things before I buy them. For example, last year I ordered a pair of shoes on the internet, and they were too small, so I had to send them back and wait two weeks for a refund. However, online shopping is very useful for things I already know, because it is quick and usually cheaper. I also like to read other customers’ opinions. Overall, I buy books and electronics online, but I prefer to choose clothes and food myself.',
      checklist: ['I gave my opinion clearly in the first sentence.', 'I gave at least two reasons and one example.', 'I used linking words (because, however, for example).', 'I finished with a short conclusion.', 'I checked verb tenses and spelling.'],
    },
  },
  {
    key: 'leave-request',
    title: 'Asking for leave',
    cefr: 'B1',
    topic: 'Formal communication',
    passage: {
      title: 'A formal email',
      text: `Dear Mr Sharma,

I am writing to ask for permission to take leave on Friday 14 March. My sister is getting married that weekend in Nagpur, and I need to travel on Thursday night.

I have finished the monthly report, and my colleague Kiran has agreed to answer my calls while I am away. I would be grateful if you could let me know whether this is possible.

Thank you for your time.

Yours sincerely,
Anita Rao`,
    },
    reading: [
      ['Why does Anita want leave?', 'her sister is getting married', ['she is ill', 'she is moving house']],
      ['What has Anita already done?', 'finished the monthly report', ['booked her tickets', 'phoned Mr Sharma']],
      ['Who will answer Anita’s calls?', 'Kiran', ['Mr Sharma', 'her sister']],
    ],
    listening: {
      script:
        'Good afternoon. This is a message for Anita Rao. Mr Sharma says you can take Friday off, but please send the report to the finance team before you leave.',
      question: ['What must Anita do before she leaves?', 'send the report to the finance team', ['call Kiran', 'buy her tickets']],
    },
    language: [
      { kind: 'mc', sentence: 'I am writing ___ ask for leave.', answer: 'to', wrong: ['for', 'in'] },
      { kind: 'mc', sentence: 'I would be grateful if you ___ let me know.', answer: 'could', wrong: ['can to', 'are'] },
      { kind: 'fill', text: 'Kiran ___ (agree) to answer my calls.', answers: ['has agreed', '’s agreed'] },
    ],
    speaking: 'Phone your manager. Politely ask for a day off next week and give the reason.',
    writing: {
      task: 'Write a formal email to your teacher or manager asking for a day off. Give the date and the reason, say what you have arranged, and thank them.',
      minWords: 80,
      mustUse: ['dear', 'would', 'could', 'because', 'thank you', 'regards', 'sincerely'],
      mustUseMin: 4,
      model:
        'Dear Mr Kapoor, I am writing to ask whether I could take leave on Monday 2 June. I need to accompany my grandmother to the hospital in Mumbai for a medical check-up, and I am the only member of the family who can travel with her. I have already finished the assignment that is due on Monday and I will send it to you on Friday. My classmate Priya has also agreed to share her notes with me. I would be very grateful if you could let me know whether this is possible. Thank you for your understanding. Kind regards, Amit Joshi',
      checklist: ['I used a formal greeting (Dear …) and a formal ending (Yours sincerely / Kind regards).', 'I stated the purpose in the first sentence.', 'I used polite forms (would, could, I would be grateful).', 'I gave the date, the reason and what I arranged.', 'No contractions or slang.'],
    },
  },
  {
    key: 'city-or-country',
    title: 'City or countryside?',
    cefr: 'B2',
    topic: 'Discursive essay',
    passage: {
      title: 'Where should we live?',
      text: `Choosing where to live is one of the biggest decisions in life, and opinions are divided. Supporters of city life point to the range of jobs, the cultural events and the excellent public transport. However, cities are also expensive and crowded, and many residents complain about noise and pollution.

In contrast, life in the countryside is usually quieter and healthier. Housing costs less, and people often know their neighbours. On the other hand, jobs can be scarce, and a lack of public transport means that a car is almost essential.

Personally, I believe the best choice depends on the stage of life: young people may prefer the energy of the city, whereas families with children often value space and fresh air.`,
    },
    reading: [
      ['What is the writer’s overall view?', 'the best place depends on a person’s situation', ['city life is always better', 'the countryside is better for everyone']],
      ['Which problem of countryside life does the writer mention?', 'few jobs and poor public transport', ['pollution', 'high housing costs']],
      ['Which group might prefer the city, according to the writer?', 'young people', ['families with children', 'retired people']],
      ['In the text, "scarce" means…', 'hard to find', ['very expensive', 'easy to get']],
    ],
    listening: {
      script:
        'In today’s programme we look at a new survey. It found that forty per cent of city residents would move to the countryside if they could work from home. The most common reason was lower housing costs, followed by cleaner air.',
      question: ['What was the most common reason for wanting to move?', 'lower housing costs', ['cleaner air', 'quieter streets']],
    },
    language: [
      { kind: 'mc', sentence: 'If I ___ more time, I would learn another language.', answer: 'had', wrong: ['have', 'would have'] },
      { kind: 'mc', sentence: 'The city centre is noisy; ___, it has excellent public transport.', answer: 'however', wrong: ['because', 'therefore'] },
      { kind: 'fill', text: 'By the time we arrived, the match ___ (already / start).', answers: ['had already started'] },
    ],
    speaking: 'Would you rather live in a city or in the countryside? Give your opinion, with two reasons and an example.',
    writing: {
      task: 'Write an essay: “Would you rather live in a city or in the countryside?” Give reasons and examples, and consider the other point of view.',
      minWords: 120,
      mustUse: ['however', 'for example', 'on the other hand', 'whereas', 'in my opinion', 'although'],
      mustUseMin: 3,
      model:
        'Many people dream of leaving the city, but in my opinion, city life still offers the best opportunities for young adults. Firstly, cities provide a wide range of jobs. For example, a graduate in Pune can choose between dozens of software companies, whereas in a small village the choice may be limited to farming or a local shop. Secondly, cities have better hospitals, universities and public transport, which saves both time and money. On the other hand, it is true that life in the countryside is calmer and healthier. The air is cleaner, housing is cheaper and neighbours support one another. However, these advantages matter most when people are older and have families. Although I enjoy visiting villages, I would choose to live in a city while I am building my career. In conclusion, the best place depends on age and priorities.',
      checklist: ['My essay has an introduction, two or three body paragraphs and a conclusion.', 'I presented both sides and gave my own opinion.', 'I used a range of linking words (however, whereas, on the other hand...).', 'I supported each point with an example.', 'I used a mix of tenses and conditionals correctly.', 'I checked spelling and punctuation.'],
    },
  },
  {
    key: 'film-review',
    title: 'Reviewing a film',
    cefr: 'B2',
    topic: 'Reviews',
    passage: {
      title: '“The Silent Harbour”',
      text: `"The Silent Harbour" is a slow but rewarding drama about a fishing village that faces the loss of its only industry. The acting is superb, particularly that of the lead actress, who shows how a single person can hold a community together.

The photography is equally impressive: the grey sea and misty mornings create an atmosphere that stays with you long after the film ends. Admittedly, the plot moves slowly, and viewers who expect action may lose patience.

Nevertheless, I would recommend it to anyone who enjoys thoughtful films, although it is best watched with no distractions.`,
    },
    reading: [
      ['What is the writer’s opinion of the film?', 'positive, with a small criticism', ['completely negative', 'neutral']],
      ['What is said about the plot?', 'it moves slowly', ['it is full of action', 'it is confusing']],
      ['"Superb" is closest in meaning to…', 'excellent', ['ordinary', 'strange']],
      ['Who would enjoy the film most?', 'people who like thoughtful films', ['action fans', 'young children']],
    ],
    listening: {
      script:
        'Welcome to the cinema information line. Tonight The Silent Harbour begins at seven forty-five in Screen Three. Tickets cost two hundred rupees, and students get a twenty per cent discount.',
      question: ['How much is the student discount?', 'twenty per cent', ['two hundred rupees', 'ten per cent']],
    },
    language: [
      { kind: 'mc', sentence: 'The film, ___ I watched last night, was excellent.', answer: 'which', wrong: ['who', 'what'] },
      { kind: 'mc', sentence: '___ it was long, I enjoyed every minute.', answer: 'Although', wrong: ['Because', 'So'] },
      { kind: 'fill', text: 'I ___ (watch) it twice already.', answers: ['have watched', '’ve watched'] },
    ],
    speaking: 'Tell a friend about a film or book you enjoyed. Say what it is about and why you would recommend it.',
    writing: {
      task: 'Write a review of a film or book you know well. Say what it is about, what you liked and did not like, and who you would recommend it to.',
      minWords: 120,
      mustUse: ['recommend', 'although', 'however', 'because', 'plot', 'nevertheless'],
      mustUseMin: 3,
      model:
        '“Swades” is a film about a scientist who returns from America to a small Indian village and slowly decides to stay and help the people there. I recommend it to anyone who likes stories with a message. The plot is simple, but it is told with great sincerity. What I liked most was the lead actor, because he makes the main character’s doubts feel completely real. The music is also beautiful and fits each scene. However, the film is very long, and some scenes in the middle move too slowly. Although I sometimes lost interest, the ending made up for it. It left me thinking about my own responsibility towards the place I come from. Nevertheless, it is not a film for viewers who want fast action or comedy. Overall, it is a thoughtful, moving film that I would happily watch again.',
      checklist: ['I said what the film or book is about without telling the whole story.', 'I gave opinions with reasons (because…).', 'I mentioned at least one weakness, fairly.', 'I used linking words of contrast (however, although, nevertheless).', 'I ended by saying who would enjoy it.'],
    },
  },
  {
    key: 'attention-span',
    title: 'Attention in the digital age',
    cefr: 'C1',
    topic: 'Argumentative essay',
    passage: {
      title: 'Is social media shrinking our attention?',
      text: `It is often claimed that social media is shrinking our attention spans. The evidence, however, is more nuanced than such headlines suggest. Whereas some studies link heavy use to difficulty concentrating, others find that the relationship disappears once factors such as sleep and stress are taken into account.

What seems beyond doubt is that platforms are deliberately designed to capture attention: endless scrolling and unpredictable notifications exploit well-documented psychological tendencies. Consequently, the question is perhaps less whether individuals lack willpower than whether the environment has been engineered against them.

Nevertheless, it would be unwise to absolve users of all responsibility; habits, once formed, can be changed, though rarely without effort.`,
    },
    reading: [
      ['What is the writer’s main point?', 'the effects are more complex than headlines suggest', ['social media definitely reduces attention', 'willpower is all that matters']],
      ['What do some studies find once sleep and stress are considered?', 'the link disappears', ['the link becomes stronger', 'heavy use improves concentration']],
      ['"Engineered against them" suggests that…', 'platforms are designed to hold users’ attention', ['users design the platforms', 'governments control social media']],
      ['In the text, "nuanced" means…', 'having subtle differences', ['extremely simple', 'widely accepted']],
    ],
    listening: {
      script:
        'Research on multitasking is surprisingly consistent. Although people believe they perform several tasks at once, what they actually do is switch rapidly between them, and each switch carries a small cost in time and accuracy. Over a day, those costs accumulate considerably.',
      question: ['According to the speaker, what do people actually do when they multitask?', 'switch quickly between tasks', ['do all tasks at once', 'avoid difficult tasks']],
    },
    language: [
      { kind: 'mc', sentence: 'Not only ___ the report late, but it was also full of errors.', answer: 'was', wrong: ['is', 'did'] },
      { kind: 'mc', sentence: 'Had I known about the delay, I ___ earlier.', answer: 'would have left', wrong: ['will leave', 'would leave'] },
      { kind: 'mc', sentence: 'The policy, ___ was introduced in 2015, has been widely criticised.', answer: 'which', wrong: ['who', 'what'] },
    ],
    speaking: 'Give a one-minute talk: is the digital world making it harder to concentrate? Present both sides, then give your view.',
    writing: {
      task: 'Write an essay: “Is the digital world making it harder to concentrate?” Present both sides of the argument and give your own view.',
      minWords: 180,
      mustUse: ['nevertheless', 'whereas', 'consequently', 'furthermore', 'it could be argued', 'on balance'],
      mustUseMin: 3,
      model:
        'It is widely assumed that constant connectivity has damaged our ability to concentrate. There is some truth in this. Notifications interrupt work every few minutes, and studies show that it can take a long time to regain full focus after each interruption. Consequently, many students report that they find it difficult to read a long text without checking their phones. Furthermore, applications are designed to be hard to put down, which makes self-control even more demanding. Nevertheless, it could be argued that technology itself is not the real problem. Whereas earlier generations lost hours to television, today’s learners can also access lectures, libraries and expert advice within seconds. Used deliberately, the same devices that distract us can help us to concentrate, for instance through timers, blocking tools and audio books. Moreover, research on attention is far from conclusive, and some of the alarming headlines ignore factors such as stress and lack of sleep. On balance, I believe that the digital world makes concentration harder only for those who do not manage it. The solution is not to abandon technology but to develop habits, such as switching off notifications during study, which protect our attention and allow us to benefit from everything that the internet offers.',
      checklist: ['Clear introduction, balanced body paragraphs and a conclusion that states my view.', 'I considered the opposing argument fairly before disagreeing.', 'I used advanced linking devices accurately (nevertheless, whereas, consequently...).', 'My vocabulary is precise and varied — no repeated words or phrases.', 'Sentences vary in length and structure (subordination, inversion, participle clauses).', 'I proofread for grammar, punctuation and register.'],
    },
  },
];
