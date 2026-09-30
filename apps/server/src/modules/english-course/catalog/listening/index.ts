import type { CourseActivityView, CourseSpeech, CourseVoice } from '@lab/shared';
import { activity, choice, type ItemDraft } from '../build';
import type { CatalogActivity, CatalogTag, CatalogTrack } from '../types';

/**
 * Ser 10 listening tasks, all originally written:
 *  - "Active Listening ... listen for something specific e.g. what food
 *    items are mentioned by a shopper"
 *  - "A listen and Respond Task ... take the part of one of the speakers
 *    and respond by choosing the most suitable option. Areas covered
 *    include meeting people, eating out, and booking tickets"
 *  - "Listening and Note-taking tasks ... fill out forms, take message
 *    and complete timetables"
 *  - "A General Listening Task ... an interview or a talk ... first answer
 *    gist questions and then specific questions"
 * The recording is voiced line by line (Piper, two voices); its
 * transcript is only shown with the results.
 */

const VOICES: CourseVoice[] = ['en_GB', 'en_US'];

/** [speaker, line] pairs → voiced lines, one voice per speaker. */
function script(lines: Array<[string, string]>): CourseSpeech[] {
  const speakers: string[] = [];
  return lines.map(([speaker, text]) => {
    if (!speakers.includes(speaker)) speakers.push(speaker);
    return { text, speaker, voice: VOICES[speakers.indexOf(speaker) % VOICES.length] };
  });
}

function multi(prompt: string, choices: string[], answers: string[], tag: string): ItemDraft {
  return { kind: 'multi', prompt, choices, answers, tag };
}

function field(label: string, answers: string[]): ItemDraft {
  return { kind: 'field', label, answers, tag: 'listening.notes' };
}

type Level = CatalogActivity['cefr'];

// ---- Unit 1: Active Listening ------------------------------------------------------

function active(key: string, title: string, cefr: Level, lines: Array<[string, string]>, items: ItemDraft[]): CatalogActivity {
  return activity({
    key: `listen.active.${key}`,
    title,
    kind: 'listening',
    cefr,
    skill: 'listening',
    mode: 'test',
    intro: 'Read the questions first so you know what to listen for. Then play the recording — as many times as you need.',
    script: script(lines),
    items,
  });
}

const S = 'listening.specific';

