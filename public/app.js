import { HHP_SCENARIOS } from './scenarios.js';
import { VoiceSimulationEngine } from './voice-engine.js';
import { evaluateSession } from './evaluator.js';
import { JevSystemOneEngine } from './jev-engine.js';

const STORAGE_KEYS = {
  AI_CONFIG: 'uf_hhp_voicesim_ai_config',
  CUSTOM_SCENARIOS: 'uf_hhp_voicesim_custom_scenarios',
  ARCH_MODE: 'uf_hhp_voicesim_arch_mode',
};

class HealthSimApp {
  constructor() {
    this.scenarios = [...HHP_SCENARIOS, ...this.loadCustomScenarios()];
    this.activeCourseFilter = 'all';
    this.selectedScenario = this.scenarios[0];

    this.aiConfig = this.loadAiConfig();
    this.architectureMode =
      localStorage.getItem(STORAGE_KEYS.ARCH_MODE) || 'version-a'; // 'version-a' | 'version-b'
    this.showAbBannerOnStudentReport = false;
    this.jevEngine = new JevSystemOneEngine();

    // Active session state
    this.transcript = [];
    this.turnJevHistory = [];
    this.currentRapport = 50;
    this.currentAffect = '';
    this.sessionStartTime = null;
    this.lastDurationSeconds = 120;
    this.timerInterval = null;
    this.visualizerRaf = null;
    this.lastEvaluation = null;

    this.voiceEngine = new VoiceSimulationEngine({
      onStateChange: (state) => this.handleVoiceStateChange(state),
      onInterimSpeech: (preview) => {
        const el = document.getElementById('liveSpeechPreview');
        if (el) el.textContent = preview ? `"${preview}..."` : '';
      },
      onLiveTranscriptUpdate: (clientText) => {
        const speakerLabel = document.getElementById('captionSpeakerLabel');
        const textContent = document.getElementById('captionTextContent');
        if (speakerLabel && textContent && clientText) {
          speakerLabel.textContent = `${this.selectedScenario.client.name} (Gemini Native Audio):`;
          textContent.textContent = clientText;
        }
      },
      onError: (msg) => this.showVoiceAlert(msg),
    });

    this.init();
  }

  async init() {
    this.setupModernWebGuidancePolyfills();
    this.bindNavigationAndFilters();
    this.bindStudioControls();
    this.bindEvaluationControls();
    this.renderScenarioCards();
    this.renderDossier(this.selectedScenario);

    // Sync configuration & custom scenarios from the SQLite database (and auto-migrate any browser keys)
    await this.syncWithDatabase();
  }

