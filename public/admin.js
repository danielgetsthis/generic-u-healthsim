import { HHP_SCENARIOS } from './scenarios.js';
import { evaluateSession } from './evaluator.js';
import { JevSystemOneEngine } from './jev-engine.js';
import { VoiceSimulationEngine } from './voice-engine.js';

const STORAGE_KEYS = {
  AI_CONFIG: 'uf_hhp_voicesim_ai_config',
  CUSTOM_SCENARIOS: 'uf_hhp_voicesim_custom_scenarios',
  ARCH_MODE: 'uf_hhp_voicesim_arch_mode',
};

/**
 * Fallback utility for :user-invalid and :user-valid per modern-web-guidance
 * (validate-input-after-interaction)
 */
const UserInvalidFallback = (() => {
  const dirtyState = new WeakMap();

  const updateState = (input) => {
    const isValid = input.checkValidity();
    input.classList.toggle('user-invalid-fallback', !isValid);
    input.classList.toggle('user-valid-fallback', isValid);
    if (!isValid) {
      input.setAttribute('aria-invalid', 'true');
    } else {
      input.removeAttribute('aria-invalid');
    }
  };

  const handleEvent = (event) => {
    const input = event.target;
    if (event.type === 'reset') {
      const controls = input.elements || [];
      for (const control of controls) {
        dirtyState.delete(control);
        control.classList.remove('user-invalid-fallback');
        control.classList.remove('user-valid-fallback');
        control.removeAttribute('aria-invalid');
      }
      return;
    }
    if (!input.checkValidity) return;
    if (event.type === 'input' || event.type === 'change') {
      const state = dirtyState.get(input) || {
        hasInteracted: false,
        hasBlurred: false,
      };
      state.hasInteracted = true;
      dirtyState.set(input, state);
      if (state.hasBlurred) updateState(input);
    } else if (event.type === 'blur') {
      const state = dirtyState.get(input) || {
        hasInteracted: false,
        hasBlurred: false,
      };
      state.hasBlurred = true;
      dirtyState.set(input, state);
      if (state.hasInteracted) updateState(input);
    }
  };

  const init = (root = document) => {
    // Sync aria-invalid with native :user-invalid
    const syncAria = (el) => {
      if (el?.matches && CSS.supports('selector(:user-invalid)')) {
        el.setAttribute('aria-invalid', el.matches(':user-invalid') ? 'true' : 'false');
      }
    };
    root.addEventListener('blur', (e) => syncAria(e.target), true);
    root.addEventListener('input', (e) => {
      if (e.target?.hasAttribute?.('aria-invalid')) syncAria(e.target);
    });

    if (CSS.supports('selector(:user-invalid)')) return;
    root.addEventListener('blur', handleEvent, true);
    root.addEventListener('input', handleEvent);
    root.addEventListener('change', handleEvent);
    root.addEventListener('reset', handleEvent, true);
  };

  return { init };
})();

class HealthSimAdminApp {
  constructor() {
    this.config = {
      architectureMode: 'version-a',
      showAbBannerOnStudentReport: false,
      aiConfig: {
        provider: 'gemini',
        geminiModel: 'auto-fast',
        apiKey: '',
        typesafeApiKey: '',
        ttsRate: 1.0,
      },
    };
    this.customScenarios = [];
    this.sessions = [];
    this.stats = {};
    this.jevEngine = new JevSystemOneEngine();
    this.voiceEngine = new VoiceSimulationEngine();

    this.init();
  }

  async init() {
    UserInvalidFallback.init(document);
    this.setupDialogLightDismiss();
    this.bindEvents();
    await this.loadStateAndSessions();
  }

