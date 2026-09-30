import { activity, choice, ids } from '../build';
import { countWords } from '../../grading';
import type { CatalogActivity, CatalogTag, CatalogTrack } from '../types';

/**
 * Ser 10 "Read Up-Speed Up. Improve reading skills in students." Each
 * passage is timed (words per minute), then hidden while the learner
 * answers comprehension questions — so the result is a real reading speed
 * AND how much was understood at that speed. All passages are original.
 */

type Kind = 'main' | 'detail' | 'inference' | 'vocabulary';
type Q = [Kind, string, string, string[]];

interface Passage {
  key: string;
  title: string;
  cefr: 'A2' | 'B1' | 'B2' | 'C1';
  text: string;
  questions: Q[];
}

const PASSAGES: Passage[] = [
  {
    key: 'library',
    title: 'A new library for the town',
    cefr: 'A2',
    text: `Last month our town opened a new library next to the park. The old library was small and dark, and it only had books. The new one is bright and modern, with big windows and comfortable chairs.

On the ground floor there is a children's area with games and picture books. Upstairs there are quiet rooms for students and twenty computers that everyone can use for free. There is also a small café, so people can have a coffee while they read the newspaper.

The library is open every day from nine in the morning until eight in the evening, except on Sundays, when it closes at two. It is free to join. You only need to show a document with your address.

Many people in the town are happy with the new building. Mrs Joshi, who is seventy-two, says she visits three times a week. "I come for the books," she says, "but I also meet my friends here."`,
    questions: [
      ['main', 'What is the text mainly about?', 'a new library and what it offers', ['a park in the town', 'the life of Mrs Joshi']],
      ['detail', 'Where are the quiet rooms for students?', 'upstairs', ['on the ground floor', 'next to the café']],
      ['detail', 'When does the library close on Sundays?', 'at two o’clock', ['at eight o’clock', 'it is closed all day']],
      ['detail', 'What do you need to join the library?', 'a document with your address', ['some money', 'a letter from a teacher']],
      ['inference', 'Why does Mrs Joshi visit the library?', 'for the books and to meet friends', ['to use the computers', 'because she works there']],
    ],
  },
  {
    key: 'first-job',
    title: "Rahul's first job",
    cefr: 'A2',
    text: `When Rahul finished college, he wanted to work with computers, but it was difficult to find a job. For three months he sent letters to many companies and waited. Nobody answered.

Then his uncle told him about a small shop in the city that repaired mobile phones. The owner, Mr Das, needed a young assistant. Rahul was not sure. He did not know much about phones, and the pay was low. But he decided to try.

On his first day he was very nervous. He watched Mr Das open a broken phone, change a small part and close it again in ten minutes. By the end of the week Rahul could do simple repairs himself.

Now, two years later, Rahul still works in the shop, but he is not an assistant any more. Mr Das has made him a manager, and Rahul teaches new assistants. "I didn't plan this job," he says, "but it was the right start for me."`,
    questions: [
      ['main', 'What is the best title for the text?', 'An unexpected but good start', ['Why college is important', 'How to repair a phone']],
      ['detail', 'How long did Rahul look for a job before the shop?', 'three months', ['two years', 'one week']],
      ['detail', 'Who told Rahul about the shop?', 'his uncle', ['Mr Das', 'a college teacher']],
      ['inference', 'How did Rahul feel about the job at first?', 'unsure', ['very excited', 'angry']],
      ['detail', 'What is Rahul’s job now?', 'manager', ['assistant', 'owner of the shop']],
    ],
  },
  {
    key: 'market',
    title: 'The weekend market',
    cefr: 'A2',
    text: `Every Saturday morning, the main square of our village changes. At six o'clock the first farmers arrive with their vans, and by eight the square is full of colourful stalls.

You can buy almost everything at the weekend market. There are fresh vegetables and fruit from the farms near the village, bread and cakes from the bakery, and cheese made by a family who have kept cows for four generations. There are also stalls with clothes, old books and handmade toys.

The market is popular because the food is fresh and usually cheaper than in the supermarket. But many people say that the best thing is the atmosphere. Neighbours stop to talk, children listen to a man who plays the guitar, and visitors from the city take photos.

At one o'clock the farmers pack their vans, the square is cleaned, and the village becomes quiet again until the next Saturday.`,
    questions: [
      ['main', 'What does the text describe?', 'a weekly market in a village square', ['a supermarket in the city', 'life on a farm']],
      ['detail', 'What time is the square full of stalls?', 'by eight o’clock', ['at six o’clock', 'at one o’clock']],
      ['detail', 'Who makes the cheese?', 'a family with cows', ['the bakery', 'farmers from the city']],
      ['detail', 'What do many people say is the best thing about the market?', 'the atmosphere', ['the low prices', 'the old books']],
      ['vocabulary', 'In the text, "atmosphere" means…', 'the feeling of a place', ['the air around the Earth', 'the weather']],
    ],
  },
  {
    key: 'sleep',
    title: 'Why we need sleep',
    cefr: 'B1',
    text: `Most adults need between seven and nine hours of sleep a night, yet surveys suggest that about a third of people regularly get less than that. Many see sleep as time wasted, something to cut when life gets busy. Scientists increasingly disagree.

While we sleep, the brain is surprisingly active. It sorts the information we collected during the day, keeping what seems important and throwing away the rest. In experiments, people who sleep after learning a new skill remember it much better the next day than people who stay awake.

Sleep also helps the body to repair itself. Muscles recover, and the immune system, which fights illness, becomes stronger. People who sleep badly for long periods catch colds more often and have a higher risk of serious health problems.

The good news is that small changes can help. Experts recommend going to bed at the same time every night, keeping the bedroom cool and dark, and switching off phones an hour before sleep, because the light from screens tells the brain that it is still daytime.`,
    questions: [
      ['main', 'What is the writer’s main point?', 'sleep is important for both the brain and the body', ['most people sleep too much', 'phones are dangerous']],
      ['detail', 'How many people regularly get too little sleep, according to surveys?', 'about a third', ['about half', 'nearly everyone']],
      ['detail', 'What did the experiments show?', 'sleeping after learning helps memory', ['people learn better at night', 'staying awake improves skills']],
      ['inference', 'Why should people switch off phones before sleep?', 'screen light makes the brain think it is day', ['phones are too noisy', 'people read bad news']],
      ['vocabulary', 'The "immune system" is the part of the body that…', 'fights illness', ['controls sleep', 'repairs muscles']],
    ],
  },
  {
    key: 'tea',
    title: 'A short history of tea',
    cefr: 'B1',
    text: `According to a Chinese legend, tea was discovered almost five thousand years ago, when leaves from a wild bush blew into a pot of boiling water. Whether or not the story is true, people in China were certainly drinking tea two thousand years ago, first as a medicine and later for pleasure.

From China, tea spread to Japan and Korea, where it became part of important ceremonies. It reached Europe much later, in the seventeenth century, carried by Dutch and Portuguese traders. At first it was very expensive, and only rich families could afford it.

In the nineteenth century, the British began growing tea in India to avoid buying it from China. Huge plantations were created in Assam and Darjeeling, and India soon became one of the largest tea producers in the world, a position it still holds today.

Today tea is the second most popular drink on the planet, after water. Billions of cups are drunk every day, from sweet milky chai in India to green tea in Japan.`,
    questions: [
      ['main', 'What is the text mainly about?', 'how tea spread around the world', ['how to make good tea', 'why tea is healthy']],
      ['detail', 'How was tea first used in China?', 'as a medicine', ['in ceremonies', 'as money']],
      ['detail', 'Who brought tea to Europe?', 'Dutch and Portuguese traders', ['Chinese farmers', 'British rulers']],
      ['inference', 'Why did the British grow tea in India?', 'to stop depending on China for tea', ['because tea grows only in India', 'because Europeans disliked Chinese tea']],
      ['detail', 'What is the most popular drink in the world?', 'water', ['tea', 'coffee']],
    ],
  },
  {
    key: 'adult-learners',
    title: 'Learning a language as an adult',
    cefr: 'B1',
    text: `It is often said that children learn languages more easily than adults. In some ways this is true: young children who grow up with a language usually develop a perfect accent, something that is rare for people who start later in life.

However, research shows that adults have advantages too. They already understand how language works, so they can learn grammar rules quickly. They can use dictionaries and courses, and they are often more motivated, because they have a clear reason to learn, such as a new job or a move to another country.

What adults often lack is time and confidence. Many are afraid of making mistakes and stay silent in conversations, which slows their progress. Teachers say that the most successful adult learners are not the most talented ones, but those who practise a little every day and are not embarrassed to get things wrong.

So is it ever too late to learn a language? Most experts say no. You may never sound exactly like a native speaker, but you can certainly learn to communicate well.`,
    questions: [
      ['main', 'What is the main idea of the text?', 'adults can learn languages well despite some disadvantages', ['only children can learn languages', 'accent is the most important thing']],
      ['detail', 'What do children usually learn better than adults?', 'accent', ['grammar rules', 'using dictionaries']],
      ['detail', 'Why are adults often more motivated?', 'they have a clear reason to learn', ['they have more time', 'they are less afraid']],
      ['inference', 'According to teachers, what makes an adult learner successful?', 'daily practice and not fearing mistakes', ['natural talent', 'living abroad']],
      ['vocabulary', '"Embarrassed" is closest in meaning to…', 'uncomfortable in front of others', ['very tired', 'extremely happy']],
    ],
  },
  {
    key: 'electric-cars',
    title: 'The rise of electric cars',
    cefr: 'B2',
    text: `Only fifteen years ago, electric cars were a curiosity: expensive, slow and able to travel barely a hundred kilometres before needing hours of charging. Today they are one of the fastest-growing parts of the car industry, and in some countries more than half of all new cars sold are electric.

Several factors explain this rapid change. Battery technology has improved dramatically, and the price of batteries has fallen by roughly ninety per cent over the past decade. At the same time, many governments have offered tax reductions to buyers and set dates after which new petrol and diesel cars can no longer be sold.

Supporters argue that electric cars are essential for reducing air pollution in cities and cutting the emissions that contribute to climate change. Critics point out that the benefits depend on how the electricity is produced: a car charged with power from coal is far less clean than one charged with solar or wind energy. The mining of materials for batteries also raises environmental and social concerns.

Perhaps the biggest obstacle, though, is practical. Many drivers still worry about finding a charging point on long journeys, and in areas with few charging stations, that worry is often justified.`,
    questions: [
      ['main', 'What is the purpose of the text?', 'to explain the growth of electric cars and some of the debates around them', ['to persuade readers to buy an electric car', 'to compare petrol and diesel cars']],
      ['detail', 'By how much has the price of batteries fallen in the past decade?', 'roughly ninety per cent', ['roughly half', 'roughly fifteen per cent']],
      ['detail', 'What have some governments done to encourage electric cars?', 'given tax reductions and set end dates for petrol cars', ['built free charging stations everywhere', 'banned all cars from cities']],
      ['inference', 'Why might an electric car charged with coal power be "less clean"?', 'producing the electricity itself causes pollution', ['coal damages the battery', 'the car uses more electricity']],
      ['vocabulary', 'The worry is "justified" means the worry is…', 'reasonable', ['exaggerated', 'unusual']],
    ],
  },
  {
    key: 'bees',
    title: 'How honeybees choose a new home',
    cefr: 'B2',
    text: `Every spring, when a honeybee colony becomes too large, the old queen leaves the hive with around half of the workers. The swarm, often ten thousand bees or more, gathers on a nearby branch and faces an urgent problem: it must find a new home within a few days, before its energy runs out.

The decision is not made by the queen. Instead, a few hundred experienced bees fly off as scouts to inspect possible sites, such as hollow trees. When a scout returns, she performs a "waggle dance" on the surface of the swarm, indicating the direction and distance of the site she found. The better the site, the longer and more enthusiastically she dances.

Other scouts then visit the advertised sites and, if impressed, dance for them too. Gradually, support builds for the best option, while poorer sites lose their supporters. When enough scouts are gathered at one site, the swarm takes off and flies there together.

Researchers who have studied this process are impressed by how reliably it works. In experiments, swarms chose the best of several artificial nest boxes in the great majority of cases, a result that has encouraged scientists to use bee "democracy" as a model for group decision-making in humans.`,
    questions: [
      ['main', 'What is the text mainly about?', 'the way a swarm of bees decides on a new home', ['how bees make honey', 'why queen bees leave the hive']],
      ['detail', 'Who makes the decision about the new home?', 'a few hundred scout bees', ['the old queen', 'all ten thousand bees equally']],
      ['detail', 'What does the length of a scout’s dance show?', 'how good the site is', ['how far she flew', 'how old she is']],
      ['inference', 'Why must the swarm decide within a few days?', 'it will run out of energy', ['the queen will die', 'other bees will take the site']],
      ['vocabulary', 'In the text, "advertised sites" are sites that…', 'other scouts have danced about', ['humans have built', 'are near the old hive']],
    ],
  },
  {
    key: 'four-day-week',
    title: 'Is a four-day working week the future?',
    cefr: 'B2',
    text: `In recent years a growing number of companies have experimented with a four-day working week, in which employees work fewer hours for the same pay. The results of the largest trials so far have surprised many observers.

In one study involving dozens of companies, most businesses reported that productivity stayed the same or even improved. Employees said they felt less stressed and slept better, and the number of sick days fell significantly. Perhaps most tellingly, the great majority of the companies decided to continue with the shorter week after the trial ended.

Supporters say that people waste a lot of time at work in unnecessary meetings and distractions, and that a shorter week forces everyone to focus on what really matters. Rested staff, they argue, make fewer mistakes and are less likely to leave for another job.

Sceptics, however, warn that what works in an office may not work everywhere. Hospitals, schools and shops cannot simply close for an extra day, and in these sectors a four-day week would require hiring more staff. They also note that trial participants were volunteers who were keen to make the scheme succeed, which may have influenced the results.`,
    questions: [
      ['main', 'Which sentence best summarises the text?', 'shorter working weeks show promising results, but may not suit every job', ['a four-day week is now the law in many countries', 'employees work harder when they are paid more']],
      ['detail', 'What happened to the number of sick days in the study?', 'it fell significantly', ['it rose slightly', 'it stayed the same']],
      ['detail', 'What did most companies do after the trial?', 'they kept the four-day week', ['they returned to five days', 'they reduced pay']],
      ['inference', 'Why might the volunteers have affected the results?', 'they wanted the scheme to work', ['they were paid more than others', 'they worked in hospitals']],
      ['vocabulary', '"Sceptics" are people who…', 'doubt that something is true or good', ['strongly support an idea', 'carry out research']],
    ],
  },
  {
    key: 'habits',
    title: 'The psychology of habits',
    cefr: 'C1',
    text: `Researchers estimate that a large proportion of our daily behaviour — some put it at around forty per cent — is not the result of conscious decisions but of habit. We brush our teeth, check our phones and take the same route to work largely on autopilot. Far from being a weakness, this is an efficient arrangement: by handing routine tasks to habit, the brain frees up attention for problems that genuinely require thought.

Psychologists commonly describe a habit as a loop of three elements: a cue that triggers the behaviour, the routine itself, and a reward that makes the brain more likely to repeat it next time. The smell of coffee in the morning (cue) leads to making a cup (routine), which is followed by a pleasant feeling of alertness (reward). Over many repetitions, the link between cue and routine becomes so strong that the behaviour starts almost automatically.

This model has practical implications for anyone trying to change their behaviour. Relying on willpower alone tends to fail, because willpower is limited and easily exhausted by stress. A more effective strategy is to redesign the environment: to remove the cues for unwanted habits and make desired behaviour as easy as possible. Someone who wants to exercise in the morning, for example, might lay out their sports clothes the night before.

Crucially, habits take time to form. One frequently cited study found that it took participants an average of about two months — and in some cases far longer — before a new behaviour became automatic, which suggests that popular claims about forming a habit in twenty-one days are optimistic at best.`,
    questions: [
      ['main', 'What is the writer’s central argument?', 'understanding how habits work helps us change them effectively', ['habits are a sign of a weak mind', 'willpower is the key to changing behaviour']],
      ['detail', 'According to the habit loop, what makes the brain likely to repeat a behaviour?', 'the reward', ['the cue', 'conscious decision']],
      ['inference', 'Why does the writer describe habits as "an efficient arrangement"?', 'they save mental effort for harder problems', ['they make people healthier', 'they are easy to break']],
      ['detail', 'What does the writer suggest instead of relying on willpower?', 'changing the environment', ['making stronger promises', 'exercising every morning']],
      ['inference', 'What is the writer’s view of the "twenty-one days" claim?', 'it is probably too optimistic', ['it is scientifically proven', 'it applies only to exercise']],
    ],
  },
  {
    key: 'urban-heat',
    title: 'Why cities are getting hotter',
    cefr: 'C1',
    text: `On a summer afternoon, the centre of a large city can be several degrees warmer than the countryside only a few kilometres away. This phenomenon, known as the urban heat island effect, is becoming a pressing concern as cities grow and heatwaves become more frequent.

Its causes are largely a matter of materials and design. Concrete, asphalt and brick absorb the sun's energy during the day and release it slowly after dark, so that cities often fail to cool down at night. Tall buildings trap warm air and block breezes, while air conditioners, vehicles and factories pump additional heat into the streets. Meanwhile, the trees, soil and open water that cool rural areas through shade and evaporation are in short supply.

The consequences go well beyond discomfort. Extreme urban heat increases the demand for electricity, worsens air quality and poses a serious risk to health, particularly for elderly people and those who work outdoors. Poorer neighbourhoods, which tend to have fewer parks and trees, are frequently the hardest hit.

Fortunately, the problem is not beyond remedy. Cities around the world are planting trees along streets, creating green roofs, and painting roofs and pavements in light colours that reflect rather than absorb sunlight. Such measures are relatively inexpensive, and studies suggest they can lower local temperatures noticeably, a reminder that the way we build our cities shapes the climate we live in.`,
    questions: [
      ['main', 'What is the text mainly about?', 'the causes, effects and possible solutions of urban heat', ['why the countryside is getting colder', 'the history of air conditioning']],
      ['detail', 'Why do cities often fail to cool down at night?', 'building materials release stored heat slowly', ['there is more traffic at night', 'the wind is stronger in the countryside']],
      ['detail', 'Which groups are said to be most at risk?', 'elderly people and outdoor workers', ['children and students', 'drivers and pilots']],
      ['inference', 'Why are poorer neighbourhoods "frequently the hardest hit"?', 'they have fewer trees and parks', ['they use more air conditioning', 'they are far from the city centre']],
      ['vocabulary', '"Not beyond remedy" means the problem…', 'can be solved', ['is getting worse', 'is too expensive to study']],
    ],
  },
  {
    key: 'boredom',
    title: 'In praise of boredom',
    cefr: 'C1',
    text: `Few experiences are as universally disliked as boredom. We fill every spare moment — in queues, on buses, even during television adverts — by reaching for our phones, as though an idle mind were a problem to be solved as quickly as possible. Yet a growing body of research suggests that boredom may serve a useful purpose, and that eliminating it entirely could come at a cost.

In one well-known experiment, participants who first completed a deliberately dull task, such as copying numbers from a telephone directory, subsequently produced more creative ideas than those who had not. The researchers proposed that boredom encourages the mind to wander, and that this undirected thinking allows unexpected connections to form. Many writers and scientists have described having their best ideas not while working intensely, but while walking, showering or staring out of a window.

Boredom may also act as a signal, much as hunger does. It tells us that our current activity is no longer satisfying, and prompts us to seek something more meaningful. If we constantly silence that signal with quick distractions, we may lose an important push towards change.

None of this means that boredom is always pleasant or beneficial; chronic boredom has been linked to low mood and unhealthy behaviour. But the occasional empty half-hour, spent without a screen, may be less of a waste of time than it seems.`,
    questions: [
      ['main', 'What is the writer’s overall position on boredom?', 'occasional boredom can be valuable', ['boredom should always be avoided', 'people are more bored than ever before']],
      ['detail', 'What did participants in the experiment do first?', 'a deliberately dull task', ['a creative writing task', 'a test on their phones']],
      ['inference', 'Why does the writer compare boredom to hunger?', 'both signal that we need something different', ['both are physically painful', 'both are caused by stress']],
      ['detail', 'What does the writer say about chronic boredom?', 'it has been linked to low mood', ['it improves creativity even more', 'it is extremely rare']],
      ['vocabulary', 'An "idle" mind is one that is…', 'not busy', ['very intelligent', 'confused']],
    ],
  },
];

