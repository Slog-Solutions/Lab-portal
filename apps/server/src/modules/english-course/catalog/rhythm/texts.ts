/**
 * Ser 10 "Rhythm ... everyday dialogues, jokes, poems, rhymes and
 * quotations ... 48 texts which you may access unit-by-unit or by topic
 * area". All originally written (the quotations are traditional proverbs).
 *
 * Notation: stressed syllables in CAPITALS (the beat), everything else in
 * lower case — "i WANT a CUP of TEA". A [bracketed] weak word becomes a
 * fill-the-gap question. "A: " / "Teacher: " starts a speaker's line.
 */

export type RhythmGenre = 'dialogue' | 'joke' | 'poem' | 'rhyme' | 'quotation';

export interface RhythmText {
  title: string;
  genre: RhythmGenre;
  topic: string;
  lines: string[];
}

export interface RhythmUnit {
  title: string;
  cefr: 'A1' | 'A2' | 'B1' | 'B2';
  texts: RhythmText[];
}

export const RHYTHM_UNITS: RhythmUnit[] = [
  {
    title: 'Unit 1',
    cefr: 'A1',
    texts: [
      {
        title: 'Good morning',
        genre: 'dialogue',
        topic: 'Everyday life',
        lines: ['A: good MORNing! HOW [are] YOU?', "B: i'm FINE, THANKS. [and] YOU?", "A: NOT BAD. it's a LOVEly DAY.", 'B: YES, it IS. have a NICE DAY!'],
      },
      {
        title: 'At the café',
        genre: 'dialogue',
        topic: 'Food & drink',
        lines: ['A: CAN i [have] a CUP of TEA, PLEASE?', 'B: with MILK [or] LEMon?', 'A: with MILK, PLEASE. and a SLICE of CAKE.', "B: THAT'S three POUNDS, PLEASE."],
      },
      {
        title: 'Two fish',
        genre: 'joke',
        topic: 'Family & friends',
        lines: ['TWO FISH [are] in a TANK.', 'ONE SAYS [to] the OTHer:', '"do you KNOW how to DRIVE this THING?"'],
      },
      {
        title: 'Days of the week',
        genre: 'rhyme',
        topic: 'Everyday life',
        lines: ['MONday, TUESday, OFF [to] SCHOOL,', 'WEDnesday, THURSday, SWIM [in] the POOL,', 'FRIday, SATurday, PLAY in the SUN,', "SUNday's for SLEEPing [and] HAVing FUN."],
      },
      {
        title: 'Rain',
        genre: 'poem',
        topic: 'Weather & nature',
        lines: ['the RAIN comes DOWN [on] the ROOF,', 'it TAPS and it TAPS all NIGHT.', 'in the MORNing the SKY is BLUE', '[and] the WORLD is CLEAN and BRIGHT.'],
      },
      {
        title: 'Actions and words',
        genre: 'quotation',
        topic: 'Everyday life',
        lines: ['ACtions SPEAK LOUDer [than] WORDS.', 'WELL DONE is BETter [than] WELL SAID.'],
      },
    ],
  },
  {
    title: 'Unit 2',
    cefr: 'A1',
    texts: [
      {
        title: 'How much is it?',
        genre: 'dialogue',
        topic: 'Shopping',
        lines: ['A: exCUSE me, how MUCH [is] this SHIRT?', "B: it's TWENty POUNDS.", 'A: do you HAVE it [in] BLUE?', 'B: YES, we DO. here you ARE.'],
      },
      {
        title: "Where's the station?",
        genre: 'dialogue',
        topic: 'Travel',
        lines: ["A: exCUSE me. WHERE'S the STAtion?", 'B: go STRAIGHT ON [and] turn LEFT.', 'A: IS it FAR?', "B: NO, it's aBOUT five MINutes [on] FOOT."],
      },
      {
        title: 'Doctor, doctor',
        genre: 'joke',
        topic: 'Health',
        lines: ['A: DOCtor, DOCtor, i FEEL like a PAIR [of] CURtains!', 'B: WELL, PULL yourSELF toGETHer!'],
      },
      {
        title: 'Breakfast',
        genre: 'rhyme',
        topic: 'Food & drink',
        lines: ['EGGS [and] TOAST and a GLASS of JUICE,', 'BREAD and HONey and a BOWL of FRUIT,', 'EAT it SLOWly, EAT it WELL,', '[then] RUN to SCHOOL beFORE the BELL.'],
      },
      {
        title: 'My friend',
        genre: 'poem',
        topic: 'Family & friends',
        lines: ['my FRIEND is TALL, my FRIEND is KIND,', "she ALways KNOWS what's [on] my MIND.", 'we WALK to SCHOOL, we SHARE our LUNCH,', 'and ON [the] WAY we LAUGH a BUNCH.'],
      },
      {
        title: 'An apple a day',
        genre: 'quotation',
        topic: 'Health',
        lines: ['an APple a DAY keeps [the] DOCtor aWAY.', 'a GOOD LAUGH [is] the BEST MEDicine.'],
      },
    ],
  },
  {
    title: 'Unit 3',
    cefr: 'A2',
    texts: [
      {
        title: 'First day at work',
        genre: 'dialogue',
        topic: 'Work & study',
        lines: ["A: HI, i'm RAvi. it's my FIRST DAY.", "B: WELcome! i'm ANna. i WORK [in] SALES.", "A: NICE [to] MEET you. WHERE'S the KITchen?", "B: at the END of the CORridor. i'll SHOW you."],
      },
      {
        title: 'Buying a ticket',
        genre: 'dialogue',
        topic: 'Travel',
        lines: ['A: ONE TICKet to CHENnai, PLEASE.', 'B: SINgle [or] reTURN?', "A: reTURN, PLEASE. WHAT TIME's the NEXT TRAIN?", 'B: at TEN [to] NINE, from PLATform FOUR.'],
      },
      {
        title: 'The homework',
        genre: 'joke',
        topic: 'Work & study',
        lines: ['Teacher: WHERE [is] your HOMEwork?', 'Student: my DOG ATE it.', "Teacher: but you HAVEn't GOT a DOG!", 'Student: i KNOW. i BORrowed ONE [from] my NEIGHbour.'],
      },
      {
        title: 'Seasons',
        genre: 'rhyme',
        topic: 'Weather & nature',
        lines: ["SPRING is GREEN [and] SUMmer's HOT,", "AUtumn's WINdy, [is] it NOT?", "WINter's COLD with SNOW and ICE,", "EVery SEAson's NICE, NICE, NICE!"],
      },
      {
        title: 'The city at night',
        genre: 'poem',
        topic: 'Everyday life',
        lines: ['the LIGHTS come ON [in] the BUSy STREET,', 'the BUSes HUM and the TAXis BEEP,', 'the SHOPS close UP, the CAfés FILL,', '[and] the MOON looks DOWN from the TOP of the HILL.'],
      },
      {
        title: 'Practice makes perfect',
        genre: 'quotation',
        topic: 'Work & study',
        lines: ['PRACtice MAKES PERfect.', "you're NEVer too OLD [to] LEARN."],
      },
    ],
  },
  {
    title: 'Unit 4',
    cefr: 'A2',
    texts: [
      {
        title: "At the doctor's",
        genre: 'dialogue',
        topic: 'Health',
        lines: ['A: WHAT seems [to] be the PROBlem?', "B: i've GOT a HEADache and a SORE THROAT.", 'A: HOW LONG have you HAD it?', "B: since TUESday. i CAN'T SLEEP [at] NIGHT."],
      },
      {
        title: 'Weekend plans',
        genre: 'dialogue',
        topic: 'Family & friends',
        lines: ['A: WHAT are you DOing [at] the WEEKend?', "B: i'm VISiting my GRANDparents. WHAT aBOUT YOU?", 'A: NOTHing MUCH. MAYbe a FILM.', "B: why DON'T you COME [with] ME?"],
      },
      {
        title: 'Waiter!',
        genre: 'joke',
        topic: 'Food & drink',
        lines: ["A: WAITer, there's a FLY [in] my SOUP!", "B: DON'T WORry, sir. the SPIder [on] the BREAD will GET it."],
      },
      {
        title: 'Off to the market',
        genre: 'rhyme',
        topic: 'Shopping',
        lines: ['OFF to the MARket [with] MONey to SPEND,', 'a BAG for my MOTHer, a GIFT for my FRIEND,', 'APples [and] ORanges, BREAD and some TEA,', 'and ONE little CHOColate, JUST for ME!'],
      },
      {
        title: 'The train',
        genre: 'poem',
        topic: 'Travel',
        lines: ['the TRAIN runs FAST aCROSS the PLAIN,', 'through TUNnels DARK and FIELDS [of] GRAIN,', 'past RIVers WIDE and HILLS so HIGH,', '[and] TOWNS that WAVE as we RUSH BY.'],
      },
      {
        title: 'A friend in need',
        genre: 'quotation',
        topic: 'Family & friends',
        lines: ['a FRIEND in NEED [is] a FRIEND inDEED.', 'BIRDS [of] a FEATHer FLOCK toGETHer.'],
      },
    ],
  },
  {
    title: 'Unit 5',
    cefr: 'B1',
    texts: [
      {
        title: 'The job interview',
        genre: 'dialogue',
        topic: 'Work & study',
        lines: ['A: WHY do you WANT [to] WORK here?', "B: i've HEARD a LOT aBOUT your TRAINing PROgramme.", 'A: and WHAT are your STRENGTHS?', "B: i'm ORganised, and i WORK WELL [in] a TEAM."],
      },
      {
        title: 'Checking in',
        genre: 'dialogue',
        topic: 'Travel',
        lines: ['A: good EVEning. i have a reserVAtion [for] TWO NIGHTS.', "B: WHAT'S the NAME, PLEASE?", 'A: MEEra SHARma.', "B: here's your KEY. BREAKfast is [from] SEVen to TEN."],
      },
      {
        title: 'Two riddles',
        genre: 'joke',
        topic: 'Everyday life',
        lines: ["WHAT has KEYS [but] CAN'T OPen a DOOR?", 'a piANo!', "WHAT has HANDS [but] CAN'T CLAP?", 'a CLOCK!'],
      },
      {
        title: 'Healthy habits',
        genre: 'rhyme',
        topic: 'Health',
        lines: ['WASH your HANDS beFORE you EAT,', 'BRUSH your TEETH [and] WASH your FEET,', 'DRINK some WAter, GET some SLEEP,', "THAT'S a HEALTHy HABit [to] KEEP."],
      },
      {
        title: 'The storm',
        genre: 'poem',
        topic: 'Weather & nature',
        lines: ['the WIND grew STRONG [and] the SKY turned GREY,', 'the BIRDS flew HOME at the END of the DAY,', 'then THUNder ROLLED and the RAIN came DOWN', '[on] EVery ROOF in the SLEEPy TOWN.'],
      },
      {
        title: 'A penny saved',
        genre: 'quotation',
        topic: 'Shopping',
        lines: ['you GET [what] you PAY for.', 'a PENny SAVED [is] a PENny EARNED.'],
      },
    ],
  },
  {
    title: 'Unit 6',
    cefr: 'B1',
    texts: [
      {
        title: 'Changing a jumper',
        genre: 'dialogue',
        topic: 'Shopping',
        lines: ["A: i BOUGHT this JUMPer YESterday, [but] it's too SMALL.", 'B: would you LIKE [to] exCHANGE it?', 'A: YES, PLEASE. do you HAVE a LARGE?', 'B: let me CHECK. YES — HERE you ARE.'],
      },
      {
        title: 'Booking a table',
        genre: 'dialogue',
        topic: 'Food & drink',
        lines: ["A: i'd LIKE to BOOK a TAble [for] FOUR, PLEASE.", 'B: for WHAT TIME?', "A: EIGHT o'CLOCK on SATurday.", "B: that's FINE. can i HAVE [your] NAME?"],
      },
      {
        title: 'Knock knock',
        genre: 'joke',
        topic: 'Everyday life',
        lines: ['A: KNOCK, KNOCK.', "B: WHO'S THERE?", 'A: LETtuce.', 'B: LETtuce WHO?', "A: LETtuce IN, [it's] COLD OUTSIDE!"],
      },
      {
        title: 'Nine to five',
        genre: 'rhyme',
        topic: 'Work & study',
        lines: ['UP at SEVen, OUT [by] EIGHT,', "RUN for the BUS, i MUSTn't be LATE,", 'WORK till LUNCH [and] WORK till FIVE,', 'HOME for DINner — GLAD to be aLIVE!'],
      },
      {
        title: 'Sunday morning',
        genre: 'poem',
        topic: 'Everyday life',
        lines: ['NO aLARM, NO HURry, NO RUSH,', 'the STREET is QUIet, [the] TOWN is HUSHED,', 'i MAKE some TEA and READ the PAper', '[and] SAVE my WORries for LATer.'],
      },
      {
        title: 'Every cloud',
        genre: 'quotation',
        topic: 'Weather & nature',
        lines: ['EVery CLOUD has [a] SILver LINing.', 'afTER [the] STORM comes a CALM.'],
      },
    ],
  },
  {
    title: 'Unit 7',
    cefr: 'B1',
    texts: [
      {
        title: 'Moving the meeting',
        genre: 'dialogue',
        topic: 'Work & study',
        lines: ['A: could we MOVE the MEETing [to] THURSday?', "B: THURSday's DIFFicult. how aBOUT FRIday MORNing?", "A: FRIday's FINE. shall we SAY ten o'CLOCK?", "B: PERfect. i'll SEND [an] inviTAtion."],
      },
      {
        title: 'At the gym',
        genre: 'dialogue',
        topic: 'Health',
        lines: ['A: how OFten do you COME [to] the GYM?', 'B: THREE TIMES a WEEK, if i CAN.', 'A: i KEEP MEANing [to] START.', "B: COME with me toMORrow. it's MORE FUN with a FRIEND."],
      },
      {
        title: 'A piece of cake',
        genre: 'joke',
        topic: 'Work & study',
        lines: ['A: WHY did the STUdent EAT [his] HOMEwork?', 'B: beCAUSE the TEACHer SAID [it] was a PIECE of CAKE!'],
      },
      {
        title: 'Packing',
        genre: 'rhyme',
        topic: 'Travel',
        lines: ['SOCKS [and] SHIRTS and a TOOTHbrush TOO,', 'a MAP, a HAT and a PAIR of SHOES,', 'PASSport, TICKets, a BOOK [to] READ —', 'is there ANything ELSE that i NEED?'],
      },
      {
        title: "Grandmother's kitchen",
        genre: 'poem',
        topic: 'Family & friends',
        lines: ["in GRANDmother's KITCHen the POTS [are] SINGing,", 'the SPICes are DANCing, the SPOONS are RINGing,', 'she TELLS us STORies of LONG aGO', "[and] FEEDS us till we CAN'T say NO."],
      },
      {
        title: 'Knowledge is power',
        genre: 'quotation',
        topic: 'Work & study',
        lines: ['KNOWledge IS POWer.', 'the PEN is MIGHTier [than] the SWORD.'],
      },
    ],
  },
  {
    title: 'Unit 8',
    cefr: 'B2',
    texts: [
      {
        title: 'A complaint',
        genre: 'dialogue',
        topic: 'Shopping',
        lines: [
          "A: i ORdered a LAPtop TWO WEEKS aGO, [and] it STILL HASn't arRIVED.",
          "B: i'm SORry to HEAR that. can i HAVE your ORder NUMber?",
          "A: it's FOUR, SEVen, TWO, NINE.",
          "B: THANK you. i'll CHASE it UP [for] you STRAIGHT aWAY.",
        ],
      },
      {
        title: 'Delayed flight',
        genre: 'dialogue',
        topic: 'Travel',
        lines: [
          'A: exCUSE me, WHY [has] the FLIGHT been deLAYED?',
          "B: there's a TECHnical PROBlem with the PLANE.",
          'A: how LONG will we HAVE [to] WAIT?',
          "B: at LEAST an HOUR. we'll GIVE you a MEAL VOUCHer.",
        ],
      },
      {
        title: 'The librarian',
        genre: 'joke',
        topic: 'Everyday life',
        lines: ['i ASKED [the] liBRARian [for] a BOOK about PARanoia.', 'she WHISpered: "they\'re RIGHT beHIND you."'],
      },
      {
        title: 'Staying well',
        genre: 'rhyme',
        topic: 'Health',
        lines: ['GO to BED at a SENsible HOUR,', "EAT your GREENS [and] you'll HAVE the POWer,", 'WALK in the PARK [when] the WEATHer is FINE,', "and YOU'LL be FIT for a LONG, LONG TIME."],
      },
      {
        title: 'The sea',
        genre: 'poem',
        topic: 'Weather & nature',
        lines: ['the SEA is GREY [and] the SEA is BLUE,', "it's SOMEtimes OLD and it's SOMEtimes NEW,", 'it SINGS at NIGHT [to] the SLEEPing SHORE,', 'and COMES back IN for a LITtle bit MORE.'],
      },
      {
        title: 'Where there is a will',
        genre: 'quotation',
        topic: 'Everyday life',
        lines: ["WHERE there's a WILL, there's [a] WAY.", "DON'T COUNT your CHICKens beFORE [they] HATCH."],
      },
    ],
  },
];