const ACTIVE: CatalogActivity[] = [
  active(
    'market',
    'At the market: what does the shopper buy?',
    'A2',
    [
      ['Seller', 'Good morning! What can I get you?'],
      ['Shopper', "Hello. I'd like a kilo of tomatoes and half a kilo of onions, please."],
      ['Seller', 'Anything else?'],
      ['Shopper', 'Yes, six bananas. And do you have any eggs?'],
      ['Seller', 'Yes. A dozen?'],
      ['Shopper', 'Just six, please. How much is that?'],
      ['Seller', "That's two hundred and forty rupees."],
    ],
    [
      multi('Which food items does the shopper buy? Choose all that you hear.', ['tomatoes', 'onions', 'potatoes', 'bananas', 'rice', 'eggs', 'milk', 'carrots'], ['tomatoes', 'onions', 'bananas', 'eggs'], S),
      choice('How many eggs does the shopper buy?', 'six', ['twelve', 'ten'], { tag: S }),
      choice('How much does the shopper pay?', '240 rupees', ['214 rupees', '420 rupees'], { tag: S }),
    ],
  ),
  active(
    'station',
    'Station announcements',
    'A2',
    [
      [
        'Announcer',
        'Attention, please. The nine fifteen train to Mumbai will now depart from platform three. The nine forty service to Pune is delayed by twenty minutes. Passengers for Nashik, please change at Igatpuri.',
      ],
    ],
    [
      choice('Which platform does the Mumbai train leave from?', 'platform 3', ['platform 4', 'platform 13'], { tag: S }),
      choice('How late is the Pune train?', '20 minutes', ['40 minutes', '15 minutes'], { tag: S }),
      choice('Where should passengers for Nashik change trains?', 'Igatpuri', ['Pune', 'Mumbai'], { tag: S }),
    ],
  ),
  active(
    'weather',
    'The weather forecast',
    'A2',
    [
      [
        'Presenter',
        'And now the weather for tomorrow. The morning will be cloudy in the north, with some light rain. In the south it will be sunny and hot, with temperatures up to thirty-six degrees. In the evening, expect strong winds along the coast.',
      ],
    ],
    [
      multi('Which kinds of weather are mentioned? Choose all that you hear.', ['rain', 'snow', 'sunshine', 'strong winds', 'fog', 'thunder'], ['rain', 'sunshine', 'strong winds'], S),
      choice('What is the highest temperature?', '36 degrees', ['26 degrees', '30 degrees'], { tag: S }),
      choice('Where will it be windy?', 'along the coast', ['in the north', 'in the mountains'], { tag: S }),
    ],
  ),
  active(
    'school',
    'A message from the school',
    'A2',
    [
      [
        'Mrs Rao',
        'Hello, this is Mrs Rao from Green Valley School. Sports day has moved from Friday to next Monday. Please send your child with a water bottle, a cap and some sun cream. The event starts at eight thirty.',
      ],
    ],
    [
      multi('What should the children bring? Choose all that you hear.', ['a water bottle', 'a cap', 'sun cream', 'a lunch box', 'an umbrella', 'trainers'], ['a water bottle', 'a cap', 'sun cream'], S),
      choice('Which day is sports day now?', 'Monday', ['Friday', 'Tuesday'], { tag: S }),
      choice('What time does it start?', '8.30', ['8.00', '9.30'], { tag: S }),
    ],
  ),
  active(
    'pizza',
    'Ordering a pizza by phone',
    'A2',
    [
      ['Worker', "Hello, Pizza Corner. What would you like?"],
      ['Customer', "I'd like a large pizza with mushrooms, peppers and chicken, please."],
      ['Worker', 'Any drinks?'],
      ['Customer', 'Two bottles of water.'],
      ['Worker', "Fine. And what's the address?"],
      ['Customer', 'Twelve Park Road.'],
      ['Worker', "Thank you. It'll be with you in thirty-five minutes."],
    ],
    [
      multi('Which toppings does the customer order?', ['cheese', 'mushrooms', 'onions', 'chicken', 'peppers', 'olives'], ['mushrooms', 'chicken', 'peppers'], S),
      choice('What size is the pizza?', 'large', ['medium', 'small'], { tag: S }),
      choice('When will it arrive?', 'in 35 minutes', ['in 25 minutes', 'in 45 minutes'], { tag: S }),
      choice('What is the address?', '12 Park Road', ['20 Park Road', '12 Park Street'], { tag: S }),
    ],
  ),
  active(
    'fire-drill',
    'An announcement at work',
    'B1',
    [
      [
        'Manager',
        "Good morning, everyone. A quick reminder: the fire drill is at eleven o'clock today. When you hear the alarm, leave by the nearest stairs, not the lift, and meet in the car park. The drill should take about fifteen minutes.",
      ],
    ],
    [
      choice('What time is the fire drill?', "11 o'clock", ["10 o'clock", "7 o'clock"], { tag: S }),
      choice('What must staff NOT use?', 'the lift', ['the stairs', 'the main door'], { tag: S }),
      choice('Where should everyone meet?', 'in the car park', ['at reception', 'on the roof'], { tag: S }),
      choice('How long will the drill take?', 'about 15 minutes', ['about 50 minutes', 'about 5 minutes'], { tag: S }),
    ],
  ),
  active(
    'lost-bag',
    'A lost suitcase at the airport',
    'B1',
    [
      ['Officer', 'Can you describe your suitcase, please?'],
      ['Passenger', "It's a medium-sized black suitcase with a red ribbon on the handle."],
      ['Officer', "And what's inside?"],
      ['Passenger', 'Mostly clothes, two books and a camera. My name is on a tag on the side.'],
    ],
    [
      multi('What is inside the suitcase? Choose all that you hear.', ['clothes', 'books', 'a camera', 'a laptop', 'shoes', 'medicine'], ['clothes', 'books', 'a camera'], S),
      choice('What colour is the suitcase?', 'black', ['blue', 'red'], { tag: S }),
      choice('Where is the ribbon?', 'on the handle', ['on the side', 'on the wheels'], { tag: S }),
    ],
  ),
  active(
    'hotel',
    'Hotel facilities',
    'B1',
    [
      [
        'Receptionist',
        'Welcome to the hotel. Breakfast is served from seven to ten in the garden restaurant. The swimming pool is open until nine in the evening, and the gym is on the second floor. Wi-Fi is free: the password is on your key card. Checkout is at eleven.',
      ],
    ],
    [
      multi('Which facilities are mentioned? Choose all that you hear.', ['a swimming pool', 'a gym', 'a spa', 'a garden restaurant', 'free Wi-Fi', 'car hire'], ['a swimming pool', 'a gym', 'a garden restaurant', 'free Wi-Fi'], S),
      choice('Which floor is the gym on?', 'the second floor', ['the first floor', 'the ground floor'], { tag: S }),
      choice('What time is checkout?', '11 am', ['10 am', '12 noon'], { tag: S }),
    ],
  ),
];