const TAG: Record<Kind, string> = {
  main: 'reading.main-idea',
  detail: 'reading.detail',
  inference: 'reading.inference',
  vocabulary: 'reading.vocabulary',
};

export const READING_TAGS: Record<string, CatalogTag> = {
  'reading.main-idea': { label: 'Finding the main idea', activityKey: 'reading.tips' },
  'reading.detail': { label: 'Reading for detail', activityKey: 'reading.tips' },
  'reading.inference': { label: 'Reading between the lines (inference)', activityKey: 'reading.tips' },
  'reading.vocabulary': { label: 'Working out words from context', activityKey: 'reading.tips' },
};

const TARGET_WPM: Record<Passage['cefr'], number> = { A2: 120, B1: 160, B2: 200, C1: 240 };

function speedReading(p: Passage): CatalogActivity {
  const wordCount = countWords(p.text);
  return activity({
    key: `reading.speed.${p.key}`,
    title: p.title,
    kind: 'speed-reading',
    cefr: p.cefr,
    skill: 'reading',
    mode: 'test',
    intro: `${wordCount} words. Aim for about ${TARGET_WPM[p.cefr]} words a minute. The passage is hidden while you answer, so read carefully — but keep moving.`,
    passage: { title: p.title, text: p.text, wordCount },
    items: p.questions.map(([kind, prompt, answer, others]) => choice(prompt, answer, others, { tag: TAG[kind] })),
  });
}

