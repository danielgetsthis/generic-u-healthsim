import { classifyStudentUtterance, evaluateSession } from '../public/evaluator.js';
import { HHP_SCENARIOS } from '../public/scenarios.js';
import { JevSystemOneEngine } from '../public/jev-engine.js';

/**
 * Ground-truth benchmark dataset of realistic spoken student utterances
 * (including unpunctuated Web Speech API transcripts & MITI 4.2 edge cases).
 */
const UTTERANCE_BENCHMARK = [
  // 1. Spoken Closed Questions WITHOUT question marks (typical Web Speech API output)
  {
    text: 'do you vape every single day',
    expectedPrimary: 'closed-question',
    description: 'Unpunctuated STT closed question ("do you...")',
  },
  {
    text: 'are you feeling stressed about your midterms',
    expectedPrimary: 'closed-question',
    description: 'Unpunctuated STT closed question ("are you...")',
  },
  {
    text: 'have you ever tried to quit before',
    expectedPrimary: 'closed-question',
    description: 'Unpunctuated STT closed question ("have you...")',
  },
  {
    text: 'did the doctor tell you to come here',
    expectedPrimary: 'closed-question',
    description: 'Unpunctuated STT closed question ("did the...")',
  },
  {
    text: 'can you just leave the vape in your car',
    expectedPrimary: 'closed-question',
    description: 'Unpunctuated STT closed question ("can you...")',
  },
  {
    text: 'is it hard to focus without nicotine',
    expectedPrimary: 'closed-question',
    description: 'Unpunctuated STT closed question ("is it...")',
  },

  // 2. Factual / Demographic / Quantity "How/What" Questions (Closed in MITI 4.2!)
  {
    text: 'how old are you',
    expectedPrimary: 'closed-question',
    description: 'Demographic fact check ("how old are you") — Closed in MITI 4.2',
  },
  {
    text: 'what is your age',
    expectedPrimary: 'closed-question',
    description: 'Demographic fact check ("what is your age") — Closed in MITI 4.2',
  },
  {
    text: 'how many pods do you go through in a week',
    expectedPrimary: 'closed-question',
    description: 'Quantity fact check ("how many...") — Closed in MITI 4.2',
  },
  {
    text: 'how long have you been vaping',
    expectedPrimary: 'closed-question',
    description: 'Duration fact check ("how long...") — Closed in MITI 4.2',
  },
  {
    text: 'what time do you usually go to sleep',
    expectedPrimary: 'closed-question',
    description: 'Specific time fact check ("what time...") — Closed in MITI 4.2',
  },
  {
    text: 'do you know what nicotine does to your lungs?',
    expectedPrimary: 'closed-question',
    description: 'Closed question containing embedded "what" ("do you know what...")',
  },

  // 3. True MITI 4.2 Open-Ended Questions (with and without STT punctuation)
  {
    text: 'what are some of the things you like about vaping and what bothers you about it',
    expectedPrimary: 'open-question',
    description: 'Unpunctuated STT open exploration of ambivalence',
  },
  {
    text: 'how does vaping fit into your typical study routine during midterms?',
    expectedPrimary: 'open-question',
    description: 'True open-ended "how" process question',
  },
  {
    text: 'walk me through what a typical school day looks like for you',
    expectedPrimary: 'open-question',
    description: 'Imperative open-ended narrative prompt ("walk me through...")',
  },
  {
    text: 'tell me more about what happened when you tried quitting over Thanksgiving',
    expectedPrimary: 'open-question',
    description: 'Open narrative invitation ("tell me more about...")',
  },

  // 4. Empathic Reflections (Simple & Complex)
  {
    text: 'it sounds like you are under a ton of pressure right now and vaping feels like your only relief',
    expectedPrimary: 'reflection',
    description: 'Complex reflection of ambivalence',
  },
  {
    text: 'you are worried that if you stop vaping during midterms your grades might slip',
    expectedPrimary: 'reflection',
    description: 'Direct empathic reflection without "it sounds like" stem',
  },

  // 5. Righting Reflex / Unsolicited Advice
  {
    text: 'you need to stop vaping right now before your bronchitis gets worse',
    expectedPrimary: 'righting-reflex',
    description: 'Direct unsolicited lecturing ("you need to stop...")',
  },
  {
    text: 'you should throw away your pods tonight and chew gum instead',
    expectedPrimary: 'righting-reflex',
    description: 'Prescriptive advice without permission ("you should...")',
  },

  // 6. Elicit-Provide-Elicit (Permission Seeking)
  {
    text: 'would it be okay if I shared a few strategies other Generic U students use during finals',
    expectedPrimary: 'elicit-permission',
    description: 'Autonomy-supportive permission check',
  },
];