// ---- Unit 2: Listen and Respond ----------------------------------------------------

type Turn = [string, string] | { you: [string, string[]] };

function respond(key: string, title: string, area: 'meeting' | 'eating' | 'booking', cefr: Level, other: string, turns: Turn[]): CatalogActivity {
  const items: ItemDraft[] = [];
  const dialogue: NonNullable<CourseActivityView['dialogue']> = [];
  for (const turn of turns) {
    if (Array.isArray(turn)) {
      dialogue.push({ speech: { text: turn[1], speaker: turn[0], voice: 'en_GB' } });
    } else {
      const [answer, wrong] = turn.you;
      items.push(choice('What do you say?', answer, wrong, { tag: `listening.respond.${area}` }));
      dialogue.push({ itemId: `i${items.length}`, speaker: 'You' });
    }
  }
  return activity({
    key: `listen.respond.${key}`,
    title,
    kind: 'listen-respond',
    cefr,
    skill: 'listening',
    mode: 'practice',
    intro: `You are talking to ${other}. Listen, then choose the most suitable reply each time it is your turn.`,
    dialogue,
    items,
  });
}

const RESPOND: CatalogActivity[] = [
  respond('party', 'Meeting people: at a party', 'meeting', 'A2', 'someone you have just met', [
    ['Sam', "Hi, I don't think we've met. I'm Sam."],
    { you: ["Nice to meet you, Sam. I'm Priya.", ["Yes, I'm fine, thank you.", 'Goodbye, see you later.']] },
    ['Sam', 'Nice to meet you too. How do you know the host?'],
    { you: ['We work together at the bank.', ["I know, it's a big house.", 'Yes, I do.']] },
    ['Sam', 'Oh really? What do you do there?'],
    { you: ["I'm an accountant.", ["I'm doing very well.", "At nine o'clock."]] },
    ['Sam', 'That sounds interesting. Can I get you a drink?'],
    { you: ['Yes, please. An orange juice would be lovely.', ["No, I can't.", "It's interesting."]] },
  ]),
  respond('class', 'Meeting people: first day in class', 'meeting', 'A1', 'another new student', [
    ['Student', 'Excuse me, is this seat free?'],
    { you: ['Yes, please sit down.', ["No, it's three o'clock.", "I'm free on Sunday."]] },
    ['Student', 'Thanks. Are you new here too?'],
    { you: ["Yes, it's my first day.", ["Yes, it's new.", "No, I'm not old."]] },
    ['Student', 'Me too. Where are you from?'],
    { you: ["I'm from Lucknow.", ["I'm going to Lucknow.", 'From nine to five.']] },
    ['Student', 'Great. Shall we have lunch together later?'],
    { you: ['Good idea. See you at one.', ['I had lunch.', "No, I'm from Lucknow."]] },
  ]),
  respond('order', 'Eating out: ordering a meal', 'eating', 'A2', 'a waiter', [
    ['Waiter', 'Good evening. Are you ready to order?'],
    { you: ["Yes, I'll have the vegetable curry, please.", ["Yes, I'm ready to go.", "Good evening, I'm fine."]] },
    ['Waiter', 'Would you like rice or bread with that?'],
    { you: ['Rice, please.', ['Yes, please.', 'I like it very much.']] },
    ['Waiter', 'And anything to drink?'],
    { you: ['Just a glass of water, thanks.', ['It was delicious.', "No, I'm not hungry."]] },
    ['Waiter', 'How was your meal?'],
    { you: ['It was delicious, thank you. Could we have the bill, please?', ["Yes, I'll have the curry.", "I'm ready to order."]] },
  ]),
  respond('problem', 'Eating out: a problem with the order', 'eating', 'B1', 'a waiter', [
    ['Waiter', "Here's your soup."],
    { you: ['Sorry, I think I ordered the salad, not the soup.', ["Thank you, I'll pay by card.", "Yes, it's cold today."]] },
    ['Waiter', "Oh, I'm so sorry. I'll change it right away."],
    { you: ["That's fine, thank you.", ["No, I don't.", 'Yes, I am.']] },
    ['Waiter', "Here's your salad. Can I get you anything else?"],
    { you: ["No, that's everything, thanks.", ["Yes, it's a salad.", "I'm sorry to hear that."]] },
  ]),
  respond('cinema', 'Booking tickets: at the cinema', 'booking', 'A2', 'the ticket clerk', [
    ['Clerk', 'Hello. Which film would you like to see?'],
    { you: ['Two tickets for The Long Road, please.', ['I saw it last week.', 'At the cinema.']] },
    ['Clerk', "For the six o'clock or the nine o'clock show?"],
    { you: ["The six o'clock, please.", ['Yes, please.', 'For two hours.']] },
    ['Clerk', 'Where would you like to sit?'],
    { you: ['Near the middle, if possible.', ["I'd like some popcorn.", 'On Saturday.']] },
    ['Clerk', "That's five hundred rupees. How would you like to pay?"],
    { you: ['By card, please.', ['Five hundred.', 'Thank you, goodbye.']] },
  ]),
  respond('train', 'Booking tickets: a train on the phone', 'booking', 'B1', 'a booking agent', [
    ['Agent', 'Good morning, Rail Bookings. How can I help?'],
    { you: ["I'd like to book a ticket to Jaipur for Friday, please.", ["I'm very well, thanks.", "I'm on the train."]] },
    ['Agent', 'The morning or the evening train?'],
    { you: ['The morning one, please.', ['Yes, a train.', 'On Friday.']] },
    ['Agent', 'First class or second class?'],
    { you: ['Second class, please.', ['Once, please.', 'Class starts at nine.']] },
    ['Agent', 'Could I have your name, please?'],
    { you: ["Yes, it's Arjun Mehta.", ['My name is fine.', 'No, thank you.']] },
  ]),
];