  setupDialogLightDismiss() {
    document.querySelectorAll('dialog[closedby="any"]').forEach((dialog) => {
      if (!('closedBy' in HTMLDialogElement.prototype)) {
        dialog.addEventListener('click', (event) => {
          if (event.target !== dialog) return;
          const rect = dialog.getBoundingClientRect();
          const inside =
            rect.top <= event.clientY &&
            event.clientY <= rect.top + rect.height &&
            rect.left <= event.clientX &&
            event.clientX <= rect.left + rect.width;
          if (!inside) dialog.close();
        });
      }
    });

    document
      .getElementById('closeInspectDialogBtn')
      ?.addEventListener('click', () => {
        document.getElementById('sessionInspectDialog')?.close();
      });
  }

  /**
   * Displays a persistent toast notification using popover="manual" per modern-web-guidance
   * (persistent-toast-notifications)
   */
  showToast(message) {
    const stack = document.getElementById('adminToastStack');
    if (!stack) return;

    const toastId = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const toast = document.createElement('div');
    toast.id = toastId;
    toast.className = 'toast-popover';
    toast.setAttribute('popover', 'manual');

    toast.innerHTML = `
      <span style="font-size:0.88rem; font-weight:600;">${message}</span>
      <button
        type="button"
        class="btn btn-outline btn-sm"
        popovertarget="${toastId}"
        popovertargetaction="hide"
        style="padding:0.2rem 0.55rem;"
      >
        Dismiss
      </button>
    `;

    stack.appendChild(toast);
    if (typeof toast.showPopover === 'function') {
      toast.showPopover();
    } else {
      toast.classList.add(':popover-open');
    }

    setTimeout(() => {
      if (toast.isConnected) {
        if (typeof toast.hidePopover === 'function') {
          try {
            toast.hidePopover();
          } catch {
            // ignore
          }
        }
        toast.remove();
      }
    }, 3500);
  }

