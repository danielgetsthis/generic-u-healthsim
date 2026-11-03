import { classifyStudentUtterance } from './evaluator.js';

export class VoiceSimulationEngine {
  constructor({
    onStateChange,
    onInterimSpeech,
    onTurnComplete,
    onClientMetricsUpdate,
    onLiveTranscriptUpdate,
    onError,
  }) {
    this.onStateChange = onStateChange;
    this.onInterimSpeech = onInterimSpeech;
    this.onTurnComplete = onTurnComplete;
    this.onClientMetricsUpdate = onClientMetricsUpdate;
    this.onLiveTranscriptUpdate = onLiveTranscriptUpdate;
    this.onError = onError;

    this.state = 'idle'; // 'idle' | 'listening' | 'processing' | 'client-speaking'
    this.recognition = null;
    this.synth = window.speechSynthesis || null;
    this.voices = [];
    this.activeUtterance = null;
    this.activeAudioNodes = new Set();
    this.nextPlayTime = 0;
    this.usedTopicIndices = new Set();

    // Gemini Live WebSocket (BidiGenerateContent) state
    this.liveWs = null;
    this.liveWsReady = false;
    this.liveModelName = null;
    this.liveTurnResolve = null;
    this.liveAccumulatedText = '';
    this.liveInputTranscript = '';
    this.micProcessor = null;
    this.streamingRawMicToLive = false;

    // Cached available models from user's Gemini API key
    this.availableGeminiModels = null;
    this.availableBidiModels = null;

    // Audio visualizer nodes
    this.audioCtx = null;
    this.analyser = null;
    this.ttsAnalyser = null;
    this.micStream = null;
    this.freqData = null;
    this.ttsFreqData = null;

    this.initVoices();
  }

  initVoices() {
    if (!this.synth) return;
    const load = () => {
      this.voices = this.synth.getVoices();
    };
    load();
    if (typeof this.synth.onvoiceschanged !== 'undefined') {
      this.synth.onvoiceschanged = load;
    }
  }

  setState(nextState) {
    this.state = nextState;
    this.onStateChange?.(nextState);
  }

  ensureAudioContext() {
    if (!this.audioCtx) {
      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioContextClass();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    if (!this.ttsAnalyser && this.audioCtx) {
      this.ttsAnalyser = this.audioCtx.createAnalyser();
      this.ttsAnalyser.fftSize = 128;
      this.ttsAnalyser.smoothingTimeConstant = 0.78;
      this.ttsFreqData = new Uint8Array(this.ttsAnalyser.frequencyBinCount);
      this.ttsAnalyser.connect(this.audioCtx.destination);
    }
    return this.audioCtx;
  }

  async ensureMicAnalyser() {
    if (this.analyser && this.micStream) return true;
    if (!navigator.mediaDevices?.getUserMedia) return false;
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const ctx = this.ensureAudioContext();
      const source = ctx.createMediaStreamSource(this.micStream);
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 128;
      this.analyser.smoothingTimeConstant = 0.82;
      source.connect(this.analyser);
      this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
      return true;
    } catch {
      return false;
    }
  }

  getAudioEnergy() {
    if (this.state === 'listening' && this.analyser && this.freqData) {
      this.analyser.getByteFrequencyData(this.freqData);
      let sum = 0;
      for (let i = 0; i < this.freqData.length; i++) {
        sum += this.freqData[i];
      }
      return Math.min(1, sum / (this.freqData.length * 140));
    }
    if (
      this.state === 'client-speaking' &&
      this.ttsAnalyser &&
      this.ttsFreqData &&
      this.activeAudioNodes.size > 0
    ) {
      this.ttsAnalyser.getByteFrequencyData(this.ttsFreqData);
      let sum = 0;
      for (let i = 0; i < this.ttsFreqData.length; i++) {
        sum += this.ttsFreqData[i];
      }
      const realEnergy = sum / (this.ttsFreqData.length * 120);
      if (realEnergy > 0.015) return Math.min(1, realEnergy);
    }
    if (this.state === 'client-speaking') {
      const t = performance.now() * 0.008;
      return (
        0.35 +
        0.3 * Math.sin(t) * Math.cos(t * 0.63) +
        0.15 * Math.sin(t * 2.1)
      );
    }
    return 0.04;
  }