// ---- Unit 3: Note-taking -----------------------------------------------------------

function notes(key: string, title: string, form: string, cefr: Level, lines: Array<[string, string]>, fields: ItemDraft[]): CatalogActivity {
  return activity({
    key: `listen.notes.${key}`,
    title,
    kind: 'note-taking',
    cefr,
    skill: 'listening',
    mode: 'test',
    intro: 'Look at the form first. Then listen and write short notes — one or two words or a number in each box.',
    form: { title: form, instructions: 'Spelling counts for names. Numbers can be written as figures.' },
    script: script(lines),
    items: fields,
  });
}

const NOTES: CatalogActivity[] = [
  notes(
    'message',
    'Take a telephone message',
    'Telephone message',
    'A2',
    [
      [
        'Caller',
        "Hello, can I leave a message for Mr Kapoor? This is Linda Grant from Blue Sky Travel. His flight on Thursday has changed to four fifteen in the afternoon. Could he call me back on nine eight four five zero, one two three six seven? Thanks.",
      ],
    ],
    [
      field('For', ['Mr Kapoor', 'Kapoor']),
      field('From (name)', ['Linda Grant']),
      field('Company', ['Blue Sky Travel']),
      field('Flight day', ['Thursday']),
      field('New flight time', ['4.15 pm', '4:15 pm', '4.15', '4:15', 'quarter past four', '16:15', '16.15']),
      field('Call back on', ['98450 12367', '9845012367']),
    ],
  ),
  notes(
    'registration',
    'Fill in a course registration form',
    'Evening classes — registration form',
    'A2',
    [
      ['Clerk', 'Can I have your full name, please?'],
      ['Student', 'Deepa Nair. That\'s N, A, I, R.'],
      ['Clerk', 'And your date of birth?'],
      ['Student', 'The fourteenth of March, two thousand and two.'],
      ['Clerk', 'Which course would you like?'],
      ['Student', 'The evening computer course.'],
      ['Clerk', 'It starts on the fifth of June and costs three thousand rupees.'],
    ],
    [
      field('Surname', ['Nair']),
      field('First name', ['Deepa']),
      field('Date of birth', ['14 March 2002', '14th March 2002', 'March 14 2002', '14/03/2002', '14/3/2002', '14.3.2002', '14-03-2002']),
      field('Course', ['evening computer course', 'computer course', 'computer', 'computers', 'evening computer']),
      field('Start date', ['5 June', '5th June', 'June 5', 'June 5th', '5/6', '05/06']),
      field('Fee (rupees)', ['3000', '3,000', '3000 rupees', '3,000 rupees', 'rs 3000']),
    ],
  ),
  notes(
    'bus',
    'Complete the airport bus timetable',
    'Airport bus timetable',
    'A2',
    [
      [
        'Announcer',
        'Buses to the airport leave every thirty minutes, starting at six in the morning. The journey takes about forty-five minutes. The last bus is at eleven thirty at night. A single ticket costs eighty rupees, and a return is one hundred and fifty.',
      ],
    ],
    [
      field('First bus', ['6 am', '6.00', '6:00', '6', "6 o'clock", '06:00', '6.00 am', '6:00 am']),
      field('Buses run every', ['30 minutes', 'thirty minutes', '30 mins', '30', 'half an hour']),
      field('Journey time', ['45 minutes', 'forty five minutes', '45 mins', '45']),
      field('Last bus', ['11.30 pm', '11:30 pm', '11.30', '11:30', '23:30', '23.30']),
      field('Single ticket (rupees)', ['80', '80 rupees', 'rs 80']),
      field('Return ticket (rupees)', ['150', '150 rupees', 'rs 150']),
    ],
  ),
  notes(
    'induction',
    'Complete the induction week timetable',
    'Induction week timetable',
    'B1',
    [
      [
        'Trainer',
        "Welcome to induction week. On Monday morning there's a safety briefing at nine. Monday afternoon is computer training. On Tuesday you'll visit the workshop. Wednesday is a first aid course, and on Thursday afternoon you'll have a meeting with your manager. Friday is free for study.",
      ],
    ],
    [
      field('Monday 9 am', ['safety briefing', 'safety']),
      field('Monday afternoon', ['computer training', 'computers', 'computer']),
      field('Tuesday', ['workshop visit', 'visit the workshop', 'visit workshop', 'workshop']),
      field('Wednesday', ['first aid course', 'first aid']),
      field('Thursday afternoon', ['meeting with manager', 'meeting with your manager', 'manager meeting', 'meeting']),
      field('Friday', ['free for study', 'study', 'free', 'free study', 'self study']),
    ],
  ),
  notes(
    'appointment',
    "Note down a doctor's appointment",
    'Appointment card',
    'B1',
    [
      [
        'Receptionist',
        'Your appointment is with Doctor Singh on Wednesday the twelfth, at twenty past ten. Please arrive ten minutes early and bring your blood test results. The clinic is on the first floor, in room fourteen.',
      ],
    ],
    [
      field('Doctor', ['Dr Singh', 'Doctor Singh', 'Singh', 'Dr. Singh']),
      field('Day and date', ['Wednesday 12th', 'Wednesday the 12th', 'Wednesday 12', 'Wed 12th', 'Wednesday']),
      field('Time', ['10.20', '10:20', 'twenty past ten', '10.20 am', '10:20 am']),
      field('Bring', ['blood test results', 'blood test', 'test results', 'blood results']),
      field('Floor', ['first', 'first floor', '1st', '1st floor', '1']),
      field('Room', ['14', 'room 14', 'fourteen']),
    ],
  ),
  notes(
    'delivery',
    'Complete a delivery order form',
    'Furniture delivery order',
    'B1',
    [
      ['Assistant', 'Which item would you like to order?'],
      ['Customer', "The blue sofa, please. It's model S-forty."],
      ['Assistant', 'And the delivery address?'],
      ['Customer', 'Twenty-seven Lake View Road, Pune.'],
      ['Assistant', 'Which day suits you?'],
      ['Customer', 'Saturday morning is best.'],
      ['Assistant', 'And a contact number?'],
      ['Customer', 'Nine eight two zero zero, four five one one seven.'],
    ],
    [
      field('Item', ['blue sofa', 'sofa', 'a blue sofa']),
      field('Model', ['S-40', 'S40', 'S 40']),
      field('Address', ['27 Lake View Road', '27 Lake View Road Pune', '27 Lakeview Road']),
      field('Delivery day', ['Saturday', 'Saturday morning', 'Sat']),
      field('Phone', ['98200 45117', '9820045117']),
    ],
  ),
];

