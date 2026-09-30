import { fill, mc } from './helpers';
import type { ItemDraft } from '../build';

/**
 * Contrast items that only make sense across tenses (present simple vs
 * continuous, past simple vs present perfect, will vs going to...). Each is
 * filed under the tense it really tests, so a mistake here points the
 * learner at the right lesson. They join the big test bank and the
 * follow-up quiz, but not any single tense's quiz.
 */
export const MIXED: Array<[tenseKey: string, item: ItemDraft]> = [
  ['present-simple', mc('Ravi ___ tea every morning, but today he is drinking coffee.', 'drinks', ['is drinking', 'drink'])],
  ['present-continuous', mc('Hurry up! The bus ___.', 'is coming', ['comes', 'come'])],
  ['present-simple', mc('My train ___ at 9.10. Don’t be late.', 'leaves', ['leave', 'leaving'])],
  ['present-continuous', mc('I can’t talk now. I ___ dinner.', 'am cooking', ['cook', 'cooks'])],
  ['present-perfect', mc('I ___ my homework, so I can go out now.', 'have finished', ['finish', 'was finished'])],
  ['past-simple', mc('We ___ Jaipur in 2019.', 'visited', ['have visited', 'visit'])],
  ['present-perfect', mc('She ___ in Chennai for six years now.', 'has lived', ['lived', 'lives'])],
  ['past-simple', mc('___ you finish the report yesterday?', 'Did', ['Have', 'Do'])],
  ['present-perfect-continuous', mc('I’m tired. I ___ all day.', 'have been working', ['worked', 'work'])],
  ['past-continuous', mc('He broke his arm while he ___ football.', 'was playing', ['is playing', 'plays'])],
  ['past-simple', mc('She ___ the door and went in.', 'opened', ['was opening', 'opens'])],
  ['past-perfect', mc('When we got there, the shop ___.', 'had closed', ['has closed', 'closes'])],
  ['past-perfect-continuous', mc('His clothes were wet because he ___ in the rain.', 'had been walking', ['has been walking', 'was been walking'])],
  ['going-to', mc('— Why are you buying paint? — I ___ paint the kitchen.', 'am going to', ['will', 'paint'])],
  ['future-will', mc('— The phone is ringing. — I ___ get it.', 'will', ['am', 'do'])],
  ['future-continuous', mc('Don’t ring at eight. I ___ the news.', 'will be watching', ['will watching', 'watched'])],
  ['future-perfect', mc('By the time you read this, I ___ the country.', 'will have left', ['will have leave', 'would left'])],
  ['future-perfect-continuous', mc('By next April, we ___ here for ten years.', 'will have been living', ['will live', 'have been living'])],
  ['going-to', mc('Careful! That plate ___ fall.', 'is going to', ['will to', 'goes to'])],
  ['future-will', mc('I’m sure she ___ the job.', 'will get', ['gets', 'got'])],
  ['present-simple', mc('The Earth ___ round the sun.', 'goes', ['is going', 'go'])],
  ['present-continuous', mc('Why ___ you laughing? What’s so funny?', 'are', ['do', 'have'])],
  ['past-simple', mc('When I was a child, we ___ in a small village.', 'lived', ['have lived', 'live'])],
  ['past-continuous', mc('At this time yesterday, I ___ in a traffic jam.', 'was sitting', ['sat', 'am sitting'])],
  ['present-perfect', fill('___ (you / finish) your homework yet?', ['Have you finished'])],
  ['past-simple', fill('He ___ (go) to Mumbai last year.', ['went'])],
  ['present-continuous', fill('Right now, they ___ (watch) a film.', ['are watching'])],
  ['past-perfect', fill('She ___ (already / eat) when I arrived.', ['had already eaten'])],
  ['future-will', fill('Perhaps it ___ (rain) later.', ['will rain'])],
  ['going-to', fill('She ___ (buy) a bike next week. She has saved the money.', ['is going to buy'])],
  ['present-simple', fill('He always ___ (drink) tea after lunch.', ['drinks'])],
  ['past-continuous', fill('What ___ (you / do) when the lights went out?', ['were you doing'])],
  ['present-perfect-continuous', fill('It ___ (snow) since morning.', ['has been snowing'])],
  ['future-perfect', fill('By Friday I ___ (finish) all my exams.', ['will have finished', '’ll have finished'])],
];
