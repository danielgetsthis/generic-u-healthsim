const FILLER_PATTERNS = [
  /\bum+\b/gi,
  /\buh+\b/gi,
  /\berm\b/gi,
  /\byou know\b/gi,
  /\bbasically\b/gi,
  /\bliterally\b/gi,
  /\bi mean\b/gi,
  /\bsort of\b/gi,
  /\bkind of\b/gi,
];

/**
 * Classifies a spoken student utterance according to MITI 4.2 (Motivational Interviewing
 * Treatment Integrity) & Generic U HHP Health Coaching micro-skill rules.
 * Designed to work reliably on both punctuated text and raw unpunctuated Web Speech API transcripts.
 */
export function classifyStudentUtterance(text) {
  const clean = text.trim();
  const lower = clean.toLowerCase();
  const tags = [];
  let coachingNote = '';
  let suggestedRewrite = null;

  // 1. Check for Elicit-Provide-Elicit (Asking Permission) FIRST
  const hasPermission =
    /\b(would it be okay|would it be alright|would it be cool|would it be helpful|may i share|can i share|alright if we|okay if we|cool if i shared|helpful if we|permission|open to hearing)\b/i.test(
      lower
    );

  if (hasPermission) {
    tags.push({
      id: 'elicit-permission',
      label: 'Elicit-Provide-Elicit',
      tone: 'success',
    });
    coachingNote =
      'Excellent autonomy support! Asking permission before sharing health education honors the client as the expert on their own life.';
  }

  // 2. Check for Righting Reflex / Unsolicited lecturing
  const rightingTriggers = [
    /\byou need to\b/i,
    /\byou have to\b/i,
    /\byou must\b/i,
    /\byou (really )?should\b/i,
    /\bjust stop\b/i,
    /\bdon't worry about\b/i,
    /\byou're going to ruin\b/i,
    /\bthrow (it|the vape|your pods) away\b/i,
  ];

  if (rightingTriggers.some((rx) => rx.test(clean)) && !hasPermission) {
    tags.push({
      id: 'righting-reflex',
      label: 'Righting Reflex Warning',
      tone: 'danger',
    });
    coachingNote =
      'Prescriptive directive ("you need to / you should") delivered without eliciting permission first. In Motivational Interviewing, this triggers psychological reactance and client sustain talk.';
    suggestedRewrite =
      '"Would it be okay if we explored a few options that other clients have found manageable in your situation?"';
  }

  // 3. Check for Scaling / SMART Goal / Change Planning
  const isScalingOrGoal =
    /\b(scale from 1 to 10|1 to 10|one to ten|small step|small experiment|next 7 days|this week|what experiment|feel confident trying|feels doable|easiest adjustment)\b/i.test(
      lower
    );
  if (isScalingOrGoal) {
    tags.push({
      id: 'smart-goal',
      label: 'Stage-Matched Goal / Scaling',
      tone: 'success',
    });
    if (!coachingNote) {
      coachingNote =
        'Great use of scaling or collaborative SMART experiment framing to transition from Contemplation to Preparation.';
    }
  }

  // 4. Question Detection & MITI 4.2 Open vs. Closed Classification
  // Note: Browser SpeechRecognition often omits '?', so we detect interrogative syntax directly.
  const startsWithClosedStem =
    /^(do|does|did|are|is|was|were|have|has|had|can|could|will|would|should|don't|doesn't|didn't|aren't|isn't|haven't|can't|wouldn't)\s+(you|your|it|that|there|the|this|he|she|they|we)\b/i.test(
      clean
    );

  // MITI 4.2 Rule: Questions starting with How/What/When/Where/Who that seek a short fact, number, or demographic
  // (e.g., "how old are you", "how many pods", "how long", "what is your name/age/major", "what time") are CLOSED questions!
  const isFactOrQuantityClosedQuestion =
    /^(how\s+(old|many|much|long|often|far|tall)|what\s+(is|are|was)\s+your\s+(name|age|major|job|occupation|grade|year|weight|blood pressure|a1c)|what\s+(time|day|year|grade|brand|flavor)|when\s+(did|do|was|is)|where\s+(do|did|is|are)|who\s+(told|referred|is)|which\s+\w+)\b/i.test(
      clean
    );

  // True MITI 4.2 Open-Ended Question stems (inviting narrative exploration, feelings, meaning, or process)
  const startsWithOpenStem =
    /^(what\b|how\b|tell me\b|walk me through\b|describe\b|in what ways\b|help me understand\b)/i.test(
      clean
    ) && !isFactOrQuantityClosedQuestion;

  // Embedded open question after a brief conversational lead-in (e.g. "on a scale from 1 to 10, what...", "looking at your day, what...")
  const hasEmbeddedOpenStem =
    /\b(what are some|what are the|what bothers you|what matters most|what would it look like|what feels like|what is one small|how does that fit|how might we|how important is it|walk me through|tell me about|tell me more)\b/i.test(
      lower
    ) && !startsWithClosedStem;

  if (!hasPermission) {
    if (startsWithClosedStem || isFactOrQuantityClosedQuestion) {
      tags.push({
        id: 'closed-question',
        label: isFactOrQuantityClosedQuestion
          ? 'Closed Question (Fact / Quantity)'
          : 'Closed Question (Yes/No)',
        tone: 'warning',
      });
      if (!coachingNote) {
        coachingNote = isFactOrQuantityClosedQuestion
          ? 'In MITI 4.2 coding, factual/demographic/quantity inquiries ("How old...", "How many...", "What is your...") are coded as Closed Questions because they elicit a one-word or short factual answer.'
          : 'Closed-ended question that can be answered with a brief "yes" or "no". Rephrase with "How" or "What" to invite deeper client exploration.';
        suggestedRewrite =
          'Try an open-ended exploration: "What has your experience been with..." or "How does that affect your day-to-day routine?"';
      }
    } else if (startsWithOpenStem || hasEmbeddedOpenStem) {
      tags.push({
        id: 'open-question',
        label: 'Open-Ended Question',
        tone: 'primary',
      });
      if (!coachingNote) {
        coachingNote =
          'Well-phrased open question that invites the client to elaborate on their routines, values, or ambivalence.';
      }
    } else if (clean.includes('?')) {
      // Any remaining punctuated question without an open stem is a closed question
      tags.push({
        id: 'closed-question',
        label: 'Closed Question',
        tone: 'warning',
      });
      if (!coachingNote) {
        coachingNote =
          'Closed question detected. Aim for open-ended questions starting with "How", "What", or "Tell me about...".';
      }
    }
  }

  // 5. Check for Empathy / Simple & Complex Reflections (only if not a question or righting reflex)
  const isQuestionTagged = tags.some(
    (t) => t.id === 'open-question' || t.id === 'closed-question'
  );
  const reflectionPatterns = [
    /\bit sounds like\b/i,
    /\byou('re| are) feeling\b/i,
    /\byou('re| are) worried\b/i,
    /\byou('re| are) torn\b/i,
    /\byou('re| are) under\b/i,
    /\byou feel\b/i,
    /\bmakes (complete )?sense\b/i,
    /\bon one hand\b/i,
    /\bpart of you\b/i,
    /\bso for you\b/i,
    /\bhearing that\b/i,
    /\bwhat you('re| are) experiencing\b/i,
    /\bleft a deep impression\b/i,
    /\beven though\b/i,
  ];
  if (
    !isQuestionTagged &&
    !tags.some((t) => t.id === 'righting-reflex') &&
    reflectionPatterns.some((rx) => rx.test(clean))
  ) {
    tags.push({
      id: 'reflection',
      label: 'Empathic Reflection',
      tone: 'success',
    });
    if (!coachingNote) {
      coachingNote =
        'Strong reflective listening statement that validates client ambivalence and builds therapeutic rapport.';
    }
  }

  // 6. Check for Affirmations
  const affirmationPatterns = [
    /\bthank you for\b/i,
    /\bi appreciate\b/i,
    /\bglad you\b/i,
    /\bshows (real )?commitment\b/i,
    /\bmeaningful part\b/i,
    /\bin the driver's seat\b/i,
    /\bso common\b/i,
    /\btakes courage\b/i,
  ];
  if (affirmationPatterns.some((rx) => rx.test(clean))) {
    tags.push({
      id: 'affirmation',
      label: 'Affirmation',
      tone: 'primary',
    });
    if (!coachingNote) {
      coachingNote =
        'Effective affirmation highlighting the client’s strengths, autonomy, or effort.';
    }
  }

  if (tags.length === 0) {
    tags.push({
      id: 'general-statement',
      label: 'General Facilitation',
      tone: 'neutral',
    });
    coachingNote =
      'Conversational facilitation turn. Look for opportunities to turn general statements into complex reflections or open-ended questions.';
  }

  return { tags, coachingNote, suggestedRewrite };
}

export function evaluateSession({
  scenario,
  transcript,
  durationSeconds,
  finalRapport,
}) {
  const studentTurns = transcript.filter((t) => t.speaker === 'student');
  const clientTurns = transcript.filter((t) => t.speaker === 'client');

  const studentWords = studentTurns
    .map((t) => t.text.trim().split(/\s+/).filter(Boolean).length)
    .reduce((a, b) => a + b, 0);
  const clientWords = clientTurns
    .map((t) => t.text.trim().split(/\s+/).filter(Boolean).length)
    .reduce((a, b) => a + b, 0);
  const totalWords = Math.max(1, studentWords + clientWords);

  const studentTalkRatio = Math.round((studentWords / totalWords) * 100);
  const estimatedStudentSpeakingMinutes = Math.max(
    0.25,
    (durationSeconds * (studentTalkRatio / 100)) / 60
  );
  const speakingWpm =
    studentWords > 0
      ? Math.min(
          195,
          Math.max(95, Math.round(studentWords / estimatedStudentSpeakingMinutes))
        )
      : 0;

  // Count filler words across student turns
  let fillerCount = 0;
  const fullStudentText = studentTurns.map((t) => t.text).join(' ');
  for (const pattern of FILLER_PATTERNS) {
    const matches = fullStudentText.match(pattern);
    if (matches) fillerCount += matches.length;
  }

  // Classify each turn
  let openQuestions = 0;
  let closedQuestions = 0;
  let reflections = 0;
  let affirmations = 0;
  let elicitPermissions = 0;
  let rightingReflexCount = 0;
  let smartGoalCount = 0;

  const annotatedTranscript = transcript.map((turn) => {
    if (turn.speaker !== 'student') {
      return { ...turn, analysis: null };
    }
    const analysis = classifyStudentUtterance(turn.text);
    for (const tag of analysis.tags) {
      if (tag.id === 'open-question') openQuestions++;
      if (tag.id === 'closed-question') closedQuestions++;
      if (tag.id === 'reflection') reflections++;
      if (tag.id === 'affirmation') affirmations++;
      if (tag.id === 'elicit-permission') elicitPermissions++;
      if (tag.id === 'righting-reflex') rightingReflexCount++;
      if (tag.id === 'smart-goal') smartGoalCount++;
    }
    return { ...turn, analysis };
  });

  const totalQuestions = openQuestions + closedQuestions;
  const openQuestionPct =
    totalQuestions > 0 ? Math.round((openQuestions / totalQuestions) * 100) : 0;

  // Compute 5 Generic U HHP Rubric Criterion Scores (Strictly calibrated to MITI 4.2)
  // 1. OARS Micro-Skills (max 25)
  // Penalizes heavy reliance on closed questions without reflections
  const closedPenalty = Math.max(0, (closedQuestions - openQuestions) * 1.5);
  const oarsRaw =
    Math.min(11, openQuestions * 5) +
    Math.min(9, reflections * 5) +
    Math.min(5, affirmations * 3) -
    closedPenalty;
  const oarsScore =
    studentTurns.length === 0
      ? 0
      : Math.max(2, Math.min(25, Math.round(oarsRaw + 2)));

  // 2. Empathy, Validation & Cultural Humility (max 25)
  const rapportGain = finalRapport - scenario.client.initialRapport;
  const empathyRaw =
    10 +
    Math.min(10, reflections * 4.5 + affirmations * 3) +
    Math.max(-5, Math.min(5, Math.round(rapportGain / 4))) -
    rightingReflexCount * 4 -
    (closedQuestions >= 3 && reflections === 0 ? 4 : 0);
  const empathyScore =
    studentTurns.length === 0
      ? 0
      : Math.max(3, Math.min(25, Math.round(empathyRaw)));

  // 3. Resisting the Righting Reflex & Autonomy Support (max 20)
  const autonomyRaw =
    13 +
    elicitPermissions * 5 -
    rightingReflexCount * 5 -
    (closedQuestions >= 4 && elicitPermissions === 0 ? 3 : 0);
  const autonomyScore =
    studentTurns.length === 0
      ? 0
      : Math.max(2, Math.min(20, Math.round(autonomyRaw)));

  // 4. Stage-Matched Action Planning / TTM Strategy (max 15)
  const planningRaw =
    5 + Math.min(10, smartGoalCount * 6 + (finalRapport >= 70 ? 4 : 0));
  const planningScore =
    studentTurns.length === 0
      ? 0
      : Math.max(2, Math.min(15, Math.round(planningRaw)));

  // 5. Vocal Delivery, Pacing & Active Listening (max 15)
  const idealRatioPenalty =
    studentTalkRatio > 60 ? Math.round((studentTalkRatio - 60) / 5) : 0;
  const fillerPenalty = Math.min(4, Math.floor(fillerCount / 2));
  const interrogationPenalty =
    closedQuestions >= 4 && reflections === 0 ? 3 : 0;
  const deliveryRaw =
    14 - idealRatioPenalty - fillerPenalty - interrogationPenalty;
  const deliveryScore =
    studentTurns.length === 0 ? 0 : Math.max(4, Math.min(15, deliveryRaw));

  const totalScore =
    oarsScore + empathyScore + autonomyScore + planningScore + deliveryScore;

  let proficiencyLevel = 'Developing Readiness (Below MITI Threshold)';
  let proficiencyBadgeTone = 'warning';
  if (totalScore >= 85) {
    proficiencyLevel = 'Advanced Clinical Mastery (MITI Competency)';
    proficiencyBadgeTone = 'success';
  } else if (totalScore >= 70) {
    proficiencyLevel = 'Proficient Health Coach (MITI Beginning Proficiency)';
    proficiencyBadgeTone = 'primary';
  }

  const stageShift =
    finalRapport >= 75
      ? `${scenario.client.ttmStage} → Preparation (Ready for Action Experiment)`
      : finalRapport >= 55
      ? `${scenario.client.ttmStage} → Engaged Contemplation`
      : `${scenario.client.ttmStage} (Sustained Ambivalence)`;

  const criteria = [
    {
      id: 'oars',
      name: 'OARS Micro-Skills Application',
      chesCode: 'NCHEC Area VI (6.5) / MITI 4.2 Technical Global',
      score: oarsScore,
      maxScore: 25,
      summary:
        openQuestionPct >= 50 && reflections >= 1
          ? `Strong balance of Open-Ended Questions (${openQuestions} Open vs. ${closedQuestions} Closed; ${openQuestionPct}% Open) and Empathic Reflections (${reflections}).`
          : `Recorded ${openQuestions} open question(s), ${closedQuestions} closed question(s) (${openQuestionPct}% open ratio), and ${reflections} reflection(s). MITI 4.2 competency requires ≥50% open questions and at least a 1:1 reflection-to-question ratio.`,
    },
    {
      id: 'empathy',
      name: 'Empathy, Validation & Cultural Humility',
      chesCode: 'NCHEC Area II (2.1) / MITI Relational Global',
      score: empathyScore,
      maxScore: 25,
      summary:
        rapportGain >= 15
          ? `Client rapport increased by +${rapportGain} points (to ${finalRapport}/100). You validated the client's lived context and reduced defensiveness.`
          : `Client rapport shifted by ${
              rapportGain >= 0 ? '+' : ''
            }${rapportGain} points (ending at ${finalRapport}/100). Avoid rapid-fire questioning (the "Question-Answer Trap") and reflect the client's feelings before asking another question.`,
    },
    {
      id: 'autonomy',
      name: 'Resisting the "Righting Reflex" (Elicit-Provide-Elicit)',
      chesCode: 'NCHEC Area VI (6.1) / Autonomy Support',
      score: autonomyScore,
      maxScore: 20,
      summary:
        rightingReflexCount === 0
          ? `Zero unsolicited lecturing detected${
              elicitPermissions > 0
                ? `, and you explicitly asked permission (${elicitPermissions}x) before offering health advice.`
                : '. Try adding an explicit permission check ("Would it be okay if I shared...") before providing clinical tips.'
            }`
          : `Detected ${rightingReflexCount} instance(s) of the "Righting Reflex" (prescribing/lecturing without permission). Always use Elicit-Provide-Elicit before giving advice.`,
    },
    {
      id: 'ttm-planning',
      name: 'Transtheoretical Model (TTM) Stage-Matched Planning',
      chesCode: 'NCHEC Area I (1.2) / Behavioral Action Planning',
      score: planningScore,
      maxScore: 15,
      summary:
        smartGoalCount > 0
          ? `Successfully guided the client toward a stage-matched behavioral experiment or scaling question (${smartGoalCount} planning turn(s)).`
          : `Session ended before establishing a concrete, client-owned SMART experiment or readiness scaling check (1–10 ruler).`,
    },
    {
      id: 'vocal-delivery',
      name: 'Vocal Pacing, Talk-to-Listen Ratio & Active Listening',
      chesCode: 'Clinical Communication Acoustics',
      score: deliveryScore,
      maxScore: 15,
      summary: `Counselor talk time was ${studentTalkRatio}% (target: 35%–50%), speaking pace averaged ~${speakingWpm} WPM, with ${fillerCount} vocal filler(s) detected.`,
    },
  ];

  const strengths = [];
  const improvements = [];

  if (openQuestions >= 2 && openQuestionPct >= 50) {
    strengths.push(
      `Asked ${openQuestions} open-ended questions (${openQuestionPct}% of all questions), inviting the client to do the cognitive work of behavior change.`
    );
  } else {
    improvements.push(
      `Avoid the Question-Answer Trap (${closedQuestions} closed question(s) vs. ${openQuestions} open): Factual/demographic questions ("How old...", "How many...") and Yes/No questions ("Do you...", "Are you...") put the client in a passive role. Rephrase with "What matters most to you about..." or "How does that fit into your day?"`
    );
  }

  if (reflections >= 1 || affirmations >= 1) {
    strengths.push(
      `Used ${reflections} empathic reflection(s) and ${affirmations} affirmation(s) to lower client resistance and build psychological safety.`
    );
  } else {
    improvements.push(
      'Incorporate Complex Reflections: After the client speaks, reflect back both sides of their ambivalence ("It sounds like on one hand..., and on the other hand...") instead of immediately asking another question.'
    );
  }

  if (rightingReflexCount === 0 && elicitPermissions >= 1) {
    strengths.push(
      'Exemplary use of Elicit-Provide-Elicit—you asked permission before sharing clinical health information.'
    );
  } else if (rightingReflexCount > 0) {
    improvements.push(
      'Avoid the "Righting Reflex": Replace phrases like "You need to..." with permission-seeking prompts such as "Would it be alright if we looked at a few strategies together?"'
    );
  }

  if (smartGoalCount === 0) {
    improvements.push(
      'Close with a Stage-Matched SMART Experiment: Use a 1-to-10 Readiness/Confidence Ruler and co-create one specific 7-day behavioral experiment.'
    );
  } else {
    strengths.push(
      'Co-created a realistic, stage-matched behavioral action step rather than prescribing an overwhelming overhaul.'
    );
  }

  if (strengths.length === 0) {
    strengths.push(
      'Completed the initial intake interaction and maintained vocal engagement with the client.'
    );
  }

  return {
    totalScore,
    proficiencyLevel,
    proficiencyBadgeTone,
    stageShift,
    criteria,
    metrics: {
      studentTurnsCount: studentTurns.length,
      clientTurnsCount: clientTurns.length,
      studentTalkRatio,
      clientTalkRatio: 100 - studentTalkRatio,
      speakingWpm,
      fillerCount,
      openQuestions,
      closedQuestions,
      openQuestionPct,
      reflections,
      affirmations,
      elicitPermissions,
      rightingReflexCount,
      smartGoalCount,
      initialRapport: scenario.client.initialRapport,
      finalRapport,
    },
    strengths,
    improvements,
    annotatedTranscript,
  };
}