// ---- Unit 4: General Listening (gist, then detail) ---------------------------------

function general(key: string, title: string, kind: 'interview' | 'talk', cefr: Level, lines: Array<[string, string]>, gist: ItemDraft[], detail: ItemDraft[]): CatalogActivity {
  return activity({
    key: `listen.general.${key}`,
    title,
    kind: 'listening',
    cefr,
    skill: 'listening',
    mode: 'test',
    intro: `Listen to the ${kind} once for the main idea and answer the gist questions. Then listen again for the details.`,
    script: script(lines),
    items: [
      ...gist.map((g) => ({ ...g, phase: 'gist' as const, tag: 'listening.gist' })),
      ...detail.map((d) => ({ ...d, phase: 'detail' as const, tag: 'listening.detail' })),
    ] as ItemDraft[],
  });
}

const GENERAL: CatalogActivity[] = [
  general(
    'chef',
    'Interview: a young chef',
    'interview',
    'B1',
    [
      ['Interviewer', "Today I'm talking to Anjali Rao, who runs a popular restaurant in Bengaluru. Anjali, how did you start?"],
      ['Anjali', 'I started cooking with my grandmother when I was twelve. She taught me all the traditional dishes.'],
      ['Interviewer', 'And did you study cooking?'],
      ['Anjali', 'Yes. After school I trained for three years at a big hotel in Goa. It was hard work, but I learned a lot.'],
      ['Interviewer', 'When did you open your own restaurant?'],
      ['Anjali', 'Five years ago. At first we had only six tables. Now we have thirty.'],
      ['Interviewer', 'What advice would you give young cooks?'],
      ['Anjali', 'Practise every day, and taste everything you cook!'],
    ],
    [
      choice('What is the interview mainly about?', 'how Anjali became a chef', ['how to cook traditional dishes', 'why hotels in Goa are popular']),
      choice('How does Anjali feel about her career?', 'proud and positive', ['disappointed', 'bored']),
    ],
    [
      choice('Who first taught Anjali to cook?', 'her grandmother', ['her mother', 'a hotel chef']),
      choice('How old was she then?', 'twelve', ['twenty', 'three']),
      choice('Where did she train?', 'at a hotel in Goa', ['at a school in Bengaluru', "in her grandmother's restaurant"]),
      choice('How many tables does her restaurant have now?', 'thirty', ['six', 'thirteen']),
      choice('What is her advice to young cooks?', 'practise every day and taste everything', ['open a restaurant early', 'train in Goa']),
    ],
  ),
  general(
    'water',
    'Talk: saving water at home',
    'talk',
    'B1',
    [
      [
        'Speaker',
        'Good afternoon. Today I want to talk about something we all use, but often waste: water. The average family can save more than a hundred litres a day with a few simple changes. First, turn off the tap while you brush your teeth. That alone saves about twelve litres. Second, take shorter showers. Five minutes is enough. Third, fix dripping taps quickly: a tap that drips all day can waste thirty litres. Finally, collect rainwater to water your garden. Small changes, big difference.',
      ],
    ],
    [choice('What is the main purpose of the talk?', 'to give tips for saving water at home', ['to explain where rainwater comes from', 'to sell a new kind of tap'])],
    [
      choice('How much water can a family save?', 'more than 100 litres a day', ['12 litres a day', '30 litres a day']),
      choice('How much does turning off the tap while brushing save?', 'about 12 litres', ['about 5 litres', 'about 100 litres']),
      choice('How long should a shower be?', 'five minutes', ['ten minutes', 'fifteen minutes']),
      choice('How much can a dripping tap waste in a day?', '30 litres', ['12 litres', '100 litres']),
      choice('What should rainwater be used for?', 'watering the garden', ['drinking', 'washing clothes']),
    ],
  ),
  general(
    'volunteer',
    'Interview: a volunteer teacher',
    'interview',
    'B1',
    [
      ['Interviewer', 'You spent a year teaching in a village school. Why did you go?'],
      ['Volunteer', "I'd finished university, and I wanted to do something useful before I started a job."],
      ['Interviewer', 'What was the most difficult thing?'],
      ['Volunteer', 'At first, the language. The children spoke Marathi, and my Marathi was terrible! But they helped me learn.'],
      ['Interviewer', 'And the best part?'],
      ['Volunteer', 'Seeing the children read their first English story. They were so proud.'],
      ['Interviewer', 'Would you recommend it?'],
      ['Volunteer', 'Absolutely. I learned more than I taught.'],
    ],
    [
      choice('What is the interview about?', 'a year spent teaching in a village', ['how to learn Marathi quickly', 'problems at city universities']),
      choice("What is the volunteer's opinion of the experience?", 'very positive', ['mostly negative', 'not sure']),
    ],
    [
      choice('When did she go to the village?', 'after university', ['while she was at school', 'after she retired']),
      choice('What was difficult at first?', 'the language', ['the food', 'the weather']),
      choice('What was the best part?', 'the children reading their first English story', ['finishing university', 'learning to cook']),
      choice('"I learned more than I taught" means…', 'the experience taught her a lot', ['the children were better teachers', 'she did not teach much']),
    ],
  ),
  general(
    'sports-centre',
    'Local radio: a new sports centre',
    'talk',
    'B1',
    [
      [
        'Presenter',
        'And now local news. The new sports centre on Station Road opens next Saturday. It has a twenty-five metre swimming pool, two badminton courts and a gym. Membership costs eight hundred rupees a month, but students pay half price. The mayor will open the centre at ten o\'clock, and entry is free for everyone on the first day.',
      ],
    ],
    [choice('What is the news item about?', 'the opening of a new sports centre', ['a football match result', 'a swimming competition'])],
    [
      choice('Where is the sports centre?', 'on Station Road', ['on Park Road', 'near the school']),
      choice('When does it open?', 'next Saturday', ['next Sunday', 'today']),
      choice('How long is the swimming pool?', '25 metres', ['50 metres', '20 metres']),
      choice('How much do students pay?', '400 rupees a month', ['800 rupees a month', 'nothing']),
      choice('When is entry free?', 'on the first day', ['every Saturday', 'for children only']),
    ],
  ),
  general(
    'new-job',
    'Talk: your first days in a new job',
    'talk',
    'B2',
    [
      [
        'Speaker',
        "Starting a new job can be stressful, so here are some pieces of advice. Before your first day, plan your journey and do a practice run, so you know exactly how long it takes. On the day, arrive about ten minutes early. Not thirty, which can be awkward. During your first week, ask questions. Nobody expects you to know everything, and asking shows you're interested. Most importantly, learn people's names, and write them down if you need to.",
      ],
    ],
    [choice('What is the talk about?', 'advice for starting a new job', ['how to write a job application', 'why some jobs are stressful'])],
    [
      choice('Why should you do a practice run of the journey?', 'to know how long it takes', ['to meet your colleagues', 'to find a parking space']),
      choice('When should you arrive on the first day?', 'about ten minutes early', ['thirty minutes early', 'exactly on time']),
      choice('Arriving thirty minutes early can be…', 'awkward', ['impressive', 'expected']),
      choice('Asking questions shows that you are…', 'interested', ['worried', 'not ready']),
      choice('What does the speaker say about names?', 'write them down if you need to', ['use first names only', 'ask your manager for a list']),
    ],
  ),
  general(
    'guide',
    'Interview: a mountain guide',
    'interview',
    'B2',
    [
      ['Interviewer', 'How long have you been a mountain guide?'],
      ['Guide', 'Nearly twenty years. I grew up in Manali, so the mountains were always part of my life.'],
      ['Interviewer', "What's the most important quality for a guide?"],
      ['Guide', 'Patience. Some walkers are fit, others are slow, and everybody needs to feel safe.'],
      ['Interviewer', 'Has anything ever gone badly wrong?'],
      ['Guide', 'Once, a sudden snowstorm trapped our group for a night. We stayed calm, shared our food, and walked down safely the next morning.'],
      ['Interviewer', 'What do you still love about the job?'],
      ['Guide', 'The silence at the top, early in the morning. It never gets old.'],
    ],
    [
      choice('What is the interview mainly about?', "a guide's life and experiences in the mountains", ['how to climb safely in winter', 'hotels in Manali']),
      choice('How does the guide feel about the job?', 'he still loves it', ['he wants to stop', 'he finds it boring']),
    ],
    [
      choice('How long has he been a guide?', 'nearly twenty years', ['ten years', 'twelve years']),
      choice('Where did he grow up?', 'in Manali', ['in Shimla', 'in Delhi']),
      choice('What does he say is the most important quality?', 'patience', ['speed', 'strength']),
      choice('What happened in the snowstorm?', 'the group was trapped for a night', ['someone was hurt', 'they had to be rescued by helicopter']),
      choice('What does he still love?', 'the silence at the top early in the morning', ['meeting new walkers', 'the snow']),
    ],
  ),
];