  async syncWithDatabase() {
    try {
      const res = await fetch('/api/state');
      if (!res.ok) return;
      const data = await res.json();

      // Auto-migrate existing browser localStorage API key into SQLite if DB key is empty
      const localAi = this.loadAiConfig();
      const dbAi = data.config?.aiConfig || {};
      if (localAi.apiKey && !dbAi.apiKey) {
        const migRes = await fetch('/api/config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            architectureMode:
              localStorage.getItem(STORAGE_KEYS.ARCH_MODE) ||
              data.config?.architectureMode ||
              'version-a',
            aiConfig: localAi,
          }),
        });
        if (migRes.ok) {
          const migData = await migRes.json();
          data.config = migData.config;
        }
      }

      // Auto-migrate any localStorage custom scenarios into SQLite if DB has none
      const localScenarios = this.loadCustomScenarios();
      if (
        localScenarios.length > 0 &&
        (!data.customScenarios || data.customScenarios.length === 0)
      ) {
        for (const scen of localScenarios) {
          await fetch('/api/scenarios', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(scen),
          });
        }
        const scenRes = await fetch('/api/scenarios');
        if (scenRes.ok) {
          const scenJson = await scenRes.json();
          data.customScenarios = scenJson.customScenarios;
        }
      }

      if (data.config) {
        this.architectureMode = data.config.architectureMode || 'version-a';
        this.showAbBannerOnStudentReport = Boolean(
          data.config.showAbBannerOnStudentReport
        );
        this.aiConfig = {
          ...this.aiConfig,
          ...(data.config.aiConfig || {}),
        };
        // Keep localStorage in sync for instant page loads
        localStorage.setItem(STORAGE_KEYS.AI_CONFIG, JSON.stringify(this.aiConfig));
        localStorage.setItem(STORAGE_KEYS.ARCH_MODE, this.architectureMode);
      }

      if (Array.isArray(data.customScenarios)) {
        this.scenarios = [...HHP_SCENARIOS, ...data.customScenarios];
        this.renderScenarioCards();
      }

      this.updateEngineBadge();
    } catch {
      // Offline fallback if server API is unreachable
      this.updateEngineBadge();
    }
  }

  setupModernWebGuidancePolyfills() {
    // 1. Fallback for <dialog closedby="any"> per modern-web-guidance (light-dismiss-a-dialog)
    document.querySelectorAll('dialog[closedby="any"]').forEach((dialog) => {
      if (!('closedBy' in HTMLDialogElement.prototype)) {
        dialog.addEventListener('click', (event) => {
          if (event.target !== dialog) return;
          const rect = dialog.getBoundingClientRect();
          const isDialogContent =
            rect.top <= event.clientY &&
            event.clientY <= rect.top + rect.height &&
            rect.left <= event.clientX &&
            event.clientX <= rect.left + rect.width;
          if (isDialogContent) return;
          dialog.close();
        });
      }
    });

    // 2. Synchronize UI state for hidden="until-found" panels per modern-web-guidance (search-hidden-content)
    const accordion = document.getElementById('evalCustomAccordion');
    if (accordion) {
      accordion.addEventListener('beforematch', (e) => {
        const matchedPanel = e.target.closest('.eval-panel');
        if (!matchedPanel) return;
        accordion.querySelectorAll('.eval-panel').forEach((panel) => {
          if (panel !== matchedPanel) {
            panel.setAttribute('hidden', 'until-found');
          }
        });
        accordion.querySelectorAll('.eval-tab-btn').forEach((btn) => {
          const controls = btn.getAttribute('aria-controls');
          btn.setAttribute(
            'aria-expanded',
            controls === matchedPanel.id ? 'true' : 'false'
          );
        });
      });

      // Fallback for browsers without onbeforematch support
      if (!('onbeforematch' in HTMLElement.prototype)) {
        accordion.querySelectorAll('[hidden="until-found"]').forEach((el) => {
          el.removeAttribute('hidden');
          const controllingBtn = accordion.querySelector(
            `[aria-controls="${el.id}"]`
          );
          if (controllingBtn) {
            controllingBtn.setAttribute('aria-expanded', 'true');
          }
        });
      }
    }
  }

  loadAiConfig() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.AI_CONFIG));
      if (saved) {
        if (saved.apiKey && (!saved.provider || saved.provider === 'local')) {
          saved.provider = saved.apiKey.startsWith('sk-') ? 'openai' : 'gemini';
        }
        if (
          !saved.geminiModel ||
          saved.geminiModel === 'auto-pro' ||
          saved.geminiModel === 'gemini-3.8-flash'
        ) {
          saved.geminiModel = 'auto-fast';
        }
        return saved;
      }
    } catch {
      // ignore
    }
    return { provider: 'gemini', geminiModel: 'auto-fast', apiKey: '', ttsRate: 1.0 };
  }

  loadCustomScenarios() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.CUSTOM_SCENARIOS)) || [];
    } catch {
      return [];
    }
  }

  updateEngineBadge() {
    const label = document.getElementById('activeEngineLabel');
    if (!label) return;
    const hasKey = Boolean(this.aiConfig.apiKey?.trim());
    label.textContent = hasKey
      ? 'Standardized Client Voice Studio • Live Audio Ready'
      : 'Standardized Client Voice Studio • Ready';
  }

  setArchitectureMode(mode) {
    this.architectureMode = mode === 'version-b' ? 'version-b' : 'version-a';
    localStorage.setItem(STORAGE_KEYS.ARCH_MODE, this.architectureMode);
    const evalSection = document.getElementById('viewEvaluation');
    if (evalSection && !evalSection.hidden) {
      this.recomputeAndRenderCurrentEvaluation();
    }
  }

  bindNavigationAndFilters() {
    document.querySelectorAll('.filter-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        document
          .querySelectorAll('.filter-chip')
          .forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.activeCourseFilter = btn.dataset.course;
        this.renderScenarioCards();
      });
    });
  }

  renderScenarioCards() {
    const grid = document.getElementById('scenarioCardsGrid');
    if (!grid) return;

    const filtered =
      this.activeCourseFilter === 'all'
        ? this.scenarios
        : this.scenarios.filter((s) => s.courseCode === this.activeCourseFilter);

    grid.innerHTML = filtered
      .map((scen) => {
        const isSelected = scen.id === this.selectedScenario?.id;
        return `
          <button
            type="button"
            role="option"
            aria-selected="${isSelected}"
            class="scenario-card ${isSelected ? 'selected' : ''}"
            data-scenario-id="${scen.id}"
          >
            <div class="card-top-meta">
              <span class="course-badge">${scen.courseCode} • ${scen.courseTitle}</span>
              <span class="stage-badge">TTM: ${scen.client.ttmStage}</span>
            </div>
            <h3>${scen.title}</h3>
            <p class="subtitle">${scen.clinicalDossier.chiefComplaint}</p>
            <div class="client-mini-row">
              <div class="avatar-circle" style="background: ${scen.client.avatarColor}">
                ${scen.client.avatarInitials}
              </div>
              <div>
                <strong>${scen.client.name} (${scen.client.age}, ${scen.client.pronouns})</strong> • ${scen.client.role}
              </div>
            </div>
          </button>
        `;
      })
      .join('');

    grid.querySelectorAll('.scenario-card').forEach((card) => {
      card.addEventListener('click', () => {
        const found = this.scenarios.find(
          (s) => s.id === card.dataset.scenarioId
        );
        if (found) {
          this.selectedScenario = found;
          this.renderScenarioCards();
          this.renderDossier(found);
        }
      });
    });
  }

  renderDossier(scen) {
    const container = document.getElementById('dossierContent');
    if (!container || !scen) return;

    container.innerHTML = `
      <div class="dossier-header">
        <div class="dossier-avatar" style="background: ${scen.client.avatarColor}">
          ${scen.client.avatarInitials}
        </div>
        <div>
          <span class="course-badge">${scen.courseCode}</span>
          <h3 style="margin: 0.2rem 0 0;">${scen.client.name}, ${scen.client.age} (${scen.client.pronouns})</h3>
          <p class="subtitle">${scen.client.role} • Stage: <strong>${scen.client.ttmStage}</strong></p>
        </div>
      </div>

      <div class="dossier-launch-box" style="margin-top: 1rem; margin-bottom: 1.25rem;">
        <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.82rem; color:var(--brand-rausch); font-weight:700;">
          <span>🎙️ Modality: Pure Voice-Only Encounter</span>
          <span>Target: ~${scen.durationTargetMinutes} mins</span>
        </div>
        <button type="button" class="btn btn-launch-voice" id="startVoiceSessionBtn">
          🎙️ Start Voice-Only Client Session
        </button>
        <button type="button" class="btn btn-outline" id="previewClientVoiceBtn" style="justify-content:center;">
          🔊 Preview ${scen.client.name}'s Opening Voice
        </button>
      </div>

      <div class="dossier-section">
        <h4>Referral &amp; Chief Complaint</h4>
        <p><strong>${scen.clinicalDossier.referralSource}:</strong> ${scen.clinicalDossier.chiefComplaint}</p>
      </div>

      <div class="dossier-section">
        <h4>Vitals &amp; Behavioral Baseline</h4>
        <div class="vitals-chips">
          ${scen.clinicalDossier.vitalsAndBaseline
            .map((v) => `<span class="vital-chip">${v}</span>`)
            .join('')}
        </div>
      </div>

      <div class="dossier-section">
        <h4>Psychosocial Context &amp; Barriers</h4>
        <p>${scen.clinicalDossier.psychosocialContext}</p>
      </div>

      <div class="dossier-section">
        <h4>Target HHP &amp; MITI 4.2 Competencies</h4>
        <ul>
          ${scen.clinicalDossier.learningObjectives
            .map((obj) => `<li>${obj}</li>`)
            .join('')}
        </ul>
      </div>
    `;

    document
      .getElementById('startVoiceSessionBtn')
      ?.addEventListener('click', () => this.startSession(scen));

    document
      .getElementById('previewClientVoiceBtn')
      ?.addEventListener('click', () => {
        this.voiceEngine.speakText(
          scen.openingLine,
          {
            ...scen.client.voiceProfile,
            rate: this.aiConfig.ttsRate || scen.client.voiceProfile.rate,
          },
          this.aiConfig
        );
      });
  }

  async startSession(scen) {
    await this.syncWithDatabase();
    this.selectedScenario = scen;
    this.transcript = [];
    this.turnJevHistory = [];
    this.currentRapport = scen.client.initialRapport;
    this.currentAffect = scen.client.initialAffect;
    this.voiceEngine.usedTopicIndices.clear();
    this.sessionStartTime = Date.now();

    // Switch view to Studio
    document.getElementById('viewLibrary').hidden = true;
    document.getElementById('viewEvaluation').hidden = true;
    document.getElementById('viewStudio').hidden = false;

    const studioJevPanel = document.getElementById('studioJevPanel');
    if (studioJevPanel) {
      studioJevPanel.hidden = !(
        this.showAbBannerOnStudentReport && this.architectureMode === 'version-b'
      );
    }
    const studioJevBody = document.getElementById('studioJevTelemetryBody');
    if (studioJevBody) {
      studioJevBody.innerHTML =
        'Speak your first coaching turn to inspect Jev System-1 <code>choice</code>, <code>score</code>, and <code>noul</code> outputs.';
    }

    // Populate Studio UI
    document.getElementById('studioCourseTag').textContent = scen.courseCode;
    document.getElementById('studioScenarioTitle').textContent = scen.title;
    const avatarEl = document.getElementById('studioClientAvatar');
    avatarEl.textContent = scen.client.avatarInitials;
    avatarEl.style.background = scen.client.avatarColor;
    document.getElementById('studioClientName').textContent = scen.client.name;
    document.getElementById(
      'studioClientRole'
    ).textContent = `${scen.client.age} • ${scen.client.role} • Stage: ${scen.client.ttmStage}`;

    this.updateStudioTelemetry();
    this.renderStudioSidebar(scen);
    this.hideVoiceAlert();

    // Start session timer & canvas visualizer
    clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => this.updateTimerDisplay(), 1000);
    this.updateTimerDisplay();
    this.startVisualizerLoop();

    // Connect Gemini Native Audio Live WebSocket (BidiGenerateContent) if Gemini API key is configured
    const rawKey = (this.aiConfig?.apiKey || '').trim();
    if (rawKey && !rawKey.startsWith('sk-') && this.aiConfig?.provider !== 'openai') {
      const liveModel = await this.voiceEngine.connectGeminiNativeAudioSession({
        scenario: scen,
        apiKey: rawKey,
      });
      if (liveModel) {
        this.currentAffect = `${scen.client.initialAffect} (Native Audio: ${liveModel})`;
        this.updateStudioTelemetry();
      }
    }

    // Record and speak client's opening statement
    this.appendTurn('client', scen.openingLine);
    await this.voiceEngine.speakText(
      scen.openingLine,
      {
        ...scen.client.voiceProfile,
        rate: this.aiConfig.ttsRate || scen.client.voiceProfile.rate,
      },
      this.aiConfig
    );
  }

  renderStudioSidebar(scen) {
    const cueContainer = document.getElementById('studioCueCardsList');
    if (cueContainer) {
      cueContainer.innerHTML = scen.cueCards
        .map(
          (card, idx) => `
          <button type="button" class="cue-card-btn" data-cue-idx="${idx}">
            <span class="cue-card-cat">${card.category}</span>
            <span class="cue-card-text">"${card.text}"</span>
          </button>
        `
        )
        .join('');

      cueContainer.querySelectorAll('.cue-card-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const card = scen.cueCards[Number(btn.dataset.cueIdx)];
          if (card && this.voiceEngine.state !== 'processing') {
            this.handleStudentSpokenTurn(card.text);
          }
        });
      });
    }

    const chartRef = document.getElementById('studioChartQuickRef');
    if (chartRef) {
      chartRef.innerHTML = `
        <p><strong>Chief Complaint:</strong> ${scen.clinicalDossier.chiefComplaint}</p>
        <p style="margin-top:0.5rem;"><strong>Psychosocial Context:</strong> ${scen.clinicalDossier.psychosocialContext}</p>
        <p style="margin-top:0.5rem;"><strong>Target Competencies:</strong></p>
        <ul style="padding-left:1.1rem; margin:0.25rem 0 0;">
          ${scen.clinicalDossier.learningObjectives
            .map((o) => `<li>${o}</li>`)
            .join('')}
        </ul>
      `;
    }
  }

  bindStudioControls() {
    const micBtn = document.getElementById('micToggleBtn');
    micBtn?.addEventListener('click', () => {
      if (this.voiceEngine.state === 'listening') {
        this.voiceEngine.finishListeningAndSend();
      } else {
        this.voiceEngine.startListening({
          onSpokenResult: (text) => this.handleStudentSpokenTurn(text),
        });
      }
    });

    // Spacebar Push-to-Talk shortcut inside active studio
    window.addEventListener('keydown', (e) => {
      const studioVisible = !document.getElementById('viewStudio').hidden;
      const activeTag = document.activeElement?.tagName;
      if (
        studioVisible &&
        e.code === 'Space' &&
        activeTag !== 'INPUT' &&
        activeTag !== 'TEXTAREA' &&
        activeTag !== 'BUTTON' &&
        !e.repeat
      ) {
        e.preventDefault();
        if (this.voiceEngine.state !== 'listening') {
          this.voiceEngine.startListening({
            onSpokenResult: (text) => this.handleStudentSpokenTurn(text),
          });
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      const studioVisible = !document.getElementById('viewStudio').hidden;
      const activeTag = document.activeElement?.tagName;
      if (
        studioVisible &&
        e.code === 'Space' &&
        activeTag !== 'INPUT' &&
        activeTag !== 'TEXTAREA' &&
        activeTag !== 'BUTTON'
      ) {
        e.preventDefault();
        if (this.voiceEngine.state === 'listening') {
          this.voiceEngine.finishListeningAndSend();
        }
      }
    });

    document.getElementById('repeatClientBtn')?.addEventListener('click', () => {
      const lastClient = [...this.transcript]
        .reverse()
        .find((t) => t.speaker === 'client');
      if (lastClient) {
        this.voiceEngine.speakText(
          lastClient.text,
          {
            ...this.selectedScenario.client.voiceProfile,
            rate:
              this.aiConfig.ttsRate ||
              this.selectedScenario.client.voiceProfile.rate,
          },
          this.aiConfig
        );
      }
    });

    document
      .getElementById('toggleAccessibilityCaptions')
      ?.addEventListener('change', (e) => {
        const box = document.getElementById('accessibilityCaptionBox');
        if (box) box.hidden = !e.target.checked;
      });

    document.getElementById('abortSessionBtn')?.addEventListener('click', () => {
      this.cleanupStudio();
      document.getElementById('viewStudio').hidden = true;
      document.getElementById('viewLibrary').hidden = false;
    });

    document
      .getElementById('endAndEvaluateBtn')
      ?.addEventListener('click', () => {
        this.finishAndEvaluateSession();
      });
  }

  async handleStudentSpokenTurn(studentText) {
    const clean = studentText.trim();
    if (!clean) return;

    document.getElementById('liveSpeechPreview').textContent = '';

    // Compute Jev System-1 turn decisions (always recorded so A/B switching on the Eval Report works)
    const jevTurnResult = await this.jevEngine.evaluateTurn({
      scenario: this.selectedScenario,
      transcript: this.transcript,
      studentText: clean,
      aiConfig: this.aiConfig,
    });
    this.turnJevHistory.push(jevTurnResult);
    this.renderStudioJevTelemetry(jevTurnResult);

    this.appendTurn('student', clean);
    this.updateStudioTelemetry();

    const response = await this.voiceEngine.generateClientResponse({
      scenario: this.selectedScenario,
      transcript: this.transcript,
      studentText: clean,
      currentRapport: this.currentRapport,
      aiConfig: this.aiConfig,
      jevTurnResult: this.architectureMode === 'version-b' ? jevTurnResult : null,
    });

    this.currentRapport = response.rapport;
    this.currentAffect = response.affect;
    this.appendTurn('client', response.reply);
    this.updateStudioTelemetry();

    // If Gemini Native Audio Live WebSocket already streamed the spoken audio, don't re-synthesize
    if (!response.alreadySpokenByLiveAudio) {
      await this.voiceEngine.speakText(
        response.reply,
        {
          ...this.selectedScenario.client.voiceProfile,
          rate:
            this.aiConfig.ttsRate || this.selectedScenario.client.voiceProfile.rate,
        },
        this.aiConfig
      );
    }
  }

  renderStudioJevTelemetry(jevTurnResult) {
    const body = document.getElementById('studioJevTelemetryBody');
    if (!body || !jevTurnResult) return;

    const r = jevTurnResult.questions || jevTurnResult.response || {};
    const skillChoice = r.miti_skill?.choice || 'unknown';
    const skillConf = Math.round((r.miti_skill?.confidence || 0.85) * 100);
    const routeChoice = r.client_state_route?.choice || 'warm_rapport_opening';
    const rapportScore = Number(r.rapport_shift?.score ?? 2).toFixed(2);
    const rrNoul = Math.round((r.righting_reflex_flag?.noul || 0) * 100);
    const epeNoul = Math.round((r.asked_permission_flag?.noul || 0) * 100);
    const closedNoul = Math.round((r.is_factual_or_yesno_closed?.noul || 0) * 100);

    body.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.35rem;">
        <span style="font-weight:700; color:var(--text-main);">Turn #${this.turnJevHistory.length} • <code>${jevTurnResult.source || jevTurnResult.model}</code> (${jevTurnResult.latencyMs}ms)</span>
        <span class="jev-conf-pill">${skillConf}% conf</span>
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.35rem; margin-bottom:0.4rem;">
        <div><strong>choice.miti_skill:</strong> <code>${skillChoice}</code></div>
        <div><strong>choice.client_route:</strong> <code>${routeChoice}</code></div>
        <div><strong>score.rapport_shift:</strong> <code>${rapportScore} / 4.00</code> (${jevTurnResult.rapportDelta >= 0 ? '+' : ''}${jevTurnResult.rapportDelta} pts)</div>
        <div><strong>noul.factual_or_closed:</strong> <code>${closedNoul}%</code></div>
        <div><strong>noul.righting_reflex:</strong> <code style="color:${rrNoul > 50 ? '#C13515' : '#008489'}">${rrNoul}%</code></div>
        <div><strong>noul.epe_permission:</strong> <code>${epeNoul}%</code></div>
      </div>
      <div style="font-size:0.75rem; color:var(--text-secondary); border-top:1px dashed var(--border-subtle); padding-top:0.3rem;">
        <strong>System-1 → System-2 Voice Directive:</strong> ${jevTurnResult.steeringDirective}
      </div>
    `;
  }

  appendTurn(speaker, text) {
    this.transcript.push({
      speaker,
      text,
      timestamp: Date.now(),
    });

    const speakerLabel = document.getElementById('captionSpeakerLabel');
    const textContent = document.getElementById('captionTextContent');
    if (speakerLabel && textContent) {
      speakerLabel.textContent =
        speaker === 'client'
          ? `${this.selectedScenario.client.name} (Mock Client):`
          : 'You (Health Coach Student):';
      textContent.textContent = text;
    }
  }

  updateStudioTelemetry() {
    const studentTurnCount = this.transcript.filter(
      (t) => t.speaker === 'student'
    ).length;
    document.getElementById('studioTurnCount').textContent = String(
      studentTurnCount
    );
    document.getElementById(
      'studioRapportValue'
    ).textContent = `${this.currentRapport}/100`;
    document.getElementById(
      'studioRapportPct'
    ).textContent = `${this.currentRapport}%`;
    document.getElementById(
      'studioRapportBar'
    ).style.width = `${this.currentRapport}%`;
    document.getElementById('studioClientAffect').textContent =
      this.currentAffect;
  }

  updateTimerDisplay() {
    if (!this.sessionStartTime) return;
    const elapsedSec = Math.floor((Date.now() - this.sessionStartTime) / 1000);
    const mins = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
    const secs = String(elapsedSec % 60).padStart(2, '0');
    const timerEl = document.getElementById('studioTimer');
    if (timerEl) timerEl.textContent = `${mins}:${secs}`;
  }

  handleVoiceStateChange(state) {
    const banner = document.getElementById('voiceStateBanner');
    const micBtn = document.getElementById('micToggleBtn');
    const micLabel = document.getElementById('micBtnLabel');
    if (!banner || !micBtn || !micLabel) return;

    micBtn.classList.remove('listening');

    if (state === 'listening') {
      banner.textContent =
        '🎙️ Listening to You... (Click button or release Spacebar when done)';
      banner.style.color = '#fca5a5';
      micBtn.classList.add('listening');
      micLabel.textContent = 'Finish Speaking & Send Turn';
    } else if (state === 'client-speaking') {
      banner.textContent = `🔊 ${this.selectedScenario.client.name} is Speaking... (Listen Actively)`;
      banner.style.color = '#fdba74';
      micLabel.textContent = 'Speak to Client (or Hold Spacebar)';
    } else if (state === 'processing') {
      banner.textContent = `⏳ ${this.selectedScenario.client.name} is processing your response...`;
      banner.style.color = '#93c5fd';
    } else {
      banner.textContent =
        'Ready for Your Voice Turn — Click "Speak to Client" or Hold Spacebar';
      banner.style.color = '#93c5fd';
      micLabel.textContent = 'Speak to Client (or Hold Spacebar)';
    }
  }

  showVoiceAlert(message) {
    const el = document.getElementById('voiceAlertBanner');
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
  }

  hideVoiceAlert() {
    const el = document.getElementById('voiceAlertBanner');
    if (el) el.hidden = true;
  }

  startVisualizerLoop() {
    cancelAnimationFrame(this.visualizerRaf);
    const canvas = document.getElementById('voiceVisualizerCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const render = (time) => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;
      const energy = this.voiceEngine.getAudioEnergy();
      const state = this.voiceEngine.state;

      // Choose ring color based on active speaker (Airbnb Rausch & Babu palette)
      let primaryColor = 'rgba(255, 56, 92, 0.78)'; // Idle Airbnb Rausch coral
      let glowColor = 'rgba(255, 56, 92, 0.22)';
      if (state === 'listening') {
        primaryColor = 'rgba(0, 166, 153, 0.95)'; // Student mic active (Airbnb Babu teal)
        glowColor = 'rgba(0, 166, 153, 0.32)';
      } else if (state === 'client-speaking') {
        primaryColor = 'rgba(255, 56, 92, 0.96)'; // Client speaking (Airbnb Rausch coral)
        glowColor = 'rgba(255, 56, 92, 0.36)';
      }

      // Outer pulsing halo
      const outerRadius = 72 + energy * 58;
      ctx.beginPath();
      ctx.arc(cx, cy, outerRadius, 0, Math.PI * 2);
      ctx.fillStyle = glowColor;
      ctx.fill();

      // Dynamic acoustic wave bars around the circle
      const barCount = 48;
      const baseRadius = 56;
      for (let i = 0; i < barCount; i++) {
        const angle = (i / barCount) * Math.PI * 2;
        const wave =
          Math.sin(time * 0.006 + i * 0.45) *
          Math.cos(time * 0.004 - i * 0.25);
        const barLen = 8 + energy * 46 * Math.abs(wave);

        const x1 = cx + Math.cos(angle) * baseRadius;
        const y1 = cy + Math.sin(angle) * baseRadius;
        const x2 = cx + Math.cos(angle) * (baseRadius + barLen);
        const y2 = cy + Math.sin(angle) * (baseRadius + barLen);

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = primaryColor;
        ctx.lineWidth = 3.2;
        ctx.lineCap = 'round';
        ctx.stroke();
      }

      // Inner core circle
      ctx.beginPath();
      ctx.arc(cx, cy, 46, 0, Math.PI * 2);
      ctx.fillStyle = '#0f172a';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = primaryColor;
      ctx.stroke();

      // Center label
      ctx.fillStyle = '#f8fafc';
      ctx.font = '700 13px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const label =
        state === 'listening'
          ? 'YOU'
          : state === 'client-speaking'
          ? this.selectedScenario.client.avatarInitials
          : 'VOICE';
      ctx.fillText(label, cx, cy);

      this.visualizerRaf = requestAnimationFrame(render);
    };

    this.visualizerRaf = requestAnimationFrame(render);
  }

  cleanupStudio() {
    clearInterval(this.timerInterval);
    cancelAnimationFrame(this.visualizerRaf);
    this.voiceEngine.stopListening();
    this.voiceEngine.stopCurrentAudio();
    this.voiceEngine.closeLiveSession();
  }

  async finishAndEvaluateSession() {
    this.cleanupStudio();

    const durationSeconds = Math.max(
      15,
      Math.floor((Date.now() - (this.sessionStartTime || Date.now())) / 1000)
    );
    this.lastDurationSeconds = durationSeconds;

    document.getElementById('viewStudio').hidden = true;
    document.getElementById('viewEvaluation').hidden = false;

    const { evalVersionA, evalVersionB } =
      await this.recomputeAndRenderCurrentEvaluation();

    // Persist session & both evaluations into the SQLite database (`POST /api/sessions`)
    try {
      await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenarioId: this.selectedScenario.id,
          courseCode: this.selectedScenario.courseCode,
          scenarioTitle: this.selectedScenario.title,
          clientName: this.selectedScenario.client.name,
          architectureMode: this.architectureMode,
          durationSeconds,
          turnCount: evalVersionA.metrics.studentTurnsCount,
          finalRapport: this.currentRapport,
          scoreVersionA: evalVersionA.totalScore,
          scoreVersionB: evalVersionB.totalScore,
          openQuestionPct: evalVersionA.metrics.openQuestionPct,
          transcript: this.transcript,
          turnJevHistory: this.turnJevHistory,
          evalVersionA,
          evalVersionB,
        }),
      });
    } catch {
      // ignore if offline
    }
  }

  async recomputeAndRenderCurrentEvaluation() {
    const durationSeconds = this.lastDurationSeconds || 120;

    // Always compute both Version A and Version B so the user can compare them side-by-side!
    const evalVersionA = evaluateSession({
      scenario: this.selectedScenario,
      transcript: this.transcript,
      durationSeconds,
      finalRapport: this.currentRapport,
    });

    const evalVersionB = await this.jevEngine.evaluateFullSessionWithJev({
      scenario: this.selectedScenario,
      transcript: this.transcript,
      durationSeconds,
      finalRapport: this.currentRapport,
      turnJevHistory: this.turnJevHistory,
      aiConfig: this.aiConfig,
    });

    const activeEvaluation =
      this.architectureMode === 'version-b' ? evalVersionB : evalVersionA;
    this.lastEvaluation = activeEvaluation;

    this.renderEvaluationReport(activeEvaluation, durationSeconds, {
      evalVersionA,
      evalVersionB,
    });

    return { evalVersionA, evalVersionB };
  }

  renderEvaluationReport(evalData, durationSeconds, abCompare = null) {
    const scen = this.selectedScenario;
    const isJevMode = this.architectureMode === 'version-b';

    document.getElementById(
      'evalScenarioTitle'
    ).textContent = `${scen.courseCode}: ${scen.title} — Evaluation Report`;
    document.getElementById(
      'evalScenarioMeta'
    ).textContent = `Mock Client: ${scen.client.name} (${scen.client.age}) • Session Duration: ${Math.floor(
      durationSeconds / 60
    )}m ${durationSeconds % 60}s • Spoken Turns: ${
      evalData.metrics.studentTurnsCount
    }`;

    document.getElementById('evalTotalScore').textContent = String(
      evalData.totalScore
    );
    const badge = document.getElementById('evalProficiencyBadge');
    badge.textContent = evalData.proficiencyLevel;
    document.getElementById('evalStageShift').textContent = evalData.stageShift;

    // Render A/B Architecture Comparison Banner only if Admin enabled it on student view
    const jBanner = document.getElementById('evalJevComparisonBanner');
    if (jBanner) {
      jBanner.hidden = !this.showAbBannerOnStudentReport || !abCompare;
    }
    if (jBanner && abCompare && this.showAbBannerOnStudentReport) {
      const { evalVersionA, evalVersionB } = abCompare;
      const jevMeta = evalVersionB.jevSummary;
      const nouls = jevMeta.sessionNouls;
      const delta = evalVersionB.totalScore - evalVersionA.totalScore;
      const deltaStr = delta > 0 ? `+${delta} pts` : `${delta} pts`;

      jBanner.innerHTML = `
        <div class="jev-banner-header">
          <div>
            <div class="jev-banner-title">
              ⚡ Architecture A/B Comparison — Active View: <strong>${
                isJevMode
                  ? 'Version B (Jev System-1 Decision Engine)'
                  : 'Version A (Standard Rule Rubric)'
              }</strong>
            </div>
            <div style="font-size:0.8rem; color:var(--text-secondary); margin-top:0.15rem;">
              Version A Total: <strong>${evalVersionA.totalScore}/100</strong> vs. Version B (<code>${jevMeta.model}</code>) Total: <strong>${evalVersionB.totalScore}/100</strong>
              (Delta: <strong>${deltaStr}</strong> • Avg Jev Confidence: <strong>${Math.round(
                jevMeta.avgConfidence * 100
              )}%</strong>)
            </div>
          </div>
          <button type="button" class="btn btn-outline btn-sm" id="evalToggleAbBtn">
            Switch to ${isJevMode ? 'Version A (Standard)' : 'Version B (Jev Hybrid ⚡)'}
          </button>
        </div>
        <div class="jev-noul-grid">
          <div class="jev-noul-card">
            <div class="jev-noul-label">noul: Open Q Target (≥50%)</div>
            <div class="jev-noul-val">${Math.round(
              (nouls.passed_miti_open_question_threshold?.noul || 0) * 100
            )}%</div>
          </div>
          <div class="jev-noul-card">
            <div class="jev-noul-label">noul: Avoided Q-A Trap</div>
            <div class="jev-noul-val">${Math.round(
              (nouls.avoided_question_answer_trap?.noul || 0) * 100
            )}%</div>
          </div>
          <div class="jev-noul-card">
            <div class="jev-noul-label">noul: Resisted Righting Reflex</div>
            <div class="jev-noul-val">${Math.round(
              (nouls.resisted_righting_reflex?.noul || 0) * 100
            )}%</div>
          </div>
          <div class="jev-noul-card">
            <div class="jev-noul-label">noul: Used E-P-E Permission</div>
            <div class="jev-noul-val">${Math.round(
              (nouls.used_elicit_provide_elicit?.noul || 0) * 100
            )}%</div>
          </div>
          <div class="jev-noul-card">
            <div class="jev-noul-label">noul: Stage-Matched Plan</div>
            <div class="jev-noul-val">${Math.round(
              (nouls.established_stage_matched_plan?.noul || 0) * 100
            )}%</div>
          </div>
        </div>
      `;

      document
        .getElementById('evalToggleAbBtn')
        ?.addEventListener('click', () => {
          this.setArchitectureMode(isJevMode ? 'version-a' : 'version-b');
        });
    }

    // Render KPI Cards
    const m = evalData.metrics;
    document.getElementById('evalKpiGrid').innerHTML = `
      <div class="kpi-card">
        <div class="kpi-label">Open Question Ratio</div>
        <div class="kpi-val">${m.openQuestionPct}%</div>
        <div class="kpi-sub">${m.openQuestions} Open / ${m.closedQuestions} Closed (MITI Target ≥50%)</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Reflections &amp; Affirmations</div>
        <div class="kpi-val">${m.reflections + m.affirmations}</div>
        <div class="kpi-sub">${m.reflections} Reflections • ${m.affirmations} Affirmations</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Talk-to-Listen Ratio</div>
        <div class="kpi-val">${m.studentTalkRatio}% / ${m.clientTalkRatio}%</div>
        <div class="kpi-sub">Coach vs. Client Words (Ideal: 35–50% Coach)</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Vocal Pacing &amp; Fillers</div>
        <div class="kpi-val">${m.speakingWpm} WPM</div>
        <div class="kpi-sub">${m.fillerCount} vocal filler(s) • ${m.rightingReflexCount} Righting Reflex warning(s)</div>
      </div>
    `;

    // Render 5 Criteria
    document.getElementById('evalCriteriaList').innerHTML = evalData.criteria
      .map((c) => {
        const pct = Math.round((c.score / c.maxScore) * 100);
        const jevPillHtml =
          isJevMode && c.jevScore !== undefined
            ? `<span class="jev-conf-pill" style="margin-left:0.45rem;">Jev score: ${c.jevScore}/4.00 (${Math.round(
                (c.jevConfidence || 0.88) * 100
              )}% conf)</span>`
            : '';
        return `
          <div class="criterion-row">
            <div class="criterion-top">
              <div>
                <span class="criterion-title">${c.name}</span>
                <span class="criterion-ches">${c.chesCode}</span>
                ${jevPillHtml}
              </div>
              <span class="criterion-score-pill">${c.score} / ${c.maxScore} pts</span>
            </div>
            <div class="criterion-bar-track">
              <div class="criterion-bar-fill" style="width: ${pct}%"></div>
            </div>
            <p style="margin:0; font-size:0.88rem; color:var(--text-muted);">${c.summary}</p>
          </div>
        `;
      })
      .join('');

    // Strengths & Growth
    document.getElementById('evalStrengthsList').innerHTML = evalData.strengths
      .map((s) => `<li>${s}</li>`)
      .join('');
    document.getElementById('evalImprovementsList').innerHTML =
      evalData.improvements.map((i) => `<li>${i}</li>`).join('');

    // Annotated Utterance-by-Utterance Transcript
    const transContainer = document.getElementById('evalAnnotatedTranscript');
    if (evalData.annotatedTranscript.length <= 1) {
      transContainer.innerHTML = `<p class="subtitle">No student spoken turns were recorded during this session. Click "Practice Scenario Again" and use your microphone or click any Clinical Cue Card to test.</p>`;
    } else {
      let studentTurnCounter = 0;
      transContainer.innerHTML = evalData.annotatedTranscript
        .map((turn) => {
          const isStudent = turn.speaker === 'student';
          let jevTurnBlock = '';

          if (isStudent) {
            const jevTurn = this.turnJevHistory[studentTurnCounter];
            studentTurnCounter++;
            const r = jevTurn?.questions || turn.jevTelemetry;
            if (isJevMode && r) {
              jevTurnBlock = `
                <div style="margin-top:0.45rem; padding:0.45rem 0.65rem; background:#FFF8F6; border:1px solid #FFD6DF; border-radius:8px; font-size:0.78rem; color:var(--text-secondary);">
                  <strong>⚡ Jev System-1 Turn Decision (<code>${jevTurn?.source || 'typesafe/jev-1.13'}</code>):</strong>
                  <code>choice.miti_skill = ${r.miti_skill?.choice}</code> (${Math.round(
                    (r.miti_skill?.confidence || 0.85) * 100
                  )}% conf) •
                  <code>choice.client_route = ${r.client_state_route?.choice}</code> •
                  <code>score.rapport_shift = ${Number(
                    r.rapport_shift?.score ?? 2
                  ).toFixed(2)}/4.00</code> •
                  <code>noul.factual_or_closed = ${Math.round(
                    (r.is_factual_or_yesno_closed?.noul || 0) * 100
                  )}%</code> •
                  <code>noul.righting_reflex = ${Math.round(
                    (r.righting_reflex_flag?.noul || 0) * 100
                  )}%</code>
                </div>
              `;
            }
          }

          const tagsHtml = isStudent
            ? turn.analysis.tags
                .map(
                  (t) =>
                    `<span class="skill-tag tone-${t.tone}">${t.label}</span>`
                )
                .join('')
            : `<span class="skill-tag tone-neutral">Standardized Client Response</span>`;

          const coachingHtml =
            isStudent && turn.analysis
              ? `<div class="coaching-callout">
                  <strong>HHP Faculty Rubric Note:</strong> ${turn.analysis.coachingNote}
                  ${
                    turn.analysis.suggestedRewrite
                      ? `<div style="margin-top:0.3rem; color:var(--brand-rausch-dark);"><strong>Try Saying Instead:</strong> ${turn.analysis.suggestedRewrite}</div>`
                      : ''
                  }
                </div>`
              : '';

          return `
            <div class="utterance-card speaker-${turn.speaker}">
              <div class="utterance-header">
                <span class="speaker-label">${
                  isStudent
                    ? '🎓 You (Generic U Health Coach Student)'
                    : `🧑 ${scen.client.name} (Mock Client)`
                }</span>
                <div class="skill-tags">${tagsHtml}</div>
              </div>
              <p style="margin:0; font-size:0.93rem;">"${turn.text}"</p>
              ${jevTurnBlock}
              ${coachingHtml}
            </div>
          `;
        })
        .join('');
    }

    // CHES Matrix
    document.getElementById('evalChesMatrixContent').innerHTML = `
      <p class="subtitle" style="margin-bottom:0.85rem;">
        Alignment with the National Commission for Health Education Credentialing (NCHEC / CHES) and Generic U Department of Health Education &amp; Behavior course outcomes for <strong>${scen.courseCode} (${scen.courseTitle})</strong>:
      </p>
      <ul style="font-size:0.9rem; line-height:1.6;">
        ${scen.clinicalDossier.chesCompetencies
          .map((comp) => `<li><strong>${comp}</strong> — Assessed via spoken OARS coding &amp; TTM stage progression.</li>`)
          .join('')}
        <li><strong>MITI 4.2 Relational Global (Partnership &amp; Empathy):</strong> Evaluated via Elicit-Provide-Elicit autonomy checks and absence of unsolicited prescribing.</li>
        <li><strong>MITI 4.2 Technical Global (Cultivating Change Talk):</strong> Evaluated via open-ended inquiry and readiness ruler scaling.</li>
      </ul>
    `;
  }

  bindEvaluationControls() {
    // Tab switching with hidden="until-found" support
    const accordion = document.getElementById('evalCustomAccordion');
    accordion?.querySelectorAll('.eval-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('aria-controls');
        accordion.querySelectorAll('.eval-panel').forEach((panel) => {
          if (panel.id === targetId) {
            panel.removeAttribute('hidden');
          } else if ('onbeforematch' in HTMLElement.prototype) {
            panel.setAttribute('hidden', 'until-found');
          }
        });
        accordion.querySelectorAll('.eval-tab-btn').forEach((b) => {
          b.setAttribute('aria-expanded', b === btn ? 'true' : 'false');
        });
      });
    });

    document
      .getElementById('retryScenarioBtn')
      ?.addEventListener('click', () => {
        this.startSession(this.selectedScenario);
      });

    document
      .getElementById('backToLibraryBtn')
      ?.addEventListener('click', () => {
        document.getElementById('viewEvaluation').hidden = true;
        document.getElementById('viewLibrary').hidden = false;
      });

    document.getElementById('exportReportBtn')?.addEventListener('click', () => {
      if (!this.lastEvaluation) return;
      const payload = {
        platform: 'Generic U HealthSim Studio - College of Health & Human Performance (HEB)',
        exportedAt: new Date().toISOString(),
        scenario: {
          id: this.selectedScenario.id,
          courseCode: this.selectedScenario.courseCode,
          title: this.selectedScenario.title,
          client: this.selectedScenario.client.name,
        },
        evaluation: this.lastEvaluation,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `generic-u-hhp-eval-${this.selectedScenario.id}-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new HealthSimApp();
});