  async loadStateAndSessions() {
    const stateRes = await fetch('/api/state');
    const stateData = await stateRes.json();

    // Auto-migrate browser localStorage keys into SQLite if SQLite has no API key yet
    try {
      const localSaved = JSON.parse(localStorage.getItem(STORAGE_KEYS.AI_CONFIG));
      if (localSaved?.apiKey && !stateData.config?.aiConfig?.apiKey) {
        const migRes = await fetch('/api/config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            architectureMode:
              localStorage.getItem(STORAGE_KEYS.ARCH_MODE) ||
              stateData.config?.architectureMode ||
              'version-a',
            aiConfig: localSaved,
          }),
        });
        if (migRes.ok) {
          const updated = await migRes.json();
          stateData.config = updated.config;
          this.showToast('Migrated your saved browser API key into SQLite database.');
        }
      }
    } catch {
      // ignore
    }

    this.config = stateData.config || this.config;
    this.customScenarios = stateData.customScenarios || [];
    this.stats = stateData.stats || {};

    const sessRes = await fetch('/api/sessions');
    const sessData = await sessRes.json();
    this.sessions = sessData.sessions || [];
    this.stats = sessData.stats || this.stats;

    this.populateSettingsForm();
    this.renderKpis();
    this.renderCustomScenariosList();
    this.renderSessionsTable();
  }

  populateSettingsForm() {
    const mode = this.config.architectureMode || 'version-a';
    document.querySelectorAll('.ab-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    document.getElementById('adminArchSelect').value = mode;
    document.getElementById('adminShowAbBannerToggle').checked = Boolean(
      this.config.showAbBannerOnStudentReport
    );

    const ai = this.config.aiConfig || {};
    document.getElementById('adminProviderSelect').value = ai.provider || 'gemini';
    document.getElementById('adminGeminiModelSelect').value =
      ai.geminiModel || 'auto-fast';
    document.getElementById('adminApiKeyInput').value = ai.apiKey || '';
    document.getElementById('adminTypesafeKeyInput').value =
      ai.typesafeApiKey || '';
    document.getElementById('adminTtsRateRange').value = ai.ttsRate || 1.0;
    document.getElementById('adminTtsRateVal').textContent = `${
      ai.ttsRate || 1.0
    }x`;
  }

  renderKpis() {
    const isJev = this.config.architectureMode === 'version-b';
    document.getElementById('kpiActiveArch').textContent = isJev
      ? 'Version B: Jev Hybrid ⚡'
      : 'Version A: Standard';

    const hasKey = Boolean(this.config.aiConfig?.apiKey?.trim());
    const hasTsKey = Boolean(this.config.aiConfig?.typesafeApiKey?.trim());
    document.getElementById('kpiActiveEngineSub').textContent = isJev
      ? hasTsKey
        ? 'typesafe/jev-1.13 (Live API) + Gemini Audio'
        : hasKey
        ? 'Jev System-1 (Gemini Hybrid) + Native Audio'
        : 'Jev Bayesian Kernel (Offline)'
      : hasKey
      ? `Gemini Native Audio (${this.config.aiConfig?.geminiModel || 'auto-fast'})`
      : 'Offline Demo Mode (No API Key)';

    document.getElementById('kpiSessionCount').textContent = String(
      this.stats.sessionCount ?? this.sessions.length
    );

    const avgA =
      this.stats.avgScoreVersionA !== null &&
      this.stats.avgScoreVersionA !== undefined
        ? `${this.stats.avgScoreVersionA}`
        : '—';
    const avgB =
      this.stats.avgScoreVersionB !== null &&
      this.stats.avgScoreVersionB !== undefined
        ? `${this.stats.avgScoreVersionB}`
        : '—';
    document.getElementById(
      'kpiAvgScoreComparison'
    ).textContent = `${avgA} vs ${avgB}`;

    document.getElementById('kpiCustomScenarioCount').textContent = String(
      this.customScenarios.length
    );
  }

  bindEvents() {
    // Top bar A/B switcher buttons
    document.querySelectorAll('.ab-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const mode = btn.dataset.mode;
        this.config.architectureMode = mode;
        document.getElementById('adminArchSelect').value = mode;
        await this.persistConfig(
          `Switched active architecture to ${
            mode === 'version-b' ? 'Version B (Jev Hybrid ⚡)' : 'Version A (Standard)'
          }.`
        );
      });
    });

    const rateInput = document.getElementById('adminTtsRateRange');
    rateInput?.addEventListener('input', () => {
      document.getElementById('adminTtsRateVal').textContent = `${rateInput.value}x`;
    });

    document.getElementById('adminApiKeyInput')?.addEventListener('input', (e) => {
      const val = e.target.value.trim();
      const prov = document.getElementById('adminProviderSelect');
      if (val.startsWith('AIza') && prov) prov.value = 'gemini';
      else if (val.startsWith('sk-') && prov) prov.value = 'openai';
    });

    // Save AI & Architecture config form
    document
      .getElementById('adminSettingsForm')
      ?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const enteredKey = document.getElementById('adminApiKeyInput').value.trim();
        let provider = document.getElementById('adminProviderSelect').value;
        if (enteredKey && provider === 'local') {
          provider = enteredKey.startsWith('sk-') ? 'openai' : 'gemini';
        }

        this.config = {
          architectureMode: document.getElementById('adminArchSelect').value,
          showAbBannerOnStudentReport: document.getElementById(
            'adminShowAbBannerToggle'
          ).checked,
          aiConfig: {
            provider,
            geminiModel: document.getElementById('adminGeminiModelSelect').value,
            apiKey: enteredKey,
            typesafeApiKey: document
              .getElementById('adminTypesafeKeyInput')
              .value.trim(),
            ttsRate: Number(document.getElementById('adminTtsRateRange').value) || 1.0,
          },
        };

        await this.persistConfig('Saved configuration to SQLite database.');
      });

    // Test Voice Output button
    document
      .getElementById('adminTestVoiceBtn')
      ?.addEventListener('click', () => {
        const scen = HHP_SCENARIOS[0];
        const tempAiConfig = {
          provider: document.getElementById('adminProviderSelect').value,
          geminiModel: document.getElementById('adminGeminiModelSelect').value,
          apiKey: document.getElementById('adminApiKeyInput').value.trim(),
          ttsRate: Number(document.getElementById('adminTtsRateRange').value) || 1.0,
        };
        this.voiceEngine.speakText(
          `Hello from the Generic U HealthSim Admin Console! Gemini Native Audio and voice synthesis are calibrated.`,
          { ...scen.client.voiceProfile, rate: tempAiConfig.ttsRate },
          tempAiConfig
        );
      });

    // Create Custom Scenario form
    document
      .getElementById('adminScenarioForm')
      ?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const courseCode = document.getElementById('admCourseCode').value.trim();
        const stage = document.getElementById('admStage').value;
        const title = document.getElementById('admTitle').value.trim();
        const rawClient = document.getElementById('admClientName').value.trim();
        const gender = document.getElementById('admVoiceGender').value;
        const complaint = document.getElementById('admComplaint').value.trim();
        const openingLine = document.getElementById('admOpeningLine').value.trim();

        const [clientName, agePart] = rawClient.split(',').map((s) => s.trim());
        const initials = (clientName || 'AC')
          .split(/\s+/)
          .map((w) => w[0])
          .join('')
          .toUpperCase()
          .slice(0, 2);

        const newScenario = {
          id: `custom-${Date.now()}`,
          courseCode: courseCode || 'HEB 4233',
          courseTitle: 'Custom Generic U HHP Scenario',
          title,
          difficulty: 'Custom',
          durationTargetMinutes: 5,
          client: {
            name: clientName || 'Alex Carter',
            age: Number(agePart) || 22,
            pronouns:
              gender === 'female'
                ? 'she/her'
                : gender === 'male'
                ? 'he/him'
                : 'they/them',
            role: 'Generic U Community Client',
            avatarInitials: initials || 'AC',
            avatarColor: '#FF385C',
            voiceProfile: { gender, pitch: 1.0, rate: 1.0 },
            ttmStage: stage,
            initialRapport: 48,
            initialAffect: 'Ambivalent & Curious',
          },
          clinicalDossier: {
            referralSource: 'Generic U HHP Faculty Custom Scenario',
            chiefComplaint: complaint,
            vitalsAndBaseline: [`Stage of Change: ${stage}`, 'Modality: Voice-Only MI'],
            psychosocialContext: complaint,
            learningObjectives: [
              'Apply OARS micro-skills (Open questions, Affirmations, Reflections, Summaries).',
              'Use Elicit-Provide-Elicit before sharing health advice.',
              'Co-design a stage-matched SMART behavioral experiment.',
            ],
            chesCompetencies: [
              'Area I (1.2): Assess health behaviors and readiness to change',
              'Area VI (6.5): Deliver health coaching using Motivational Interviewing',
            ],
          },
          openingLine,
          cueCards: [
            {
              category: 'Empathic Reflection',
              text: "It sounds like you've been juggling a lot right now, and part of you wants things to feel more manageable even though making a change feels tough.",
            },
            {
              category: 'Open-Ended Inquiry',
              text: 'What does a typical day look like for you around this habit, and what matters most to you about making a shift?',
            },
            {
              category: 'Elicit-Provide-Elicit',
              text: 'Would it be okay if we explored one or two low-pressure strategies that might fit into your weekly routine?',
            },
            {
              category: 'SMART Experiment',
              text: 'On a scale from 1 to 10, what is one small step this week that feels like at least an 8 in confidence for you?',
            },
          ],
          simulationBrain: {
            defensiveTriggers: ['you need to', 'you must', 'just stop'],
            defensiveResponses: [
              "When people tell me what I 'have to' do, it honestly makes me want to shut down. I'm already stressed enough.",
            ],
            topicResponses: [
              {
                keywords: ['typical day', 'sounds like', 'feeling', 'stress', 'routine', 'what'],
                affect: 'Opening Up',
                rapportDelta: 12,
                response:
                  "Thanks for actually listening. Most days I start off with good intentions, but by the evening I'm drained and fall right back into the old habit.",
              },
              {
                keywords: ['okay if', 'permission', 'strategies', 'small step', 'scale', 'week', 'experiment'],
                affect: 'Collaborative (Preparation)',
                rapportDelta: 15,
                response:
                  "Yeah, I'd be open to testing one small change over the next seven days as long as I don't have to be perfect right away.",
              },
            ],
            fallbackOpenResponse:
              "That's a really good question. I think if I can find something realistic for my schedule, I'm willing to give it a shot.",
            fallbackClosedResponse: 'Yeah, pretty much.',
          },
        };

        const res = await fetch('/api/scenarios', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newScenario),
        });
        if (res.ok) {
          const data = await res.json();
          this.customScenarios = data.customScenarios || [];
          this.renderCustomScenariosList();
          this.renderKpis();
          e.target.reset();
          this.showToast(`Saved "${newScenario.title}" to SQLite custom_scenarios.`);
        }
      });

    // 1-Click Simulated Persona Buttons
    document.querySelectorAll('[data-sim-persona]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.runSimulatedPersonaSession(btn.dataset.simPersona);
      });
    });
  }

  async persistConfig(toastMsg) {
    const res = await fetch('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(this.config),
    });
    if (res.ok) {
      const data = await res.json();
      this.config = data.config;
      this.stats = data.stats || this.stats;
      localStorage.setItem(
        STORAGE_KEYS.AI_CONFIG,
        JSON.stringify(this.config.aiConfig)
      );
      localStorage.setItem(
        STORAGE_KEYS.ARCH_MODE,
        this.config.architectureMode
      );
      this.populateSettingsForm();
      this.renderKpis();
      this.showToast(toastMsg);
    }
  }

  renderCustomScenariosList() {
    const container = document.getElementById('adminCustomScenariosList');
    if (!container) return;
    if (this.customScenarios.length === 0) {
      container.innerHTML = `<p class="subtitle" style="font-size:0.84rem;">No custom scenarios stored in SQLite yet. The 4 built-in Generic U HHP scenarios are active.</p>`;
      return;
    }

    container.innerHTML = this.customScenarios
      .map(
        (scen) => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:0.65rem 0.85rem; background:var(--bg-page); border:1px solid var(--border-light); border-radius:var(--radius-md); margin-bottom:0.5rem;">
          <div>
            <strong style="font-size:0.88rem;">${scen.courseCode}: ${scen.title}</strong>
            <div style="font-size:0.78rem; color:var(--text-muted);">Client: ${scen.client?.name} (${scen.client?.age}) • Stage: ${scen.client?.ttmStage}</div>
          </div>
          <button type="button" class="btn btn-outline btn-sm" data-delete-scenario="${scen.id}">
            Delete
          </button>
        </div>
      `
      )
      .join('');

    container.querySelectorAll('[data-delete-scenario]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.deleteScenario;
        const res = await fetch(`/api/scenarios/${encodeURIComponent(id)}`, {
          method: 'DELETE',
        });
        if (res.ok) {
          const data = await res.json();
          this.customScenarios = data.customScenarios || [];
          this.renderCustomScenariosList();
          this.renderKpis();
          this.showToast('Deleted custom scenario from SQLite.');
        }
      });
    });
  }

  async runSimulatedPersonaSession(personaKey) {
    const scenario = HHP_SCENARIOS[0];
    const personas = {
      interrogator: {
        label: 'Closed-Question Interrogator',
        rapport: 38,
        turns: [
          'how old are you',
          'what is your major at Generic U',
          'do you vape every day',
          'how many pods do you use a week',
          'did your doctor tell you to quit',
          'are you going to quit this week',
        ],
      },
      lecturer: {
        label: 'Righting-Reflex Lecturer',
        rapport: 28,
        turns: [
          'you need to stop vaping immediately because you just had bronchitis',
          'do you know what nicotine does to your blood pressure',
          'you have to throw the vape away tonight',
          'you should just drink water instead of vaping',
        ],
      },
      mastery: {
        label: 'Mastery MI Health Coach',
        rapport: 88,
        turns: [
          'thank you for coming in and being so honest with me today Marcus',
          'it sounds like you are under huge pressure with midterms and vaping has been your go-to stress relief even though this cough has you worried',
          'what are the main things vaping does for you during late-night coding and what parts are starting to bother you',
          'would it be okay if we looked at a couple ways other students handle cravings without quitting cold turkey',
          'on a scale from 1 to 10 what is one small experiment this week that feels realistic for you',
        ],
      },
    };

    const chosen = personas[personaKey] || personas.mastery;
    const transcript = [{ speaker: 'client', text: scenario.openingLine }];
    const turnJevHistory = [];

    for (const studentText of chosen.turns) {
      const jevTurn = await this.jevEngine.evaluateTurn({
        scenario,
        transcript,
        studentText,
        aiConfig: this.config.aiConfig,
      });
      turnJevHistory.push(jevTurn);
      transcript.push({ speaker: 'student', text: studentText });
      transcript.push({
        speaker: 'client',
        text: 'Yeah, I hear you. It is just tough with my schedule right now.',
      });
    }

    const durationSeconds = 180;
    const evalVersionA = evaluateSession({
      scenario,
      transcript,
      durationSeconds,
      finalRapport: chosen.rapport,
    });
    const evalVersionB = this.jevEngine.evaluateFullSessionWithJev({
      scenario,
      transcript,
      durationSeconds,
      finalRapport: chosen.rapport,
      turnJevHistory,
    });

    const saveRes = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scenarioId: scenario.id,
        courseCode: scenario.courseCode,
        scenarioTitle: `${scenario.title} [Sim: ${chosen.label}]`,
        clientName: scenario.client.name,
        architectureMode: this.config.architectureMode,
        durationSeconds,
        turnCount: chosen.turns.length,
        finalRapport: chosen.rapport,
        scoreVersionA: evalVersionA.totalScore,
        scoreVersionB: evalVersionB.totalScore,
        openQuestionPct: evalVersionA.metrics.openQuestionPct,
        transcript,
        turnJevHistory,
        evalVersionA,
        evalVersionB,
      }),
    });

    if (saveRes.ok) {
      await this.loadStateAndSessions();
      this.showToast(
        `Simulated "${chosen.label}" saved to SQLite (Version A: ${evalVersionA.totalScore} vs Version B Jev: ${evalVersionB.totalScore}).`
      );
    }
  }

  renderSessionsTable() {
    const tbody = document.getElementById('adminSessionsTableBody');
    if (!tbody) return;

    if (this.sessions.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" style="text-align:center; color:var(--text-muted); padding:2rem;">
            No sessions recorded in SQLite yet. Complete a voice session in the Student App or click one of the <strong>🧪 Simulate</strong> buttons above to test!
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = this.sessions
      .map((s) => {
        const dateStr = new Date(s.created_at).toLocaleString([], {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
        const delta = s.score_version_b - s.score_version_a;
        const deltaLabel = delta > 0 ? `+${delta}` : `${delta}`;
        const modePill =
          s.architecture_mode === 'version-b'
            ? `<span class="jev-conf-pill" style="margin:0;">Version B (Jev)</span>`
            : `<span class="course-badge">Version A</span>`;

        return `
          <tr>
            <td style="white-space:nowrap; color:var(--text-muted);">${dateStr}</td>
            <td>
              <strong>${s.course_code}: ${s.scenario_title}</strong>
              <div style="font-size:0.78rem; color:var(--text-muted);">Client: ${s.client_name}</div>
            </td>
            <td>${modePill}</td>
            <td>${s.turn_count} turns</td>
            <td><strong>${s.open_question_pct}%</strong></td>
            <td><strong>${s.score_version_a} / 100</strong></td>
            <td><strong style="color:var(--brand-rausch-dark);">${s.score_version_b} / 100</strong></td>
            <td><code>${deltaLabel} pts</code></td>
            <td style="white-space:nowrap;">
              <button type="button" class="btn btn-secondary btn-sm" data-inspect-session="${s.id}">
                Inspect A/B Report
              </button>
              <button type="button" class="btn btn-outline btn-sm" data-delete-session="${s.id}">
                ✕
              </button>
            </td>
          </tr>
        `;
      })
      .join('');

    tbody.querySelectorAll('[data-inspect-session]').forEach((btn) => {
      btn.addEventListener('click', () =>
        this.openSessionInspector(btn.dataset.inspectSession)
      );
    });

    tbody.querySelectorAll('[data-delete-session]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.deleteSession;
        const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`, {
          method: 'DELETE',
        });
        if (res.ok) {
          const data = await res.json();
          this.sessions = data.sessions || [];
          this.stats = data.stats || this.stats;
          this.renderKpis();
          this.renderSessionsTable();
          this.showToast('Deleted session record from SQLite.');
        }
      });
    });
  }

  async openSessionInspector(sessionId) {
    const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`);
    if (!res.ok) return;
    const { session } = await res.json();

    const dialog = document.getElementById('sessionInspectDialog');
    const body = document.getElementById('sessionInspectBody');
    if (!dialog || !body) return;

    const evalA = session.evalVersionA || {};
    const evalB = session.evalVersionB || {};
    const nouls = evalB.jevSummary?.sessionNouls || {};

    const criteriaRowsHtml = (evalB.criteria || [])
      .map((cB, idx) => {
        const cA = evalA.criteria?.[idx] || cB;
        return `
          <div style="padding:0.85rem 1rem; border:1px solid var(--border-light); border-radius:var(--radius-md); background:var(--bg-page); margin-bottom:0.6rem;">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem;">
              <div>
                <strong>${cB.name}</strong>
                <span class="criterion-ches">${cB.chesCode}</span>
              </div>
              <div style="font-size:0.85rem;">
                <span>Version A: <strong>${cA.score}/${cA.maxScore}</strong></span>
                <span style="margin:0 0.4rem;">|</span>
                <span style="color:var(--brand-rausch-dark);">Version B (Jev): <strong>${cB.score}/${cB.maxScore}</strong></span>
                <span class="jev-conf-pill">Jev score: ${cB.jevScore ?? '—'}/4.00 (${Math.round(
                  (cB.jevConfidence || 0.9) * 100
                )}% conf)</span>
              </div>
            </div>
            <p style="margin:0.35rem 0 0; font-size:0.83rem; color:var(--text-muted);">${cB.summary}</p>
          </div>
        `;
      })
      .join('');

    let studentIdx = 0;
    const transcriptHtml = (evalB.annotatedTranscript || [])
      .map((turn) => {
        const isStudent = turn.speaker === 'student';
        let jevLine = '';
        if (isStudent) {
          const jevTurn = session.turnJevHistory?.[studentIdx];
          studentIdx++;
          const r = jevTurn?.questions || turn.jevTelemetry;
          if (r) {
            jevLine = `
              <div style="margin-top:0.35rem; padding:0.4rem 0.65rem; background:#FFF8F6; border:1px solid #FFD6DF; border-radius:8px; font-size:0.76rem;">
                <strong>⚡ Jev System-1:</strong>
                <code>choice.miti_skill = ${r.miti_skill?.choice}</code> (${Math.round(
                  (r.miti_skill?.confidence || 0.9) * 100
                )}% conf) •
                <code>choice.route = ${r.client_state_route?.choice}</code> •
                <code>score.rapport = ${Number(r.rapport_shift?.score ?? 2).toFixed(2)}/4.00</code> •
                <code>noul.closed_q = ${Math.round(
                  (r.is_factual_or_yesno_closed?.noul || 0) * 100
                )}%</code> •
                <code>noul.righting_reflex = ${Math.round(
                  (r.righting_reflex_flag?.noul || 0) * 100
                )}%</code>
              </div>
            `;
          }
        }
        return `
          <div style="padding:0.75rem 0.95rem; border:1px solid var(--border-light); border-radius:var(--radius-md); margin-bottom:0.5rem; background:${
            isStudent ? 'var(--bg-page)' : '#ffffff'
          };">
            <div style="font-size:0.76rem; font-weight:700; color:var(--text-muted); margin-bottom:0.2rem;">
              ${isStudent ? '🎓 Student Coach' : `🧑 ${session.clientName} (Mock Client)`}
            </div>
            <div style="font-size:0.9rem;">"${turn.text}"</div>
            ${jevLine}
          </div>
        `;
      })
      .join('');

    body.innerHTML = `
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem; margin-bottom:1.15rem;">
        <div style="padding:1rem 1.2rem; border:1px solid var(--border-light); border-radius:var(--radius-lg); background:var(--bg-page);">
          <div class="eyebrow">Version A • Standard Rule Engine</div>
          <div style="font-size:1.85rem; font-weight:800;">${session.scoreVersionA} / 100</div>
          <div style="font-size:0.84rem; color:var(--text-muted);">${evalA.proficiencyLevel || ''}</div>
        </div>
        <div style="padding:1rem 1.2rem; border:2px solid var(--brand-rausch); border-radius:var(--radius-lg); background:#FFF8F6;">
          <div class="eyebrow">Version B • Jev System-1 (typesafe/jev-1.13)</div>
          <div style="font-size:1.85rem; font-weight:800; color:var(--brand-rausch-dark);">${session.scoreVersionB} / 100</div>
          <div style="font-size:0.84rem; color:var(--text-muted);">${evalB.proficiencyLevel || ''} • Avg Confidence: ${Math.round(
            (evalB.jevSummary?.avgConfidence || 0.92) * 100
          )}%</div>
        </div>
      </div>

      <h4 style="margin:0 0 0.5rem;">Jev Session-Level <code>noul</code> Binary Gate Probabilities</h4>
      <div class="jev-noul-summary-grid" style="margin-bottom:1.25rem;">
        <div class="jev-noul-card">
          <span>Open Q Target (≥50%)</span>
          <strong>${Math.round(
            (nouls.passed_miti_open_question_threshold?.noul || 0) * 100
          )}%</strong>
        </div>
        <div class="jev-noul-card">
          <span>Avoided Q-A Trap</span>
          <strong>${Math.round(
            (nouls.avoided_question_answer_trap?.noul || 0) * 100
          )}%</strong>
        </div>
        <div class="jev-noul-card">
          <span>Resisted Righting Reflex</span>
          <strong>${Math.round(
            (nouls.resisted_righting_reflex?.noul || 0) * 100
          )}%</strong>
        </div>
        <div class="jev-noul-card">
          <span>Used E-P-E Permission</span>
          <strong>${Math.round(
            (nouls.used_elicit_provide_elicit?.noul || 0) * 100
          )}%</strong>
        </div>
      </div>

      <h4 style="margin:0 0 0.5rem;">5-Dimension Rubric Comparison (Version A vs Version B Jev)</h4>
      <div style="margin-bottom:1.25rem;">${criteriaRowsHtml}</div>

      <h4 style="margin:0 0 0.5rem;">Utterance-by-Utterance Jev System-1 Transcript</h4>
      <div>${transcriptHtml}</div>
    `;

    dialog.showModal();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new HealthSimAdminApp();
});