  async discoverGeminiModels(apiKey) {
    if (this.availableGeminiModels && this.availableBidiModels) {
      return {
        rest: this.availableGeminiModels,
        bidi: this.availableBidiModels,
      };
    }
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(
          apiKey
        )}`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (!res.ok) return null;
      const data = await res.json();
      const models = data.models || [];

      const restNames = models
        .filter((m) =>
          (m.supportedGenerationMethods || []).includes('generateContent')
        )
        .map((m) => m.name.replace(/^models\//, ''));

      const bidiNames = models
        .filter((m) =>
          (m.supportedGenerationMethods || []).includes('bidiGenerateContent')
        )
        .map((m) => m.name.replace(/^models\//, ''));

      // Sort bidi models so native-audio models come first
      bidiNames.sort((a, b) => {
        const aNative = a.includes('native-audio') ? 0 : a.includes('live') ? 1 : 2;
        const bNative = b.includes('native-audio') ? 0 : b.includes('live') ? 1 : 2;
        return aNative - bNative;
      });

      this.availableGeminiModels = new Set(restNames);
      this.availableBidiModels = bidiNames;
      return {
        rest: this.availableGeminiModels,
        bidi: this.availableBidiModels,
      };
    } catch {
      return null;
    }
  }

  pickGeminiVoiceName(voiceProfile = {}) {
    if (voiceProfile.geminiVoice) return voiceProfile.geminiVoice;
    if (voiceProfile.gender === 'female') return 'Kore';
    if (voiceProfile.gender === 'male') {
      return voiceProfile.pitch && voiceProfile.pitch < 0.92
        ? 'Charon'
        : 'Puck';
    }
    return 'Aoede';
  }

  /**
   * Connects a persistent Gemini Live API (BidiGenerateContent) Native Audio WebSocket session
   */
  async connectGeminiNativeAudioSession({ scenario, apiKey }) {
    this.closeLiveSession();

    const discovered = await this.discoverGeminiModels(apiKey);
    const bidiCandidates =
      discovered?.bidi?.length > 0
        ? discovered.bidi
        : [
            'gemini-2.5-flash-native-audio-preview-12-2025',
            'gemini-2.5-flash-native-audio-preview-09-2025',
            'gemini-2.5-flash-live-001',
            'gemini-2.0-flash-live-001',
            'gemini-2.0-flash-exp',
          ];

    const c = scenario.client;
    const d = scenario.clinicalDossier;
    const voiceName = this.pickGeminiVoiceName(c.voiceProfile);

    const systemPrompt = `You are roleplaying a live spoken clinical encounter as ${c.name}, a standardized client at Generic U College of Health & Human Performance (Department of Health Education & Behavior).

YOUR CHARACTER & CLINICAL CHART:
- Full Name: ${c.name}
- Exact Age: ${c.age} years old (${c.pronouns})
- Role / Occupation: ${c.role}
- Course Scenario: ${scenario.courseCode} - ${scenario.title}
- Referral Source: ${d.referralSource}
- Chief Complaint: ${d.chiefComplaint}
- Vitals & Baseline: ${d.vitalsAndBaseline.join(' | ')}
- Psychosocial Context & Barriers: ${d.psychosocialContext}
- Transtheoretical Model Stage of Change: ${c.ttmStage}
- Opening Statement you already said: "${scenario.openingLine}"

SPOKEN CONVERSATION RULES:
1. Directly and naturally answer whatever the student health coach asks you (including your age, name, major/job, vitals, daily routine, or feelings).
2. Keep each spoken turn concise and natural (1 to 3 conversational sentences) with authentic human vocal emotion and pacing.
3. React to Motivational Interviewing skills: warm up and share deeper insights when the student uses empathy, reflections, open questions, or asks permission before giving advice. Become guarded if they lecture or command you without permission.`;

    for (const modelId of bidiCandidates) {
      const connected = await this.tryOpenBidiSocket({
        modelId,
        apiKey,
        voiceName,
        systemPrompt,
      });
      if (connected) {
        this.liveModelName = modelId;
        return modelId;
      }
    }
    return null;
  }

  tryOpenBidiSocket({ modelId, apiKey, voiceName, systemPrompt }) {
    return new Promise((resolve) => {
      const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(
        apiKey
      )}`;
      let ws;
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        resolve(false);
        return;
      }

      let settled = false;
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          try {
            ws.close();
          } catch {}
          resolve(false);
        }
      }, 4500);

      ws.onopen = () => {
        const setupPayload = {
          setup: {
            model: `models/${modelId}`,
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName,
                  },
                },
              },
            },
            systemInstruction: {
              parts: [{ text: systemPrompt }],
            },
            outputAudioTranscription: {},
          },
        };
        ws.send(JSON.stringify(setupPayload));
      };

      ws.onmessage = async (event) => {
        try {
          const raw =
            event.data instanceof Blob
              ? await event.data.text()
              : String(event.data);
          const msg = JSON.parse(raw);

          if (msg.setupComplete !== undefined) {
            if (!settled) {
              settled = true;
              clearTimeout(timeout);
              this.liveWs = ws;
              this.liveWsReady = true;
              resolve(true);
            }
            return;
          }

          this.handleBidiServerMessage(msg);
        } catch (err) {
          console.warn('Bidi message parse notice:', err);
        }
      };

      ws.onerror = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          resolve(false);
        }
      };

      ws.onclose = () => {
        if (this.liveWs === ws) {
          this.liveWs = null;
          this.liveWsReady = false;
        }
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          resolve(false);
        }
      };
    });
  }

  handleBidiServerMessage(msg) {
    const sc = msg.serverContent;
    if (!sc) return;

    // 1. Stream incoming 24kHz PCM audio chunks immediately onto Web Audio timeline
    const parts = sc.modelTurn?.parts || [];
    for (const part of parts) {
      if (part.inlineData?.data) {
        this.enqueueStreamingPcmChunk(part.inlineData.data);
      }
      if (part.text) {
        this.liveAccumulatedText += part.text;
        this.onLiveTranscriptUpdate?.(this.liveAccumulatedText.trim());
      }
    }

    // 2. Capture outputAudioTranscription text from native audio stream
    if (sc.outputTranscription?.text) {
      this.liveAccumulatedText += sc.outputTranscription.text;
      this.onLiveTranscriptUpdate?.(this.liveAccumulatedText.trim());
    }

    // 3. Capture inputAudioTranscription if streaming mic audio
    if (sc.inputTranscription?.text) {
      this.liveInputTranscript += sc.inputTranscription.text;
      this.onInterimSpeech?.(this.liveInputTranscript.trim());
    }

    // 4. Handle turn completion
    if (sc.turnComplete) {
      const finalSpokenText = this.liveAccumulatedText.trim();
      if (this.liveTurnResolve) {
        const res = this.liveTurnResolve;
        this.liveTurnResolve = null;
        res(finalSpokenText);
      }
    }
  }

  enqueueStreamingPcmChunk(base64Data) {
    try {
      const ctx = this.ensureAudioContext();
      const binaryStr = atob(base64Data);
      const int16Count = Math.floor(binaryStr.length / 2);
      if (int16Count === 0) return;

      const float32Data = new Float32Array(int16Count);
      for (let i = 0; i < int16Count; i++) {
        const low = binaryStr.charCodeAt(i * 2);
        const high = binaryStr.charCodeAt(i * 2 + 1);
        let sample = (high << 8) | low;
        if (sample >= 0x8000) sample -= 0x10000;
        float32Data[i] = sample / 32768.0;
      }

      const audioBuffer = ctx.createBuffer(1, int16Count, 24000);
      audioBuffer.getChannelData(0).set(float32Data);

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.ttsAnalyser || ctx.destination);

      const now = ctx.currentTime;
      if (this.nextPlayTime < now) {
        this.nextPlayTime = now + 0.02;
      }

      this.activeAudioNodes.add(source);
      this.setState('client-speaking');

      source.onended = () => {
        this.activeAudioNodes.delete(source);
        if (this.activeAudioNodes.size === 0 && !this.liveTurnResolve) {
          this.setState('idle');
        }
      };

      source.start(this.nextPlayTime);
      this.nextPlayTime += audioBuffer.duration;
    } catch (err) {
      console.warn('Audio chunk schedule error:', err);
    }
  }

  waitForRemainingScheduledAudio() {
    return new Promise((resolve) => {
      if (!this.audioCtx || this.activeAudioNodes.size === 0) {
        this.setState('idle');
        resolve();
        return;
      }
      const remainingMs = Math.max(
        50,
        (this.nextPlayTime - this.audioCtx.currentTime) * 1000 + 80
      );
      setTimeout(() => {
        this.setState('idle');
        resolve();
      }, Math.min(15000, remainingMs));
    });
  }

  /**
   * Sends a turn over the persistent Gemini Native Audio Live WebSocket
   * and streams the spoken audio response in real time.
   */
  async sendTurnOverGeminiLive({ textPrompt, instructExactRead = false }) {
    if (!this.liveWs || !this.liveWsReady) return null;

    this.stopCurrentAudio();
    this.setState('processing');
    this.liveAccumulatedText = '';

    const promptToSend = instructExactRead
      ? `Please say this opening statement aloud in character with natural emotion: "${textPrompt}"`
      : textPrompt;

    const spokenReply = await new Promise((resolve) => {
      this.liveTurnResolve = resolve;

      const timeout = setTimeout(() => {
        if (this.liveTurnResolve) {
          this.liveTurnResolve = null;
          resolve(this.liveAccumulatedText.trim() || null);
        }
      }, 12000);

      const origResolve = this.liveTurnResolve;
      this.liveTurnResolve = (val) => {
        clearTimeout(timeout);
        origResolve(val);
      };

      this.liveWs.send(
        JSON.stringify({
          clientContent: {
            turns: [
              {
                role: 'user',
                parts: [{ text: promptToSend }],
              },
            ],
            turnComplete: true,
          },
        })
      );
    });

    await this.waitForRemainingScheduledAudio();
    return spokenReply;
  }

  closeLiveSession() {
    if (this.liveWs) {
      try {
        this.liveWs.close();
      } catch {}
      this.liveWs = null;
      this.liveWsReady = false;
    }
  }

  stopCurrentAudio() {
    for (const node of this.activeAudioNodes) {
      try {
        node.stop();
        node.disconnect();
      } catch {}
    }
    this.activeAudioNodes.clear();
    this.nextPlayTime = 0;

    if (this.synth) {
      try {
        this.synth.cancel();
      } catch {}
    }
    this.activeUtterance = null;
  }

  async speakText(text, voiceProfile = {}, aiConfig = null) {
    this.stopListening();
    this.stopCurrentAudio();

    const rawKey = (aiConfig?.apiKey || '').trim();
    const useGemini =
      rawKey && !rawKey.startsWith('sk-') && aiConfig?.provider !== 'openai';

    // 1. If Gemini Native Audio Live WebSocket is active, speak directly via Native Audio stream!
    if (useGemini && this.liveWsReady) {
      const spoken = await this.sendTurnOverGeminiLive({
        textPrompt: text,
        instructExactRead: true,
      });
      if (spoken !== null || this.activeAudioNodes.size > 0) return;
    }

    // 2. Otherwise try Gemini REST Neural TTS (`gemini-2.5-flash-preview-tts`)
    if (useGemini) {
      const playedNeural = await this.speakWithGeminiNeuralTts(
        text,
        voiceProfile,
        rawKey
      );
      if (playedNeural) return;
    }

    // 3. Offline browser fallback
    return this.speakWithBrowserTts(text, voiceProfile);
  }

  async speakWithGeminiNeuralTts(text, voiceProfile, apiKey) {
    try {
      this.setState('client-speaking');
      const voiceName = this.pickGeminiVoiceName(voiceProfile);
      const ttsModels = [
        'gemini-2.5-flash-preview-tts',
        'gemini-2.5-pro-preview-tts',
      ];

      for (const ttsModel of ttsModels) {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${ttsModel}:generateContent?key=${encodeURIComponent(
            apiKey
          )}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(8000),
            body: JSON.stringify({
              contents: [
                {
                  parts: [{ text }],
                },
              ],
              generationConfig: {
                responseModalities: ['AUDIO'],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: { voiceName },
                  },
                },
              },
            }),
          }
        );

        if (!res.ok) continue;
        const data = await res.json();
        const inlineData =
          data?.candidates?.[0]?.content?.parts?.[0]?.inlineData;
        if (!inlineData?.data) continue;

        this.enqueueStreamingPcmChunk(inlineData.data);
        await this.waitForRemainingScheduledAudio();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  pickClientVoice(voiceProfile = {}) {
    if (!this.voices || this.voices.length === 0) {
      this.voices = this.synth ? this.synth.getVoices() : [];
    }
    const enVoices = this.voices.filter((v) => /^en(-|_)/i.test(v.lang));
    const pool = enVoices.length > 0 ? enVoices : this.voices;
    if (pool.length === 0) return null;

    const femaleHints =
      /(natural|enhanced|premium|google us english|samantha|ava|victoria|karen|moira|tessa|allison)/i;
    const maleHints =
      /(natural|enhanced|premium|google uk english male|alex|daniel|tom|aaron|david|mark)/i;

    if (voiceProfile.gender === 'female') {
      const match = pool.find((v) => femaleHints.test(v.name));
      if (match) return match;
    } else if (voiceProfile.gender === 'male') {
      const match = pool.find((v) => maleHints.test(v.name));
      if (match) return match;
    }
    return pool[0];
  }

  speakWithBrowserTts(text, voiceProfile = {}) {
    return new Promise((resolve) => {
      if (!this.synth) {
        this.setState('client-speaking');
        setTimeout(() => {
          this.setState('idle');
          resolve();
        }, Math.min(4000, Math.max(1500, text.length * 35)));
        return;
      }

      setTimeout(() => {
        try {
          this.synth.resume();
        } catch {}

        const utter = new SpeechSynthesisUtterance(text);
        this.activeUtterance = utter;
        const chosenVoice = this.pickClientVoice(voiceProfile);
        if (chosenVoice) utter.voice = chosenVoice;
        utter.pitch = voiceProfile.pitch || 1.0;
        utter.rate = voiceProfile.rate || 1.0;

        this.setState('client-speaking');

        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          this.activeUtterance = null;
          this.setState('idle');
          resolve();
        };

        const watchdog = setTimeout(finish, Math.max(3500, text.length * 75));
        utter.onend = () => {
          clearTimeout(watchdog);
          finish();
        };
        utter.onerror = () => {
          clearTimeout(watchdog);
          finish();
        };

        this.synth.speak(utter);
      }, 50);
    });
  }

  startListening({ onSpokenResult }) {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      this.onError?.(
        'Browser Web Speech API (SpeechRecognition) is not supported in this browser. Use Chrome, Edge, or Safari, or click any Clinical Cue Card below to simulate speaking a turn.'
      );
      return false;
    }

    this.stopCurrentAudio();
    this.ensureMicAnalyser();

    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch {}
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.maxAlternatives = 1;

    let accumulatedFinal = '';
    let latestInterim = '';
    let silenceTimer = null;
    let committed = false;

    const commitSpeech = () => {
      if (committed) return;
      clearTimeout(silenceTimer);
      const fullSpoken = (accumulatedFinal + ' ' + latestInterim).trim();
      if (fullSpoken) {
        committed = true;
        try {
          recognition.stop();
        } catch {}
        onSpokenResult(fullSpoken);
      } else {
        this.setState('idle');
      }
    };

    recognition.onstart = () => {
      this.setState('listening');
    };

    recognition.onresult = (event) => {
      latestInterim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        if (res.isFinal) {
          accumulatedFinal += ' ' + res[0].transcript;
        } else {
          latestInterim += res[0].transcript;
        }
      }
      const preview = (accumulatedFinal + ' ' + latestInterim).trim();
      this.onInterimSpeech?.(preview);

      clearTimeout(silenceTimer);
      if (preview.split(/\s+/).length >= 2) {
        silenceTimer = setTimeout(() => {
          commitSpeech();
        }, 1500);
      }
    };

    recognition.onerror = (event) => {
      clearTimeout(silenceTimer);
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        this.onError?.(`Microphone recognition notice: ${event.error}`);
      }
      if (this.state === 'listening' && !committed) {
        this.setState('idle');
      }
    };

    recognition.onend = () => {
      clearTimeout(silenceTimer);
      if (committed) return;
      const remaining = (accumulatedFinal + ' ' + latestInterim).trim();
      if (remaining) {
        committed = true;
        onSpokenResult(remaining);
      } else if (this.state === 'listening') {
        this.setState('idle');
      }
    };

    this.recognition = recognition;
    this.commitCurrentSpeech = commitSpeech;
    try {
      recognition.start();
      return true;
    } catch {
      this.setState('idle');
      return false;
    }
  }

  finishListeningAndSend() {
    if (this.state === 'listening' && this.commitCurrentSpeech) {
      this.commitCurrentSpeech();
    } else {
      this.stopListening();
    }
  }

  stopListening() {
    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch {}
      this.recognition = null;
    }
    if (this.state === 'listening') {
      this.setState('idle');
    }
  }

  destroy() {
    this.stopListening();
    this.stopCurrentAudio();
    this.closeLiveSession();
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
  }

  /**
   * Handles a student turn. If the Gemini Native Audio Live WebSocket (`BidiGenerateContent`)
   * is connected, it streams the native audio response directly with sub-second latency!
   */
  async generateClientResponse({
    scenario,
    transcript,
    studentText,
    currentRapport,
    aiConfig,
    jevTurnResult = null,
  }) {
    this.stopCurrentAudio();
    this.setState('processing');

    const rawKey = (aiConfig?.apiKey || '').trim();
    const isOpenAIKey = rawKey.startsWith('sk-');
    const effectiveProvider = rawKey
      ? aiConfig?.provider === 'openai' || isOpenAIKey
        ? 'openai'
        : 'gemini'
      : aiConfig?.provider || 'local';

    const steeredText = jevTurnResult?.steeringDirective
      ? `${jevTurnResult.steeringDirective}\nStudent Coach said: "${studentText}"`
      : studentText;

    // 1. Try Gemini Native Audio Live WebSocket (BidiGenerateContent) first!
    if (effectiveProvider === 'gemini' && rawKey) {
      if (!this.liveWsReady) {
        await this.connectGeminiNativeAudioSession({
          scenario,
          apiKey: rawKey,
        });
      }

      if (this.liveWsReady) {
        const spokenReply = await this.sendTurnOverGeminiLive({
          textPrompt: steeredText,
          instructExactRead: false,
        });

        if (spokenReply) {
          let delta = 3;
          let affectLabel = `Native Audio Live (${this.liveModelName})`;

          if (jevTurnResult) {
            delta = jevTurnResult.rapportDelta;
            const routeChoice =
              jevTurnResult.questions?.client_state_route?.choice || 'engaged';
            affectLabel = `Jev Route: ${routeChoice.replace(/_/g, ' ')} (${
              this.liveModelName
            })`;
          } else {
            const utteranceEval = classifyStudentUtterance(studentText);
            const hasRighting = utteranceEval.tags.some(
              (t) => t.id === 'righting-reflex'
            );
            const hasPositive = utteranceEval.tags.some((t) =>
              [
                'open-question',
                'reflection',
                'affirmation',
                'elicit-permission',
                'smart-goal',
              ].includes(t.id)
            );
            delta = hasRighting ? -10 : hasPositive ? 9 : 3;
          }

          const nextRapport = Math.max(
            10,
            Math.min(100, currentRapport + delta)
          );

          return {
            reply: spokenReply,
            affect: affectLabel,
            rapport: nextRapport,
            alreadySpokenByLiveAudio: true,
          };
        }
      }

      // 2. Fallback to REST Gemini Flash + Neural TTS
      try {
        const result = await this.callGeminiRestClient({
          scenario,
          transcript,
          studentText: steeredText,
          currentRapport,
          apiKey: rawKey,
          preferredModel: aiConfig?.geminiModel || 'auto-fast',
        });
        if (result) return result;
      } catch (err) {
        this.onError?.(`Gemini API Notice: ${err.message}`);
      }
    } else if (effectiveProvider === 'openai' && rawKey) {
      try {
        const result = await this.callOpenAIClient({
          scenario,
          transcript,
          studentText: steeredText,
          currentRapport,
          apiKey: rawKey,
        });
        if (result) return result;
      } catch (err) {
        this.onError?.(`OpenAI API Notice: ${err.message}`);
      }
    }

    const localResult = this.runLocalClinicalBrain({
      scenario,
      studentText,
      currentRapport,
    });
    if (jevTurnResult) {
      localResult.rapport = Math.max(
        10,
        Math.min(100, currentRapport + jevTurnResult.rapportDelta)
      );
      localResult.affect = `Jev Route: ${jevTurnResult.questions.client_state_route.choice.replace(
        /_/g,
        ' '
      )}`;
    }
    return localResult;
  }

  async callGeminiRestClient({
    scenario,
    transcript,
    studentText,
    currentRapport,
    apiKey,
  }) {
    const c = scenario.client;
    const d = scenario.clinicalDossier;
    const discovered = await this.discoverGeminiModels(apiKey);
    const restSet = discovered?.rest;

    const candidates = [
      'gemini-2.5-flash',
      'gemini-3-flash-preview',
      'gemini-2.0-flash',
    ].filter((m) => !restSet || restSet.has(m));
    if (candidates.length === 0) candidates.push('gemini-2.5-flash');

    const systemPrompt = `You are roleplaying as ${c.name} (Age: ${c.age}, Pronouns: ${c.pronouns}, Role: ${c.role}) in a Generic U Health Education & Behavior encounter.
Chief Complaint: ${d.chiefComplaint}
Vitals/Baseline: ${d.vitalsAndBaseline.join(' | ')}
Psychosocial Context: ${d.psychosocialContext}
Current Rapport: ${currentRapport}/100.
Directly answer whatever the student asks in character (1-3 spoken sentences). Return JSON: {"reply": "spoken string", "affect": "short state", "rapportDelta": number}.`;

    const priorTurns = transcript.slice(0, -1).slice(-8);
    const contents = priorTurns.map((t) => ({
      role: t.speaker === 'student' ? 'user' : 'model',
      parts: [
        {
          text:
            t.speaker === 'student'
              ? t.text
              : JSON.stringify({
                  reply: t.text,
                  affect: c.initialAffect,
                  rapportDelta: 0,
                }),
        },
      ],
    }));
    while (contents.length > 0 && contents[0].role !== 'user') {
      contents.shift();
    }
    contents.push({ role: 'user', parts: [{ text: studentText }] });

    for (const modelId of candidates) {
      try {
        const generationConfig = {
          responseMimeType: 'application/json',
          temperature: 0.65,
        };
        if (modelId.startsWith('gemini-2.5-flash')) {
          generationConfig.thinkingConfig = { thinkingBudget: 0 };
        }

        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${encodeURIComponent(
            apiKey
          )}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(7000),
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: systemPrompt }] },
              contents,
              generationConfig,
            }),
          }
        );

        if (!response.ok) continue;
        const data = await response.json();
        const parts = data?.candidates?.[0]?.content?.parts || [];
        const textPart =
          parts.find(
            (p) => typeof p.text === 'string' && p.text.trim().startsWith('{')
          ) || parts[parts.length - 1];
        if (!textPart?.text) continue;

        const parsed = JSON.parse(
          textPart.text
            .replace(/^```json\s*/i, '')
            .replace(/```\s*$/i, '')
            .trim()
        );
        return {
          reply: parsed.reply,
          affect: `${parsed.affect || 'Engaged'} (${modelId})`,
          rapport: Math.max(
            10,
            Math.min(100, currentRapport + (Number(parsed.rapportDelta) || 4))
          ),
          alreadySpokenByLiveAudio: false,
        };
      } catch {
        // try next
      }
    }
    throw new Error('Gemini REST fallback failed');
  }

  async callOpenAIClient({
    scenario,
    transcript,
    studentText,
    currentRapport,
    apiKey,
  }) {
    const c = scenario.client;
    const d = scenario.clinicalDossier;
    const systemPrompt = `You are roleplaying as ${c.name} (Age: ${c.age}, Pronouns: ${c.pronouns}, Role: ${c.role}) in a Generic U College of Health & Human Performance (HEB) voice simulation.
Chief Complaint: ${d.chiefComplaint}
Vitals/Baseline: ${d.vitalsAndBaseline.join(' | ')}
Psychosocial Context: ${d.psychosocialContext}
Current Rapport (0-100): ${currentRapport}
Directly answer whatever the student asks in character (1-3 spoken sentences). Respond in JSON: {"reply": "spoken response", "affect": "short emotional state", "rapportDelta": number -15 to 16}.`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({
        model: 'gpt-4o',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          ...transcript.slice(0, -1).slice(-8).map((t) => ({
            role: t.speaker === 'student' ? 'user' : 'assistant',
            content: t.text,
          })),
          { role: 'user', content: studentText },
        ],
      }),
    });

    if (!response.ok) throw new Error(`OpenAI HTTP ${response.status}`);
    const data = await response.json();
    const parsed = JSON.parse(data.choices[0].message.content);
    return {
      reply: parsed.reply,
      affect: `${parsed.affect || 'Engaged'} (gpt-4o)`,
      rapport: Math.max(
        10,
        Math.min(100, currentRapport + (Number(parsed.rapportDelta) || 5))
      ),
      alreadySpokenByLiveAudio: false,
    };
  }

  runLocalClinicalBrain({ scenario, studentText, currentRapport }) {
    const brain = scenario.simulationBrain;
    const c = scenario.client;
    const d = scenario.clinicalDossier;
    const lower = studentText.toLowerCase();
    const utteranceEval = classifyStudentUtterance(studentText);

    if (/\b(how old|your age|what age|age are you)\b/i.test(lower)) {
      return {
        reply: `I'm ${c.age} years old.`,
        affect: 'Answering Intake Question (Offline Mode)',
        rapport: Math.min(95, currentRapport + 2),
      };
    }
    if (/\b(your name|who are you)\b/i.test(lower)) {
      return {
        reply: `My name is ${c.name}. I'm a ${c.age}-year-old ${c.role}.`,
        affect: 'Answering Intake Question (Offline Mode)',
        rapport: Math.min(95, currentRapport + 2),
      };
    }
    if (
      /\b(what do you do|your major|your job|work|occupation|study)\b/i.test(
        lower
      )
    ) {
      return {
        reply: `I'm a ${c.role}. ${d.psychosocialContext}`,
        affect: 'Sharing Background (Offline Mode)',
        rapport: Math.min(95, currentRapport + 4),
      };
    }

    const hitDefensiveTrigger = brain.defensiveTriggers.some((trig) =>
      lower.includes(trig)
    );
    const hasRightingReflexTag = utteranceEval.tags.some(
      (t) => t.id === 'righting-reflex'
    );

    if (hitDefensiveTrigger || hasRightingReflexTag) {
      const defReply =
        brain.defensiveResponses[
          Math.floor(Math.random() * brain.defensiveResponses.length)
        ];
      const nextRapport = Math.max(15, currentRapport - 12);
      return {
        reply: defReply,
        affect: 'Defensive & Guarded (Reactance Triggered)',
        rapport: nextRapport,
      };
    }

    let matchedIndex = -1;
    let bestOverlap = 0;

    brain.topicResponses.forEach((topic, idx) => {
      const hits = topic.keywords.filter((kw) => lower.includes(kw)).length;
      if (hits > 0) {
        const score = hits + (this.usedTopicIndices.has(idx) ? 0 : 2);
        if (score > bestOverlap) {
          bestOverlap = score;
          matchedIndex = idx;
        }
      }
    });

    if (matchedIndex !== -1) {
      this.usedTopicIndices.add(matchedIndex);
      const chosen = brain.topicResponses[matchedIndex];
      const bonus = utteranceEval.tags.some(
        (t) => t.id === 'reflection' || t.id === 'affirmation'
      )
        ? 4
        : 0;
      const nextRapport = Math.min(
        98,
        currentRapport + chosen.rapportDelta + bonus
      );
      return {
        reply: chosen.response,
        affect: chosen.affect,
        rapport: nextRapport,
      };
    }

    const isOpenOrReflective = utteranceEval.tags.some((t) =>
      [
        'open-question',
        'reflection',
        'affirmation',
        'elicit-permission',
      ].includes(t.id)
    );

    if (isOpenOrReflective) {
      return {
        reply: brain.fallbackOpenResponse,
        affect: 'Reflective & Engaged (Offline Mode)',
        rapport: Math.min(95, currentRapport + 6),
      };
    }

    return {
      reply: brain.fallbackClosedResponse,
      affect: 'Waiting for Open Inquiry (Offline Mode)',
      rapport: Math.max(20, currentRapport - 2),
    };
  }
}