/**
 * Simulated Full Multi-Turn Conversations (Personas) to test session-level rubric grading
 */
const SIMULATED_PERSONA_SESSIONS = [
  {
    name: 'Persona A: "The Closed-Question Interrogator" (Only asks unpunctuated STT closed & demographic questions)',
    expectedOpenPctMax: 0,
    expectedMaxTotalScore: 55,
    turns: [
      'how old are you',
      'what is your major at Generic U',
      'do you vape every day',
      'how many pods do you use a week',
      'did your doctor tell you to quit',
      'are you going to quit this week',
    ],
  },
  {
    name: 'Persona B: "The Authoritarian Lecturer" (Triggered Righting Reflex & Closed Questions)',
    expectedOpenPctMax: 15,
    expectedMaxTotalScore: 45,
    turns: [
      'you need to stop vaping immediately because you just had bronchitis',
      'do you know what nicotine does to your blood pressure',
      'you have to throw the vape away tonight',
      'you should just drink water instead of vaping',
    ],
  },
  {
    name: 'Persona C: "Mastery MI Health Coach" (OARS + Elicit-Provide-Elicit + SMART Goal)',
    expectedOpenPctMin: 75,
    expectedMinTotalScore: 85,
    turns: [
      'thank you for coming in and being so honest with me today Marcus',
      'it sounds like you are under huge pressure with midterms and vaping has been your go-to stress relief even though this cough has you worried',
      'what are the main things vaping does for you during late-night coding and what parts are starting to bother you',
      'would it be okay if we looked at a couple ways other students handle cravings without quitting cold turkey',
      'on a scale from 1 to 10 what is one small experiment this week that feels realistic for you',
    ],
  },
];