export const LISTENING_TAGS: Record<string, CatalogTag> = {
  'listening.specific': { label: 'Listening for specific information', activityKey: 'listen.active.market' },
  'listening.respond.meeting': { label: 'Responding: meeting people', activityKey: 'listen.respond.party' },
  'listening.respond.eating': { label: 'Responding: eating out', activityKey: 'listen.respond.order' },
  'listening.respond.booking': { label: 'Responding: booking tickets', activityKey: 'listen.respond.cinema' },
  'listening.notes': { label: 'Note-taking', activityKey: 'listen.notes.message' },
  'listening.gist': { label: 'Listening for gist (main idea)', activityKey: 'listen.general.chef' },
  'listening.detail': { label: 'Listening for detail', activityKey: 'listen.general.water' },
};

export const LISTENING_TRACK: CatalogTrack = {
  key: 'listening',
  title: 'Listening',
  description: 'Listen for specific information, take part in conversations, take notes on forms and timetables, and follow interviews and talks.',
  units: [
    { key: 'listen-active', title: 'Active Listening', description: 'Listen for something specific — what a shopper buys, which platform, what to bring.', activities: ACTIVE },
    { key: 'listen-respond', title: 'Listen and Respond', description: 'Take the part of one speaker and choose the best reply: meeting people, eating out, booking tickets.', activities: RESPOND },
    { key: 'listen-notes', title: 'Listening and Note-taking', description: 'Fill in forms, take messages and complete timetables while you listen.', activities: NOTES },
    { key: 'listen-general', title: 'General Listening', description: 'Interviews and talks: answer the gist questions first, then the specific questions.', activities: GENERAL },
  ],
};
