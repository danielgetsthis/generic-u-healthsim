export const HHP_SCENARIOS = [
  {
    id: 'heb-vaping-mi',
    courseCode: 'HEB 4233',
    courseTitle: 'Patient Health Education & Health Coaching',
    title: 'Motivational Interviewing: Nicotine Vaping Cessation',
    difficulty: 'Intermediate',
    durationTargetMinutes: 5,
    client: {
      name: 'Marcus Vance',
      age: 21,
      pronouns: 'he/him',
      role: 'Generic U Junior (Computer Science Major)',
      avatarInitials: 'MV',
      avatarColor: '#FF385C',
      voiceProfile: {
        gender: 'male',
        pitch: 0.96,
        rate: 1.03,
      },
      ttmStage: 'Contemplation',
      initialRapport: 48,
      initialAffect: 'Ambivalent & Slightly Guarded',
    },
    clinicalDossier: {
      referralSource: 'Generic U Campus Health Center post-bronchitis follow-up',
      chiefComplaint:
        'Persistent morning cough and shortness of breath walking up campus stairs; uses 5% nicotine pods (1 pod every 2 days).',
      vitalsAndBaseline: [
        'BP: 126/82 mmHg | HR: 84 bpm | SpO2: 98%',
        'Nicotine Dependence: First vape within 10 minutes of waking',
        'Sleep: 5.5 hrs/night during exam weeks',
      ],
      psychosocialContext:
        'Roommates all vape; relies on nicotine + energy drinks during late-night coding labs. Tried quitting "cold turkey" over Thanksgiving break and felt irritable and unable to focus.',
      learningObjectives: [
        'Use Open-Ended Questions and Complex Reflections (OARS) to explore ambivalence.',
        'Resist the "Righting Reflex" — avoid lecturing on lung damage without eliciting permission first.',
        'Evoke Change Talk by connecting values (athletic stamina, saving money, focus) to behavior.',
        'Collaborate on a small, realistic harm-reduction or preparation experiment (SMART goal).',
      ],
      chesCompetencies: [
        'Area I (1.2): Assess health behaviors, barriers, and readiness to change',
        'Area VI (6.5): Deliver health education using Motivational Interviewing techniques',
      ],
    },
    openingLine:
      "Hey. So the doctor at the Campus Health Center said I had to do this health coaching session before they'd clear my bronchitis follow-up. Look, I know vaping isn't great for my lungs, alright? Every doctor tells me that. It's just—with midterms and coding projects right now, it's literally the only thing keeping me from losing my mind.",
    cueCards: [
      {
        category: 'Complex Reflection + Empathy',
        text: "It sounds like you're under a lot of academic pressure right now, and vaping has been your go-to way to manage that stress, even though this bronchitis scare has you thinking twice.",
      },
      {
        category: 'Open-Ended Question (Exploring Pros/Cons)',
        text: 'What are some of the things you like about vaping, and what are the parts that are starting to bother you most?',
      },
      {
        category: 'Affirmation (Past Effort)',
        text: 'Thank you for being so upfront with me today, Marcus. Taking time out of midterm week to look at your health shows real commitment.',
      },
      {
        category: 'Elicit-Provide-Elicit (Asking Permission)',
        text: 'Would it be okay if we talked about a few ways other Generic U students handle nicotine cravings during study sessions without quitting all at once?',
      },
      {
        category: 'Scaling Question (Readiness Ruler)',
        text: 'On a scale from 1 to 10, where 1 is not ready at all and 10 is ready to change today, how important is it for you to cut back on vaping right now?',
      },
      {
        category: 'SMART Goal Collaboration',
        text: 'What is one small step you feel confident trying over the next 7 days during your late-night study blocks?',
      },
    ],
    simulationBrain: {
      defensiveTriggers: [
        'you need to quit',
        'you have to stop',
        'vaping will kill',
        'popcorn lung',
        'bad for you',
        'just stop buying',
        'throw it away',
      ],
      defensiveResponses: [
        "Yeah, I mean, I already know the health risks. My mom sends me articles about it every week. Telling me to just throw it in the trash right before midterms isn't really realistic for me.",
        "I feel like you're kinda lecturing me the same way the urgent care doctor did. If it were as easy as 'just stop,' I wouldn't still be doing it.",
      ],
      topicResponses: [
        {
          keywords: ['stress', 'midterm', 'exam', 'coding', 'school', 'pressure', 'overwhelm'],
          affect: 'Opening Up',
          rapportDelta: 10,
          response:
            "Honestly, yeah. Nobody really asks about the school load. When I'm stuck on an algorithm at 1 AM and my roommates are all hitting their vapes, it feels like an automatic reset button. Without it, I just pace around my room.",
        },
        {
          keywords: ['like about', 'pros and cons', 'good side', 'bother you', 'cough', 'breathing', 'stairs', 'lungs'],
          affect: 'Reflective',
          rapportDelta: 12,
          response:
            "The good part is definitely the instant head rush and taking a break. What bothers me? Honestly, coughing up phlegm every morning is embarrassing, and I used to play intramural basketball at the Campus Rec Center without getting winded in five minutes. Plus I'm spending like 80 bucks a month on pods.",
        },
        {
          keywords: ['scale', '1 to 10', 'one to ten', 'important', 'confident', 'readiness'],
          affect: 'Thoughtful',
          rapportDelta: 10,
          response:
            "For importance, I'd probably say a 6 or 7 because I hate how my chest feels after this bronchitis. But confidence? Maybe a 3 or 4. Last Thanksgiving I tried quitting cold turkey and lasted 36 hours before I snapped at my brother.",
        },
        {
          keywords: ['thanksgiving', 'past', 'tried before', '36 hours', 'cold turkey', 'what worked'],
          affect: 'Engaged',
          rapportDelta: 11,
          response:
            "When I tried over Thanksgiving, I didn't have anything to replace the hand-to-mouth habit, and the morning cravings were brutal. What did help for the first day was keeping my vape in my car instead of right next to my bed.",
        },
        {
          keywords: ['permission', 'would it be okay', 'may i share', 'if i shared', 'other students'],
          affect: 'Receptive',
          rapportDelta: 14,
          response:
            "Yeah, sure, I'm open to hearing that—especially if it's not just 'chew regular gum and suffer.' What actually works for people during finals?",
        },
        {
          keywords: ['small step', 'next week', '7 days', 'plan', 'goal', 'experiment', 'car', 'desk', 'delay'],
          affect: 'Motivated (Preparation Stage)',
          rapportDelta: 15,
          response:
            "I think I could actually do two things this week: first, leave the vape in my backpack in the living room so I don't hit it for the first 30 minutes after waking up, and second, keep it out of reach during my 2-hour coding blocks at the Main Library. That feels doable.",
        },
      ],
      fallbackOpenResponse:
        "That's a fair question. I guess part of me really wants my stamina back at the Campus Rec Center and to stop coughing every morning, but the other part is scared my grades will tank if I lose my focus aid right now.",
      fallbackClosedResponse:
        "Um, yeah, pretty much. I'm just not sure how that fits into my schedule right now.",
    },
  },
  {
    id: 'heb-prediabetes-nutrition',
    courseCode: 'HEB 3102',
    courseTitle: 'Personal & Family Health / Nutrition Behavior',
    title: 'Lifestyle Counseling: Newly Diagnosed Pre-Diabetes',
    difficulty: 'Intermediate',
    durationTargetMinutes: 5,
    client: {
      name: 'Elena Morales',
      age: 54,
      pronouns: 'she/her',
      role: '3rd Grade Teacher at Oakridge Elementary',
      avatarInitials: 'EM',
      avatarColor: '#00A699',
      voiceProfile: {
        gender: 'female',
        pitch: 1.05,
        rate: 0.98,
      },
      ttmStage: 'Contemplation',
      initialRapport: 45,
      initialAffect: 'Overwhelmed & Defensive about Food Culture',
    },
    clinicalDossier: {
      referralSource: 'University Family Medicine — Community Health Coaching Referral',
      chiefComplaint:
        'Routine lab work showed HbA1c of 6.2% (Pre-diabetes) and fasting glucose of 118 mg/dL. Mother had complications from Type 2 Diabetes.',
      vitalsAndBaseline: [
        'HbA1c: 6.2% | BMI: 31.4 | BP: 132/84 mmHg',
        'Activity: On feet teaching all day, but 0 mins structured aerobic exercise',
        'Nutrition: Skips breakfast, grabs fast food or sweet tea after school dismissal',
      ],
      psychosocialContext:
        'Deeply proud of cooking traditional family dinners (arroz con pollo, plantains) on Sundays. Feels shamed by online diet culture telling her to "cut all carbs." Exhausted by 4:00 PM after managing 22 third-graders.',
      learningObjectives: [
        'Validate emotional response to the pre-diabetes diagnosis and family history fears.',
        'Practice Cultural Humility — honor family food traditions rather than banning cultural staples.',
        'Explore the 3:30 PM energy crash / skipping breakfast pattern using non-judgmental curiosity.',
        'Co-design a sustainable nutrition or post-meal walking routine.',
      ],
      chesCompetencies: [
        'Area II (2.1): Engage priority populations and incorporate cultural humility in planning',
        'Area VI (6.1): Use effective communication skills to facilitate behavior change',
      ],
    },
    openingLine:
      "Hello. Look, before we start, if you're going to hand me another pamphlet saying I can never eat rice or plantains again and have to live on dry kale, I'm going to scream. Seeing that 6.2 A1c terrified me because of what my mom went through with diabetes, but I teach twenty-two third graders all day and cooking Sunday dinner is what holds my family together.",
    cueCards: [
      {
        category: 'Empathic Reflection + Cultural Affirmation',
        text: "No kale pamphlets here, Elena. Your Sunday dinners sound like a really meaningful part of your family connection, and it makes complete sense that you'd want to protect that while also feeling scared because of your mom's experience.",
      },
      {
        category: 'Open-Ended Question (Exploring Daily Routine)',
        text: 'Walk me through what a typical school day looks like for you from the morning bell until you get home.',
      },
      {
        category: 'Complex Reflection (Family History)',
        text: "Watching your mom go through diabetes complications left a deep impression on you, and you want a path forward that protects your health without stripping away the joy in your life.",
      },
      {
        category: 'Elicit-Provide-Elicit (Plate Balance)',
        text: 'Would it be alright if we looked at ways to keep your favorite family recipes on the table while adjusting the workday routine that leaves you exhausted at 4 PM?',
      },
      {
        category: 'Collaborative Goal Setting',
        text: 'Looking at your school day, what feels like the easiest adjustment to test out this week so you do not hit that afternoon energy wall?',
      },
    ],
    simulationBrain: {
      defensiveTriggers: [
        'cut out carbs',
        'stop eating rice',
        'keto',
        'no sugar',
        'lose weight fast',
        'bad food',
        'cheat meal',
      ],
      defensiveResponses: [
        "See, that's exactly why I dreaded coming here. Every time someone tells me rice is 'bad food,' I just shut down. I'm not cooking two separate meals on Sundays.",
        "I've done strict low-carb diets twice before and gained it all back within two months because I was miserable.",
      ],
      topicResponses: [
        {
          keywords: ['sunday', 'family', 'culture', 'tradition', 'kale', 'pamphlet', 'keep', 'rice', 'plantain'],
          affect: 'Relieved & Warm',
          rapportDelta: 15,
          response:
            "Oh, thank goodness. You have no idea how relieving it is to hear you say that. My kids and grandkids come over every Sunday, and cooking together is how I show love. If I don't have to give that up, I'm much more willing to look at my weekday habits.",
        },
        {
          keywords: ['mom', 'mother', 'scared', 'terrified', 'history', 'complication'],
          affect: 'Vulnerable & Reflective',
          rapportDelta: 12,
          response:
            "Yeah... my mom lost her vision in her late sixties and had neuropathy so bad she couldn't walk around the neighborhood. When my doctor said 'pre-diabetes,' my stomach dropped. I want to be around and active for my grandkids.",
        },
        {
          keywords: ['school day', 'typical day', 'routine', 'morning', 'breakfast', 'afternoon', 'tired', 'exhausted'],
          affect: 'Insightful',
          rapportDelta: 11,
          response:
            "Honestly, my weekdays are chaos. I rush out the door at 6:45 AM with just coffee, barely have 20 minutes to eat lunch while grading papers, and by 3:30 PM when bus duty ends, I'm starving and exhausted—so I hit the drive-thru for a large sweet tea and fries on the way home.",
        },
        {
          keywords: ['permission', 'alright if', 'okay if', 'protein', 'walk', 'experiment', 'easiest adjustment', 'week'],
          affect: 'Collaborative (Preparation Stage)',
          rapportDelta: 15,
          response:
            "Now that we talk it out, that 3:30 PM crash is clearly happening because I barely eat all day. I could definitely pack Greek yogurt and almonds for my morning prep period, and do a Half-and-Half sweet/unsweet tea instead of a large sweet tea. Plus my sister offered to walk with me for 15 minutes after Sunday dinner!",
        },
      ],
      fallbackOpenResponse:
        "I appreciate you asking rather than lecturing. I really do want to bring my A1c down before my next lab check in three months—I just need something that fits a teacher's schedule.",
      fallbackClosedResponse:
        "I suppose so, yes. It's just hard when I'm drained at the end of the workday.",
    },
  },
  {
    id: 'heb-athlete-sleep-alcohol',
    courseCode: 'HEB 4133',
    courseTitle: 'Substance Abuse & Campus Health Promotion',
    title: 'Harm Reduction: Student-Athlete Sleep & Alcohol Use',
    difficulty: 'Advanced',
    durationTargetMinutes: 6,
    client: {
      name: 'Jordan Miller',
      age: 19,
      pronouns: 'they/them',
      role: 'Generic U Sophomore Track & Field Athlete',
      avatarInitials: 'JM',
      avatarColor: '#FC642D',
      voiceProfile: {
        gender: 'neutral',
        pitch: 1.0,
        rate: 1.05,
      },
      ttmStage: 'Precontemplation / Contemplation',
      initialRapport: 40,
      initialAffect: 'Cautious & Concerned About Confidentiality',
    },
    clinicalDossier: {
      referralSource: 'Self-referred via Campus Wellness Services for "fatigue & insomnia"',
      chiefComplaint:
        'Takes 90+ minutes to fall asleep on weeknights; slower recovery times at morning track practice; uses alcohol (6–8 drinks on Friday/Saturday nights) to unwind and fall asleep.',
      vitalsAndBaseline: [
        'Sleep Efficiency: ~68% | Morning Practice: 6:00 AM daily',
        'Alcohol Pattern: Abstains Mon–Thu; 6–8 drinks Fri & Sat nights',
        'Caffeine: Pre-workout (300mg caffeine) taken at 3:30 PM before afternoon lift',
      ],
      psychosocialContext:
        'Terrified that admitting heavy weekend drinking will get reported to coaching staff. Believes alcohol helps them fall asleep faster on weekends, unaware of REM fragmentation and late-afternoon pre-workout half-life.',
      learningObjectives: [
        'Establish psychological safety and clarify confidentiality boundaries early.',
        'Explore the connection between athletic performance goals, afternoon caffeine, and weekend alcohol.',
        'Use Elicit-Provide-Elicit to share how alcohol impacts REM sleep and athletic recovery without moralizing.',
        'Develop a student-driven harm-reduction plan (e.g., drink pacing, caffeine cutoff).',
      ],
      chesCompetencies: [
        'Area I (1.3): Analyze behavioral determinants affecting sleep and substance use',
        'Area VI (6.4): Apply harm-reduction and motivational communication strategies',
      ],
    },
    openingLine:
      "Hey. Before I say anything, this doesn't go back to the athletic department or my track coach, right? I booked this appointment because my sleep has been trash and my 400-meter split times are slipping, not because I have a 'problem' or anything.",
    cueCards: [
      {
        category: 'Confidentiality Assurance + Autonomy',
        text: "I'm glad you asked first, Jordan. Everything we talk about here in health coaching is confidential and stays between us—nothing goes to your coach. You're in the driver's seat today, and my goal is to help you get your sleep and split times back where you want them.",
      },
      {
        category: 'Open-Ended Question (Sleep & Energy Pattern)',
        text: 'Tell me about what your sleep and energy levels have been looking like across a typical training week.',
      },
      {
        category: 'Elicit-Provide-Elicit (Alcohol & REM Recovery)',
        text: 'You mentioned using a few drinks on weekends to knock yourself out. Would it be cool if I shared how alcohol and afternoon pre-workout interact with deep muscle-recovery sleep?',
      },
      {
        category: 'Harm Reduction Goal Setting',
        text: 'Since hitting your 400-meter PR is your top priority, what experiment with your afternoon pre-workout or weekend pacing feels worth testing this week?',
      },
    ],
    simulationBrain: {
      defensiveTriggers: [
        'binge drinking',
        'alcoholic',
        'against team rules',
        'illegal',
        'underage',
        'stop drinking completely',
      ],
      defensiveResponses: [
        "Whoa, hold on. Everyone on campus goes out on Fridays after a brutal training week. I'm not an alcoholic, I just came in here for sleep tips.",
        "If this is going to turn into a disciplinary lecture about drinking, I'd rather just leave.",
      ],
      topicResponses: [
        {
          keywords: ['confidential', 'coach', 'between us', 'safe', 'private', 'driver'],
          affect: 'Visibly Relieved',
          rapportDelta: 16,
          response:
            "Okay, cool. Thank you. I was stressing about that. Honestly, my hamstrings feel like lead at 6 AM practice, and I'm lying awake staring at the ceiling until 1 AM most nights.",
        },
        {
          keywords: ['week', 'sleep', 'training', 'caffeine', 'pre-workout', 'drink', 'weekend', 'unwind'],
          affect: 'Open & Reflective',
          rapportDelta: 12,
          response:
            "Monday through Thursday I'm super locked in—6 AM track, classes, then I take a double scoop of pre-workout around 3:30 PM before weights, and I can't fall asleep at night. Then Friday and Saturday I go out with teammates, have maybe 6 or 7 drinks, pass out fast, but wake up at 9 AM feeling totally wrecked.",
        },
        {
          keywords: ['permission', 'cool if i shared', 'rem', 'recovery', 'muscle', 'half-life', 'how alcohol'],
          affect: 'Curious & Surprised',
          rapportDelta: 14,
          response:
            "Wait, seriously? I had no idea 3:30 PM caffeine is still in my bloodstream at midnight, or that alcohol blocks deep recovery hormone release even when you pass out fast. That actually explains why my Monday splits are always my slowest.",
        },
        {
          keywords: ['experiment', 'plan', 'goal', 'test', 'week', 'pacing', 'alternating', 'water', 'switch'],
          affect: 'Focused (Preparation Stage)',
          rapportDelta: 15,
          response:
            "For my conference meet in three weeks, I'll do anything to shave half a second off my 400. This week I can switch my 3:30 PM pre-workout to non-stimulant pump formula, and on Friday night I'll cap it at 3 drinks and alternate with water.",
        },
      ],
      fallbackOpenResponse:
        "Everything for me comes down to performing on the track. If something helps me recover faster and sleep through the night, I'm willing to listen.",
      fallbackClosedResponse:
        "Yeah, I guess so.",
    },
  },
  {
    id: 'heb-cardiac-kinesiophobia',
    courseCode: 'HEB 4232',
    courseTitle: 'Exercise Therapy, Physical Activity & Health',
    title: 'Overcoming Kinesiophobia Post-Cardiac Rehab',
    difficulty: 'Intermediate',
    durationTargetMinutes: 5,
    client: {
      name: 'Robert "Bob" Jenkins',
      age: 67,
      pronouns: 'he/him',
      role: 'Retired Generic U Facilities Supervisor',
      avatarInitials: 'RJ',
      avatarColor: '#914669',
      voiceProfile: {
        gender: 'male',
        pitch: 0.88,
        rate: 0.94,
      },
      ttmStage: 'Contemplation',
      initialRapport: 52,
      initialAffect: 'Anxious & Cautious',
    },
    clinicalDossier: {
      referralSource: 'University Medical Center Cardiac Rehabilitation Discharge Transition',
      chiefComplaint:
        'Cleared by cardiologist for 150 mins/week moderate aerobic activity after a mild myocardial infarction 14 weeks ago, but avoids walking outside out of fear of having another heart event alone.',
      vitalsAndBaseline: [
        'Resting HR: 64 bpm (on beta-blocker) | BP: 122/76 mmHg',
        'Cleared RPE Range: Borg 11–13 ("Light to Somewhat Hard" / Talk Test)',
        'Current Activity: <1,800 steps/day indoors only',
      ],
      psychosocialContext:
        'Loved walking closely monitored on the treadmill at the clinic where nurses watched his ECG. At home in his neighborhood, every time he feels his heart beat faster or breaks a sweat, he panics and sits down.',
      learningObjectives: [
        'Normalize and validate kinesiophobia (fear of movement/exertion after a cardiac event).',
        'Distinguish between normal physiological exercise responses and warning signs using the Talk Test.',
        'Explore environmental safety anchors (walking partner, flat shaded route, phone).',
        'Build self-efficacy through graded exposure (short 10-minute walks).',
      ],
      chesCompetencies: [
        'Area I (1.4): Identify factors that foster or hinder physical activity adherence',
        'Area VI (6.5): Build client self-efficacy through graded mastery experiences',
      ],
    },
    openingLine:
      "Afternoon. My cardiologist at the University Medical Center said I graduated from supervised rehab and sent me to you to keep moving. To tell you the truth, when I was hooked up to the monitors with the nurses watching, I did fine. But out on my own street? The second I feel my heart thumping a little harder, I get spooked and head right back inside.",
    cueCards: [
      {
        category: 'Normalizing Validation (Empathy)',
        text: 'What you are experiencing is so common after a heart event, Bob. Going from having nurses watching a monitor to being out on your own street is a big transition, and it makes complete sense that your body is on high alert.',
      },
      {
        category: 'Open-Ended Question (Exploring Confidence & Anchors)',
        text: 'What helped you feel safe when you were exercising at the clinic, and how might we bring a little of that reassurance to your walks at home?',
      },
      {
        category: 'Elicit-Provide-Elicit (Talk Test Gauge)',
        text: 'Would it be helpful if we went over a simple way called the Talk Test so you can tell the difference between a healthy workout heart rate and pushing too hard?',
      },
      {
        category: 'Graded Exposure SMART Goal',
        text: 'If we started with something that feels like an 8 out of 10 in confidence—maybe 10 minutes on a flat path with your wife or neighbor—what would that look like this week?',
      },
    ],
    simulationBrain: {
      defensiveTriggers: [
        'nothing to worry about',
        'just push through',
        '150 minutes right now',
        'irrational',
        'in your head',
      ],
      defensiveResponses: [
        "Well, it's easy to say 'don't worry about it' when you haven't been in the back of an ambulance.",
        "Jumping straight to 30 minutes by myself out in the heat feels like asking for trouble.",
      ],
      topicResponses: [
        {
          keywords: ['common', 'normal', 'makes sense', 'scary', 'transition', 'monitors', 'nurses', 'safe'],
          affect: 'Reassured',
          rapportDelta: 14,
          response:
            "I'm glad to hear I'm not the only one who feels that way. My wife thinks I'm just being stubborn, but when you've had a heart scare, every heartbeat feels loud.",
        },
        {
          keywords: ['talk test', 'gauge', 'difference', 'breathing', 'helpful', 'permission', 'how to tell'],
          affect: 'Engaged & Empowered',
          rapportDelta: 14,
          response:
            "That Talk Test idea actually makes a lot of sense—since my beta-blocker keeps my pulse numbers different anyway. Knowing that as long as I can speak a full sentence without gasping, my heart is in the safe zone gives me something concrete to check.",
        },
        {
          keywords: ['wife', 'neighbor', '10 minutes', 'ten minutes', 'flat', 'morning', 'plan', 'small', 'week'],
          affect: 'Confident (Action Stage)',
          rapportDelta: 15,
          response:
            "My wife Linda walks every morning at 7:30 AM before it gets warm. Doing just 10 minutes down to the cul-de-sac and back with her, while chatting to test my breathing, feels like a 9 out of 10 confidence for me. Let's start there.",
        },
      ],
      fallbackOpenResponse:
        "I worked on the Generic U campus for thirty years walking five miles a day. I miss being outside—I just need to trust my body again.",
      fallbackClosedResponse:
        "Yes, that's right.",
    },
  },
];

// Alias for backward compatibility in imports
export const UF_HEB_SCENARIOS = HHP_SCENARIOS;