export async function runBenchmark() {
  console.log('================================================================');
  console.log('GENERIC U HEALTHSIM — VERSION A vs VERSION B (JEV 1.13) BENCHMARK');
  console.log('================================================================\n');

  const jevEngine = new JevSystemOneEngine();
  let passedUtterances = 0;
  const failures = [];

  for (const item of UTTERANCE_BENCHMARK) {
    const res = classifyStudentUtterance(item.text);
    const tagIds = res.tags.map((t) => t.id);
    const matched = tagIds.includes(item.expectedPrimary);
    // Also ensure closed-question expectations are NOT simultaneously tagged as open-question
    const conflict =
      item.expectedPrimary === 'closed-question' &&
      tagIds.includes('open-question');

    if (matched && !conflict) {
      passedUtterances++;
    } else {
      failures.push({
        text: item.text,
        expected: item.expectedPrimary,
        actual: tagIds.join(', '),
        description: item.description,
      });
    }
  }

  const accuracyPct = Math.round(
    (passedUtterances / UTTERANCE_BENCHMARK.length) * 100
  );
  console.log(
    `1. Utterance Micro-Skill Classification Accuracy: ${passedUtterances}/${UTTERANCE_BENCHMARK.length} (${accuracyPct}%)`
  );

  if (failures.length > 0) {
    console.log('\n   Misclassified Utterances:');
    for (const f of failures) {
      console.log(`   ❌ "${f.text}"`);
      console.log(
        `      Expected: [${f.expected}] | Got: [${f.actual}] (${f.description})`
      );
    }
  }

  console.log('\n----------------------------------------------------------------');
  console.log('2. Simulated Full Session Persona Evaluations (Version A vs Version B Jev):');
  console.log('----------------------------------------------------------------');

  const scenario = HHP_SCENARIOS[0];
  let personaPasses = 0;

  for (const persona of SIMULATED_PERSONA_SESSIONS) {
    const transcript = [{ speaker: 'client', text: scenario.openingLine }];
    const turnJevHistory = [];
    for (const studentText of persona.turns) {
      const jevTurn = await jevEngine.evaluateTurn({
        scenario,
        transcript,
        studentText,
        aiConfig: {},
      });
      turnJevHistory.push(jevTurn);
      transcript.push({ speaker: 'student', text: studentText });
      transcript.push({
        speaker: 'client',
        text: 'Yeah, I hear you. It is just tough with my schedule right now.',
      });
    }

    const report = evaluateSession({
      scenario,
      transcript,
      durationSeconds: 180,
      finalRapport: persona.expectedMinTotalScore ? 80 : 40,
    });

    const jevReport = await jevEngine.evaluateFullSessionWithJev({
      scenario,
      transcript,
      durationSeconds: 180,
      finalRapport: persona.expectedMinTotalScore ? 80 : 40,
      turnJevHistory,
      aiConfig: {},
    });

    const m = report.metrics;
    let passed = true;
    const reasons = [];

    if (
      typeof persona.expectedOpenPctMax === 'number' &&
      m.openQuestionPct > persona.expectedOpenPctMax
    ) {
      passed = false;
      reasons.push(
        `Open Question % was ${m.openQuestionPct}% (expected <= ${persona.expectedOpenPctMax}%)`
      );
    }
    if (
      typeof persona.expectedOpenPctMin === 'number' &&
      m.openQuestionPct < persona.expectedOpenPctMin
    ) {
      passed = false;
      reasons.push(
        `Open Question % was ${m.openQuestionPct}% (expected >= ${persona.expectedOpenPctMin}%)`
      );
    }
    if (
      typeof persona.expectedMaxTotalScore === 'number' &&
      report.totalScore > persona.expectedMaxTotalScore
    ) {
      passed = false;
      reasons.push(
        `Total Score was ${report.totalScore}/100 (expected <= ${persona.expectedMaxTotalScore})`
      );
    }
    if (
      typeof persona.expectedMinTotalScore === 'number' &&
      report.totalScore < persona.expectedMinTotalScore
    ) {
      passed = false;
      reasons.push(
        `Total Score was ${report.totalScore}/100 (expected >= ${persona.expectedMinTotalScore})`
      );
    }

    if (passed) personaPasses++;

    console.log(`\n${passed ? '✅' : '❌'} ${persona.name}`);
    console.log(
      `   [Version A Standard] Score: ${report.totalScore}/100 (${report.proficiencyLevel}) | Open Q%: ${m.openQuestionPct}% (${m.openQuestions} Open / ${m.closedQuestions} Closed) | Reflections: ${m.reflections}`
    );
    console.log(
      `   [Version B Jev 1.13] Score: ${jevReport.totalScore}/100 (${jevReport.proficiencyLevel}) | Avg Conf: ${Math.round(jevReport.jevSummary.avgConfidence * 100)}% | noul(OpenQ>=50%): ${Math.round(jevReport.jevSummary.sessionNouls.passed_miti_open_question_threshold.noul * 100)}% | noul(AvoidedQATrap): ${Math.round(jevReport.jevSummary.sessionNouls.avoided_question_answer_trap.noul * 100)}%`
    );
    if (!passed) {
      console.log(`   FAILURE REASONS: ${reasons.join(' | ')}`);
    }
  }

  console.log('\n================================================================');
  console.log(
    `SUMMARY: Utterances ${passedUtterances}/${UTTERANCE_BENCHMARK.length} (${accuracyPct}%) | Personas ${personaPasses}/${SIMULATED_PERSONA_SESSIONS.length}`
  );
  console.log('================================================================');
}

runBenchmark();