const LEVELS: Array<{ cefr: Passage['cefr']; title: string; description: string }> = [
  { cefr: 'A2', title: 'Read Up-Speed Up: Level 1 (A2)', description: 'Short everyday texts, about 150 words.' },
  { cefr: 'B1', title: 'Read Up-Speed Up: Level 2 (B1)', description: 'Articles of about 200 words on health, history and learning.' },
  { cefr: 'B2', title: 'Read Up-Speed Up: Level 3 (B2)', description: 'Longer articles with argument and opinion, about 250 words.' },
  { cefr: 'C1', title: 'Read Up-Speed Up: Level 4 (C1)', description: 'Demanding texts of 300+ words — keep your speed up without losing the meaning.' },
];

export const READING_TRACK: CatalogTrack = {
  key: 'reading',
  title: 'Reading',
  description: 'Read Up-Speed Up: timed passages that measure your reading speed in words per minute and how much you understood.',
  units: [
    {
      key: 'reading-skills',
      title: 'How to read faster',
      description: 'The habits of fast, careful readers.',
      activities: [
        activity({
          key: 'reading.tips',
          title: 'Tutorial: reading faster without losing the meaning',
          kind: 'tutorial',
          cefr: 'B1',
          skill: 'reading',
          mode: 'practice',
          steps: [
            {
              title: 'Read in chunks, not word by word',
              body: [
                'Slow readers stop on every word. Fast readers take in **groups of words** — "on the ground floor", "every Saturday morning" — in one look.',
                'Try not to "say" every word in your head. Your eyes can move faster than your voice.',
              ],
              checkItemIds: ids(1),
            },
            {
              title: 'Know what you are looking for',
              body: [
                '**Main idea:** the first and last paragraphs usually tell you what the whole text is about.',
                '**Detail:** names, numbers and dates are easy to find again if you notice them the first time.',
                '**Inference:** the writer does not always say things directly — ask *why* people do what they do.',
              ],
              checkItemIds: ids(2, 3),
            },
            {
              title: 'Unknown words and the pacer',
              body: [
                'Do not stop at a word you do not know. Keep reading: the sentence around it usually shows the meaning.',
                'The **pacer** highlights the text at a steady speed. Follow it to push yourself a little faster each time — then check that your comprehension stays high.',
              ],
              checkItemIds: ids(4),
            },
          ],
          items: [
            choice('What do fast readers do?', 'read groups of words at a time', ['read every word aloud', 'read each sentence twice'], { tag: 'reading.detail' }),
            choice('Where do you usually find the main idea of a text?', 'in the first and last paragraphs', ['in the middle of the text', 'in the longest sentence'], { tag: 'reading.main-idea' }),
            choice('An inference question asks you to…', 'understand something the writer suggests but does not say directly', ['find a number in the text', 'count the paragraphs'], { tag: 'reading.inference' }),
            choice('What should you do when you meet an unknown word?', 'keep reading and use the context', ['stop and look it up at once', 'start the text again'], { tag: 'reading.vocabulary' }),
          ],
        }),
      ],
    },
    ...LEVELS.map((level) => ({
      key: `reading-${level.cefr.toLowerCase()}`,
      title: level.title,
      description: level.description,
      activities: PASSAGES.filter((p) => p.cefr === level.cefr).map(speedReading),
    })),
  ],
};
