(function () {
  "use strict";

  const KEYS = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
  const SCALES = [
    { name: "Major", intervals: [0, 2, 4, 5, 7, 9, 11] },
    { name: "Natural Minor", intervals: [0, 2, 3, 5, 7, 8, 10] },
    { name: "Major Pentatonic", intervals: [0, 2, 4, 7, 9] },
    { name: "Minor Pentatonic", intervals: [0, 3, 5, 7, 10] },
    { name: "Blues", intervals: [0, 3, 5, 6, 7, 10] },
    { name: "Dorian", intervals: [0, 2, 3, 5, 7, 9, 10] },
    { name: "Mixolydian", intervals: [0, 2, 4, 5, 7, 9, 10] },
  ];
  const MODES = [{ name: "FullScale" }, { name: "RootsOnly" }, { name: "AllMapped" }];
  const STRINGS = [
    { name: "E2", midi: 40 },
    { name: "A2", midi: 45 },
    { name: "D3", midi: 50 },
    { name: "G3", midi: 55 },
    { name: "B3", midi: 59 },
    { name: "E4", midi: 64 },
  ];
  const SCALE_TEMPLATES = [
    { name: "Major", scaleIndex: 0, intervals: SCALES[0].intervals },
    { name: "Natural Minor", scaleIndex: 1, intervals: SCALES[1].intervals },
    { name: "Major Pentatonic", scaleIndex: 2, intervals: SCALES[2].intervals },
    { name: "Minor Pentatonic", scaleIndex: 3, intervals: SCALES[3].intervals },
  ];

  const MIN_FREQUENCY = 70;
  const MAX_FREQUENCY = 1200;
  const RMS_THRESHOLD = 0.012;
  const MIN_CONFIDENCE = 0.55;
  const DETECTION_WINDOW_MS = 3000;
  const FRAME_INTERVAL_MS = 50;
  const AUDIO_FFT_SIZE = 4096;
  const MIN_CONFIDENT_FRAMES = 6;
  const MIN_ROOT_SUPPORT = 0.2;
  const MIN_SCALE_DISTINCT_PCS = 3;
  const SCALE_SCORE_THRESHOLD = 0.64;
  const SCALE_SCORE_GAP = 0.08;
  const CONTINUOUS_STABLE_FRAMES = 12;
  const CONTINUOUS_COMMIT_COOLDOWN_MS = 1800;
  const RAW_SERIAL_LOG_LIMIT = 24;
  const SERIAL_BUFFER_LIMIT = 16000;

  const state = {
    key: 9,
    keyName: "A",
    scale: 4,
    scaleName: "Blues",
    mode: 0,
    modeName: "FullScale",
    brightness: 8,
    enabled: 1,
    audioTrigger: 0,
    source: "Manual",
    lastAudioDetection: "None",
  };

  const elements = {
    connectButton: document.getElementById("connectButton"),
    disconnectButton: document.getElementById("disconnectButton"),
    connectionStatus: document.getElementById("connectionStatus"),
    supportWarning: document.getElementById("supportWarning"),
    lastSerialUpdate: document.getElementById("lastSerialUpdate"),
    serialParseStatus: document.getElementById("serialParseStatus"),
    serialParseChip: document.getElementById("serialParseChip"),
    lastLine: document.getElementById("lastLine"),
    lastRaw: document.getElementById("lastRaw"),
    lastParsed: document.getElementById("lastParsed"),
    parseError: document.getElementById("parseError"),
    fretboard: document.getElementById("fretboard"),
    stateKey: document.getElementById("stateKey"),
    stateScale: document.getElementById("stateScale"),
    stateMode: document.getElementById("stateMode"),
    stateEnabled: document.getElementById("stateEnabled"),
    stateSource: document.getElementById("stateSource"),
    stateLastAudioDetection: document.getElementById("stateLastAudioDetection"),
    manualKey: document.getElementById("manualKey"),
    manualScale: document.getElementById("manualScale"),
    manualMode: document.getElementById("manualMode"),
    manualBrightness: document.getElementById("manualBrightness"),
    manualBrightnessValue: document.getElementById("manualBrightnessValue"),
    manualEnabled: document.getElementById("manualEnabled"),
    applyManual: document.getElementById("applyManual"),
    voiceModeToggle: document.getElementById("voiceModeToggle"),
    startMicButton: document.getElementById("startMicButton"),
    audioCard: document.getElementById("audioCard"),
    recordAudioButton: document.getElementById("recordAudioButton"),
    continuousListenButton: document.getElementById("continuousListenButton"),
    detectionMode: document.getElementById("detectionMode"),
    audioDeviceSelect: document.getElementById("audioDeviceSelect"),
    audioStatus: document.getElementById("audioStatus"),
    detectedNote: document.getElementById("detectedNote"),
    detectedFrequency: document.getElementById("detectedFrequency"),
    audioConfidence: document.getElementById("audioConfidence"),
    audioSourceLabel: document.getElementById("audioSourceLabel"),
    topCandidate: document.getElementById("topCandidate"),
    runnerUpCandidate: document.getElementById("runnerUpCandidate"),
    lastAudioTrigger: document.getElementById("lastAudioTrigger"),
    audioFrameSummary: document.getElementById("audioFrameSummary"),
    histogramDebug: document.getElementById("histogramDebug"),
    candidateDebug: document.getElementById("candidateDebug"),
  };

  let port = null;
  let reader = null;
  let keepReading = false;
  let readLoopPromise = null;
  let serialTextBuffer = "";
  const rawSerialLog = [];

  let audioContext = null;
  let audioStream = null;
  let audioSource = null;
  let analyser = null;
  let audioBuffer = null;
  let isRecordingAudio = false;
  let continuousListening = false;
  let continuousAnimationId = null;
  let lastAudioFrameTime = 0;
  let stablePitchClass = null;
  let stableFrameCount = 0;
  let lastContinuousCommitTime = 0;
  let lastAudioTriggerSeen = 0;
  let voiceModeEnabled = false;
  const lastDaisyPodState = {
    key: null,
    scale: null,
    mode: null,
    enabled: null,
    brightness: null,
  };

  function clampInteger(value, min, max, fallback) {
    const number = Number.parseInt(value, 10);
    if (!Number.isFinite(number)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, number));
  }

  function pitchClassToName(pc) {
    return KEYS[((pc % 12) + 12) % 12];
  }

  function refreshStateNames() {
    state.keyName = pitchClassToName(state.key);
    state.scaleName = SCALES[state.scale].name;
    state.modeName = MODES[state.mode].name;
  }

  function pitchClassForPosition(openMidi, fretNumber) {
    return (openMidi + fretNumber) % 12;
  }

  function isInScale(pitchClass) {
    const relative = (pitchClass - state.key + 12) % 12;
    return SCALES[state.scale].intervals.includes(relative);
  }

  function noteClassForPitch(pitchClass) {
    if (!state.enabled) {
      return "off";
    }
    if (state.mode === 2) {
      return "neutral";
    }
    if (pitchClass === state.key) {
      return "root";
    }
    if (state.mode === 0 && isInScale(pitchClass)) {
      return "scale";
    }
    return "off";
  }

  function createCell(className, text) {
    const cell = document.createElement("div");
    cell.className = className;
    cell.textContent = text;
    return cell;
  }

  function renderFretboard() {
    const fragment = document.createDocumentFragment();
    fragment.appendChild(createCell("fret-label corner", "String"));

    for (let fret = 1; fret <= 12; fret += 1) {
      fragment.appendChild(createCell("fret-label", String(fret)));
    }

    STRINGS.forEach((stringInfo) => {
      fragment.appendChild(createCell("string-label", stringInfo.name));

      for (let fret = 1; fret <= 12; fret += 1) {
        const pitchClass = pitchClassForPosition(stringInfo.midi, fret);
        const noteClass = noteClassForPitch(pitchClass);
        const cell = document.createElement("div");
        const dot = document.createElement("span");

        cell.className = "fret-cell";
        dot.className = `note-dot ${noteClass}`;
        dot.textContent = noteClass === "off" ? "" : pitchClassToName(pitchClass);
        dot.setAttribute("aria-label", `${stringInfo.name} fret ${fret}: ${pitchClassToName(pitchClass)}`);

        cell.appendChild(dot);
        fragment.appendChild(cell);
      }
    });

    elements.fretboard.replaceChildren(fragment);
    elements.fretboard.classList.toggle("disabled", !state.enabled);
  }

  function renderState() {
    refreshStateNames();
    elements.stateKey.textContent = state.keyName;
    elements.stateScale.textContent = state.scaleName;
    elements.stateMode.textContent = state.modeName;
    elements.stateEnabled.textContent = state.enabled ? "On" : "Off";
    elements.stateSource.textContent = state.source;
    elements.audioSourceLabel.textContent = state.source;
    elements.stateLastAudioDetection.textContent = state.lastAudioDetection;
    elements.manualBrightnessValue.textContent = String(state.brightness);
    const enabledChip = elements.stateEnabled.closest(".enabled-chip");
    const sourceChip = elements.stateSource.closest(".source-chip");

    if (enabledChip) {
      enabledChip.dataset.enabled = String(state.enabled);
    }

    if (sourceChip) {
      sourceChip.dataset.source = state.source.toLowerCase();
    }
  }

  function renderAll() {
    renderState();
    renderFretboard();
  }

  function syncManualControls() {
    elements.manualKey.value = String(state.key);
    elements.manualScale.value = String(state.scale);
    elements.manualMode.value = String(state.mode);
    elements.manualBrightness.value = String(state.brightness);
    elements.manualEnabled.checked = Boolean(state.enabled);
    elements.manualBrightnessValue.textContent = String(state.brightness);
  }

  function setSerialStatus(message, type) {
    elements.connectionStatus.textContent = message;
    elements.connectionStatus.title = message;
    const chip = elements.connectionStatus.closest(".status-chip");
    if (chip) {
      chip.classList.toggle("connected", type === "connected");
      chip.classList.toggle("error", type === "error");
      chip.title = message;
    }
  }

  function formatSerialTime(date) {
    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function sanitizeSerialForDisplay(text) {
    return text.replace(/\r/g, "\\r").replace(/\n/g, "\\n");
  }

  function noteSerialActivity() {
    if (elements.lastSerialUpdate) {
      elements.lastSerialUpdate.textContent = formatSerialTime(new Date());
    }
  }

  function setSerialParseStatus(status, message) {
    if (elements.serialParseStatus) {
      elements.serialParseStatus.textContent = message;
    }
    if (elements.serialParseChip) {
      elements.serialParseChip.dataset.status = status;
    }
  }

  function appendRawSerialLog(rawText) {
    const trimmed = sanitizeSerialForDisplay(rawText).trim();
    if (!trimmed) {
      return;
    }

    noteSerialActivity();
    elements.lastLine.textContent = trimmed;
    rawSerialLog.unshift(`[${formatSerialTime(new Date())}] ${trimmed}`);
    rawSerialLog.splice(RAW_SERIAL_LOG_LIMIT);
    elements.lastRaw.textContent = rawSerialLog.join("\n");
  }

  function setSerialParseError(message) {
    elements.parseError.textContent = message;
    setSerialParseStatus("fail", "Parse failed");
  }

  function clearSerialParseError() {
    elements.parseError.textContent = "None";
    setSerialParseStatus("ok", "JSON OK");
  }

  function showSerialHelp(message) {
    if (!elements.supportWarning) {
      return;
    }
    elements.supportWarning.textContent = message;
    elements.supportWarning.hidden = false;
  }

  function hideSerialHelp() {
    if (!elements.supportWarning) {
      return;
    }
    elements.supportWarning.hidden = true;
  }

  function describeSerialOpenError(error) {
    const name = error && error.name ? error.name : "SerialError";
    const message = error && error.message ? error.message : String(error);
    const lowerMessage = message.toLowerCase();

    if (name === "NotFoundError") {
      return {
        short: "No port selected",
        detail: "No DaisyPod port was selected. Click Connect DaisyPod again and choose the usbmodem DaisyPod port.",
      };
    }

    if (
      name === "NetworkError" ||
      name === "InvalidStateError" ||
      lowerMessage.includes("busy") ||
      lowerMessage.includes("failed to open") ||
      lowerMessage.includes("already open") ||
      lowerMessage.includes("access denied")
    ) {
      return {
        short: "Port busy",
        detail:
          "DaisyPod port is busy or blocked. Close Terminal, screen, Arduino Serial Monitor, or any other serial app using /dev/tty.usbmodem, then click Connect DaisyPod again.",
      };
    }

    if (name === "SecurityError") {
      return {
        short: "Use localhost",
        detail: "Web Serial needs Chrome or Edge on localhost/HTTPS. Run python3 -m http.server 8000 and open http://localhost:8000/visualizer.html.",
      };
    }

    return {
      short: "Connection failed",
      detail: `${name}: ${message}`,
    };
  }

  function setAudioStatus(message, type) {
    elements.audioStatus.textContent = message;
    elements.audioStatus.classList.toggle("audio-ok", type === "ok");
    elements.audioStatus.classList.toggle("audio-error", type === "error");
    if (elements.audioCard) {
      elements.audioCard.classList.toggle("mic-error", type === "error" && !isRecordingAudio);
      elements.audioCard.classList.toggle("mic-ready", type === "ok" && !isRecordingAudio);
    }
  }

  function renderVoiceMode() {
    if (!elements.voiceModeToggle) {
      return;
    }

    elements.voiceModeToggle.textContent = voiceModeEnabled ? "Voice Mode On" : "Voice Mode Off";
    elements.voiceModeToggle.setAttribute("aria-pressed", String(voiceModeEnabled));
    elements.voiceModeToggle.classList.toggle("active", voiceModeEnabled);
  }

  function updateState(nextState, sourceLabel) {
    state.key = clampInteger(nextState.key, 0, 11, state.key);
    state.scale = clampInteger(nextState.scale, 0, 6, state.scale);
    state.mode = clampInteger(nextState.mode, 0, 2, state.mode);
    state.brightness = clampInteger(nextState.brightness, 1, 30, state.brightness);
    state.enabled = clampInteger(nextState.enabled, 0, 1, state.enabled);
    state.audioTrigger = clampInteger(nextState.audioTrigger, 0, 999999, state.audioTrigger);
    if (sourceLabel) {
      state.source = sourceLabel;
    }
    renderAll();
    if (sourceLabel === "DaisyPod") {
      syncManualControls();
    }
  }

  function populateSelect(select, options, getLabel) {
    const fragment = document.createDocumentFragment();
    select.replaceChildren();
    options.forEach((option, index) => {
      const item = document.createElement("option");
      item.value = String(index);
      item.textContent = getLabel(option, index);
      fragment.appendChild(item);
    });
    select.appendChild(fragment);
  }

  function applyManualControls() {
    updateState(
      {
        key: elements.manualKey.value,
        scale: elements.manualScale.value,
        mode: elements.manualMode.value,
        brightness: elements.manualBrightness.value,
        enabled: elements.manualEnabled.checked ? 1 : 0,
        audioTrigger: state.audioTrigger,
      },
      "Manual"
    );
  }

  function setupManualControls() {
    populateSelect(elements.manualKey, KEYS, (name) => name);
    populateSelect(elements.manualScale, SCALES, (scale) => scale.name);
    populateSelect(elements.manualMode, MODES, (mode) => mode.name);
    elements.applyManual.addEventListener("click", applyManualControls);
    elements.manualBrightness.addEventListener("input", () => {
      elements.manualBrightnessValue.textContent = elements.manualBrightness.value;
      applyManualControls();
    });
    [elements.manualKey, elements.manualScale, elements.manualMode, elements.manualEnabled].forEach((control) => {
      control.addEventListener("change", applyManualControls);
    });
    syncManualControls();
  }

  function readBoundedSerialInt(parsed, field, min, max) {
    if (!Object.prototype.hasOwnProperty.call(parsed, field)) {
      return null;
    }
    return clampInteger(parsed[field], min, max, null);
  }

  function applyDaisyPodState(parsed) {
    const incoming = {
      key: readBoundedSerialInt(parsed, "key", 0, 11),
      scale: readBoundedSerialInt(parsed, "scale", 0, 6),
      mode: readBoundedSerialInt(parsed, "mode", 0, 2),
      enabled: readBoundedSerialInt(parsed, "enabled", 0, 1),
      brightness: readBoundedSerialInt(parsed, "brightness", 1, 30),
    };
    const nextState = {
      key: state.key,
      scale: state.scale,
      mode: state.mode,
      enabled: state.enabled,
      brightness: state.brightness,
      audioTrigger: state.audioTrigger,
    };
    let hasStateField = false;

    Object.keys(incoming).forEach((field) => {
      const value = incoming[field];
      if (value === null) {
        return;
      }
      lastDaisyPodState[field] = value;
      nextState[field] = value;
      hasStateField = true;
    });

    if (Number.isFinite(Number(parsed.audioTrigger))) {
      nextState.audioTrigger = clampInteger(parsed.audioTrigger, 0, 999999, state.audioTrigger);
    }

    if (hasStateField) {
      updateState(nextState, "DaisyPod");
    } else {
      state.audioTrigger = nextState.audioTrigger;
    }
  }

  function handleAudioTriggerFromDaisy(audioTrigger) {
    const triggerCount = clampInteger(audioTrigger, 0, 999999, lastAudioTriggerSeen + 1);

    if (triggerCount <= lastAudioTriggerSeen) {
      return;
    }

    lastAudioTriggerSeen = triggerCount;
    state.audioTrigger = triggerCount;
    elements.lastAudioTrigger.textContent = String(triggerCount);

    if (!voiceModeEnabled) {
      setAudioStatus("SW2 received. Voice Mode is off, so DaisyPod mode control stays normal.", "ok");
      return;
    }

    if (!analyser) {
      setAudioStatus("SW2 received. Click Start Microphone first, or turn Voice Mode off.", "error");
      return;
    }

    if (isRecordingAudio) {
      setAudioStatus("Already listening.", "error");
      return;
    }

    recordAndDetect("DaisyPod SW2").catch((error) => {
      setAudioStatus(error instanceof Error ? error.message : String(error), "error");
    });
  }

  function hasSerialStateFields(parsed) {
    return ["key", "scale", "mode", "enabled", "brightness"].some((field) =>
      Object.prototype.hasOwnProperty.call(parsed, field)
    );
  }

  function normalizeSerialChunk(text) {
    return text.replace(/\0/g, "").replace(/\r/g, "\n").replace(/\$+/g, "\n");
  }

  function findFirstBalancedJson(text) {
    const start = text.indexOf("{");
    if (start === -1) {
      return null;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < text.length; index += 1) {
      const char = text[index];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === "\"") {
          inString = false;
        }
        continue;
      }

      if (char === "\"") {
        inString = true;
      } else if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          return {
            start,
            end: index + 1,
            record: text.slice(start, index + 1),
          };
        }
      }
    }

    return {
      start,
      end: -1,
      record: null,
    };
  }

  function repairMaybeTruncatedJson(record) {
    const firstBrace = record.indexOf("{");
    if (firstBrace === -1) {
      return null;
    }

    let candidate = record.slice(firstBrace).trim().replace(/\$+$/g, "").trim();
    const lastBrace = candidate.lastIndexOf("}");

    if (lastBrace !== -1) {
      return candidate.slice(0, lastBrace + 1);
    }

    const looksLikeState =
      candidate.includes("\"key\"") ||
      candidate.includes("\"scale\"") ||
      candidate.includes("\"mode\"") ||
      candidate.includes("\"enabled\"") ||
      candidate.includes("\"audioTrigger\"");

    if (!looksLikeState) {
      return null;
    }

    candidate = candidate.replace(/,\s*$/, "").trim();
    return `${candidate}}`;
  }

  function parseSerialCandidate(candidate) {
    try {
      const parsed = JSON.parse(candidate);
      elements.lastParsed.textContent = JSON.stringify(parsed, null, 2);
      clearSerialParseError();
      handleParsedSerialObject(parsed);
    } catch (error) {
      setSerialParseError(error instanceof Error ? error.message : String(error));
    }
  }

  function processSerialRecord(record) {
    const trimmed = record.trim();

    if (!trimmed) {
      return;
    }

    appendRawSerialLog(trimmed);

    const balanced = findFirstBalancedJson(trimmed);
    if (balanced && balanced.record) {
      let cursor = trimmed;
      while (cursor.trim()) {
        const next = findFirstBalancedJson(cursor);
        if (!next || !next.record) {
          const repair = repairMaybeTruncatedJson(cursor);
          if (repair) {
            parseSerialCandidate(repair);
          } else if (cursor.trim().includes("{")) {
            setSerialParseError(`Incomplete JSON: ${sanitizeSerialForDisplay(cursor.trim())}`);
          }
          break;
        }

        parseSerialCandidate(next.record);
        cursor = cursor.slice(next.end);
      }
      return;
    }

    const repaired = repairMaybeTruncatedJson(trimmed);
    if (repaired) {
      parseSerialCandidate(repaired);
    } else if (trimmed.includes("{")) {
      setSerialParseError(`Incomplete JSON: ${sanitizeSerialForDisplay(trimmed)}`);
    } else {
      setSerialParseError(`Ignored non-JSON serial fragment: ${sanitizeSerialForDisplay(trimmed)}`);
    }
  }

  function handleParsedSerialObject(parsed) {
    if (!parsed || typeof parsed !== "object") {
      setSerialParseError("Parsed JSON was not an object.");
      return;
    }

    if (parsed.type === "audioTrigger") {
      handleAudioTriggerFromDaisy(parsed.audioTrigger);
      return;
    }

    if (parsed.type === "state" || typeof parsed.type === "undefined" || hasSerialStateFields(parsed)) {
      const previousTrigger = lastAudioTriggerSeen;
      applyDaisyPodState(parsed);

      if (Number.isFinite(Number(parsed.audioTrigger))) {
        const triggerCount = clampInteger(parsed.audioTrigger, 0, 999999, previousTrigger);
        elements.lastAudioTrigger.textContent = String(triggerCount);
        if (triggerCount > previousTrigger) {
          handleAudioTriggerFromDaisy(triggerCount);
        } else {
          state.audioTrigger = triggerCount;
        }
      }
    }
  }

  function consumeBalancedSerialBuffer() {
    while (serialTextBuffer.trim()) {
      const balanced = findFirstBalancedJson(serialTextBuffer);

      if (!balanced) {
        if (serialTextBuffer.length > SERIAL_BUFFER_LIMIT / 2) {
          processSerialRecord(serialTextBuffer);
          serialTextBuffer = "";
        }
        return;
      }

      if (balanced.start > 0) {
        const prefix = serialTextBuffer.slice(0, balanced.start);
        if (prefix.trim()) {
          processSerialRecord(prefix);
        }
        serialTextBuffer = serialTextBuffer.slice(balanced.start);
        continue;
      }

      if (!balanced.record) {
        const nextStart = serialTextBuffer.indexOf("{", balanced.start + 1);
        if (nextStart !== -1) {
          processSerialRecord(serialTextBuffer.slice(0, nextStart));
          serialTextBuffer = serialTextBuffer.slice(nextStart);
          continue;
        }
        return;
      }

      processSerialRecord(balanced.record);
      serialTextBuffer = serialTextBuffer.slice(balanced.end);
    }
  }

  function ingestSerialText(text, flush) {
    serialTextBuffer += normalizeSerialChunk(text);

    if (serialTextBuffer.length > SERIAL_BUFFER_LIMIT) {
      serialTextBuffer = serialTextBuffer.slice(-SERIAL_BUFFER_LIMIT);
      setSerialParseError("Serial buffer overflow; kept the newest data.");
    }

    const records = serialTextBuffer.split(/\n+/);
    serialTextBuffer = records.pop() || "";
    records.forEach(processSerialRecord);
    consumeBalancedSerialBuffer();

    if (flush && serialTextBuffer.trim()) {
      processSerialRecord(serialTextBuffer);
      serialTextBuffer = "";
    }
  }

  async function readSerialLoop() {
    const decoder = new TextDecoder();

    keepReading = true;
    reader = port.readable.getReader();

    try {
      while (keepReading) {
        const result = await reader.read();
        if (result.done) {
          break;
        }
        ingestSerialText(decoder.decode(result.value, { stream: true }), false);
      }
    } catch (error) {
      if (keepReading) {
        setSerialStatus("Serial read error", "error");
        setSerialParseError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      ingestSerialText(decoder.decode(), true);
      if (reader) {
        reader.releaseLock();
        reader = null;
      }
    }
  }

  async function connectSerial() {
    if (!("serial" in navigator)) {
      elements.supportWarning.hidden = false;
      setSerialStatus("Web Serial unavailable", "error");
      return;
    }

    try {
      hideSerialHelp();
      setSerialStatus("Opening port...", "idle");
      setSerialParseStatus("waiting", "Waiting");
      elements.parseError.textContent = "None";
      port = await navigator.serial.requestPort();
      await port.open({ baudRate: 115200 });
      serialTextBuffer = "";
      elements.connectButton.disabled = true;
      elements.disconnectButton.disabled = false;
      setSerialStatus("Connected at 115200", "connected");
      setSerialParseStatus("waiting", "Waiting");
      readLoopPromise = readSerialLoop();
    } catch (error) {
      const serialError = describeSerialOpenError(error);
      setSerialStatus(serialError.short, "error");
      setSerialParseStatus("waiting", "Waiting");
      elements.parseError.textContent = serialError.detail;
      showSerialHelp(serialError.detail);
      if (port) {
        try {
          await port.close();
        } catch (_closeError) {
          // The port may not have opened far enough to close.
        }
      }
      port = null;
    }
  }

  async function disconnectSerial() {
    keepReading = false;

    if (reader) {
      try {
        await reader.cancel();
      } catch (error) {
        setSerialParseError(error instanceof Error ? error.message : String(error));
      }
    }

    if (readLoopPromise) {
      try {
        await readLoopPromise;
      } catch (error) {
        setSerialParseError(error instanceof Error ? error.message : String(error));
      }
      readLoopPromise = null;
    }

    if (port) {
      try {
        await port.close();
      } catch (error) {
        setSerialParseError(error instanceof Error ? error.message : String(error));
      }
    }

    port = null;
    elements.connectButton.disabled = false;
    elements.disconnectButton.disabled = true;
    setSerialStatus("Disconnected", "idle");
  }

  function setupSerial() {
    if (!("serial" in navigator)) {
      elements.supportWarning.hidden = false;
      setSerialStatus("Manual only", "idle");
    }

    elements.connectButton.addEventListener("click", connectSerial);
    elements.disconnectButton.addEventListener("click", disconnectSerial);

    if ("serial" in navigator) {
      navigator.serial.addEventListener("disconnect", () => {
        if (port) {
          disconnectSerial();
        }
      });
    }
  }

  function getRMS(buffer) {
    let sum = 0;
    for (let i = 0; i < buffer.length; i += 1) {
      sum += buffer[i] * buffer[i];
    }
    return Math.sqrt(sum / buffer.length);
  }

  function removeDC(buffer) {
    let mean = 0;
    for (let i = 0; i < buffer.length; i += 1) {
      mean += buffer[i];
    }
    mean /= buffer.length;

    const centered = new Float32Array(buffer.length);
    for (let i = 0; i < buffer.length; i += 1) {
      centered[i] = buffer[i] - mean;
    }
    return centered;
  }

  function normalizedCorrelation(buffer, lag) {
    let sum = 0;
    let sumA = 0;
    let sumB = 0;
    const end = buffer.length - lag;

    for (let i = 0; i < end; i += 1) {
      const a = buffer[i];
      const b = buffer[i + lag];
      sum += a * b;
      sumA += a * a;
      sumB += b * b;
    }

    if (sumA === 0 || sumB === 0) {
      return 0;
    }
    return sum / Math.sqrt(sumA * sumB);
  }

  function autoCorrelate(buffer, sampleRate) {
    const rms = getRMS(buffer);
    if (rms < RMS_THRESHOLD) {
      return null;
    }

    const centered = removeDC(buffer);
    const minLag = Math.max(1, Math.floor(sampleRate / MAX_FREQUENCY));
    const maxLag = Math.min(centered.length - 2, Math.ceil(sampleRate / MIN_FREQUENCY));
    let bestLag = -1;
    let bestCorrelation = 0;

    for (let lag = minLag; lag <= maxLag; lag += 1) {
      const correlation = normalizedCorrelation(centered, lag);
      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestLag = lag;
      }
    }

    if (bestLag < 0 || bestCorrelation < MIN_CONFIDENCE) {
      return null;
    }

    const previous = normalizedCorrelation(centered, Math.max(minLag, bestLag - 1));
    const next = normalizedCorrelation(centered, Math.min(maxLag, bestLag + 1));
    const denominator = previous - 2 * bestCorrelation + next;
    const shift = denominator === 0 ? 0 : 0.5 * (previous - next) / denominator;
    const refinedLag = bestLag + Math.max(-0.5, Math.min(0.5, shift));

    return {
      frequency: sampleRate / refinedLag,
      confidence: bestCorrelation,
      rms,
    };
  }

  function frequencyToMidi(freq) {
    return 69 + 12 * Math.log2(freq / 440);
  }

  function midiToPitchClass(midi) {
    return ((Math.round(midi) % 12) + 12) % 12;
  }

  function analyzeAudioFrame() {
    if (!analyser || !audioBuffer || !audioContext) {
      return null;
    }

    analyser.getFloatTimeDomainData(audioBuffer);
    const estimate = autoCorrelate(audioBuffer, audioContext.sampleRate);

    if (!estimate || estimate.frequency < MIN_FREQUENCY || estimate.frequency > MAX_FREQUENCY) {
      return null;
    }

    const midi = frequencyToMidi(estimate.frequency);
    const pitchClass = midiToPitchClass(midi);

    return {
      frequency: estimate.frequency,
      confidence: estimate.confidence,
      rms: estimate.rms,
      midi,
      pitchClass,
      noteName: pitchClassToName(pitchClass),
      weight: estimate.confidence * Math.max(0.2, Math.min(1.5, estimate.rms / RMS_THRESHOLD)),
    };
  }

  function histogramTotal(histogram) {
    return histogram.reduce((sum, value) => sum + value, 0);
  }

  function distinctPitchClasses(histogram) {
    const total = histogramTotal(histogram);
    if (total <= 0) {
      return 0;
    }
    return histogram.filter((weight) => weight / total >= 0.06).length;
  }

  function strongestPitchClass(histogram) {
    let pitchClass = 0;
    let weight = 0;
    histogram.forEach((value, index) => {
      if (value > weight) {
        weight = value;
        pitchClass = index;
      }
    });
    return { pitchClass, weight };
  }

  function enabledScaleTemplates() {
    const mode = elements.detectionMode.value;
    if (mode === "majorMinor") {
      return SCALE_TEMPLATES.slice(0, 2);
    }
    if (mode === "pentatonic") {
      return SCALE_TEMPLATES;
    }
    return [];
  }

  function scoreScaleTemplates(pitchClassHistogram) {
    const templates = enabledScaleTemplates();
    const total = histogramTotal(pitchClassHistogram);

    if (templates.length === 0 || total <= 0) {
      return [];
    }

    const candidates = [];

    for (let root = 0; root < 12; root += 1) {
      templates.forEach((template) => {
        let inside = 0;
        let outside = 0;

        pitchClassHistogram.forEach((weight, pitchClass) => {
          const relative = (pitchClass - root + 12) % 12;
          if (template.intervals.includes(relative)) {
            inside += weight;
          } else {
            outside += weight;
          }
        });

        const rootWeight = pitchClassHistogram[root];
        const score = (inside - outside * 0.8 + rootWeight * 0.35) / total;
        candidates.push({
          root,
          rootName: pitchClassToName(root),
          scaleName: template.name,
          scaleIndex: template.scaleIndex,
          score,
          inside,
          outside,
          rootWeight,
        });
      });
    }

    return candidates.sort((a, b) => b.score - a.score);
  }

  function confidenceLabel(best, runnerUp) {
    if (!best) {
      return "Low";
    }

    const gap = runnerUp ? best.score - runnerUp.score : best.score;
    if (best.score >= 0.74 && gap >= 0.12) {
      return "High";
    }
    if (best.score >= 0.62 && gap >= 0.08) {
      return "Medium";
    }
    return "Low";
  }

  function formatCandidate(candidate) {
    if (!candidate) {
      return "--";
    }
    return `${candidate.rootName} ${candidate.scaleName} ${candidate.score.toFixed(2)}`;
  }

  function formatHistogram(histogram) {
    return histogram
      .map((weight, index) => `${pitchClassToName(index)}:${weight.toFixed(2)}`)
      .join("  ");
  }

  function buildDetectionResult(windowResult) {
    const total = histogramTotal(windowResult.histogram);
    const strongest = strongestPitchClass(windowResult.histogram);
    const rootSupport = total > 0 ? strongest.weight / total : 0;
    const distinct = distinctPitchClasses(windowResult.histogram);
    const candidates = scoreScaleTemplates(windowResult.histogram);
    const topCandidate = candidates[0] || null;
    const runnerUp = candidates[1] || null;
    const label = confidenceLabel(topCandidate, runnerUp);
    const enoughScaleEvidence = distinct >= MIN_SCALE_DISTINCT_PCS;
    const scoreGap = topCandidate && runnerUp ? topCandidate.score - runnerUp.score : 0;
    let scaleIndex = null;
    let scaleName = null;
    let detectionConfidence = "Medium";
    let reason = "Root detected; scale unchanged.";

    if (windowResult.frameCount < MIN_CONFIDENT_FRAMES || total <= 0 || rootSupport < MIN_ROOT_SUPPORT) {
      return {
        ok: false,
        reason: "No stable pitch detected.",
        histogram: windowResult.histogram,
        candidates,
        topCandidate,
        runnerUp,
        frameCount: windowResult.frameCount,
        distinct,
      };
    }

    if (
      topCandidate &&
      topCandidate.root === strongest.pitchClass &&
      enoughScaleEvidence &&
      topCandidate.score >= SCALE_SCORE_THRESHOLD &&
      scoreGap >= SCALE_SCORE_GAP
    ) {
      scaleIndex = topCandidate.scaleIndex;
      scaleName = topCandidate.scaleName;
      detectionConfidence = label;
      reason = `Root and ${scaleName} inferred.`;
    } else if (elements.detectionMode.value !== "root") {
      detectionConfidence = enoughScaleEvidence ? "Low" : "Medium";
      reason = enoughScaleEvidence
        ? "Scale candidates were too close; scale unchanged."
        : "Not enough distinct pitch classes for scale inference.";
    }

    return {
      ok: true,
      rootPc: strongest.pitchClass,
      rootName: pitchClassToName(strongest.pitchClass),
      rootSupport,
      scaleIndex,
      scaleName,
      confidenceLabel: detectionConfidence,
      reason,
      histogram: windowResult.histogram,
      candidates,
      topCandidate,
      runnerUp,
      frameCount: windowResult.frameCount,
      distinct,
      recentNotes: windowResult.recentNotes,
    };
  }

  async function runDetectionWindow(durationMs) {
    const histogram = new Array(12).fill(0);
    const recentNotes = [];
    let frameCount = 0;
    const startedAt = performance.now();

    while (performance.now() - startedAt < durationMs) {
      const frame = analyzeAudioFrame();

      if (frame) {
        histogram[frame.pitchClass] += frame.weight;
        frameCount += 1;
        recentNotes.push(`${frame.noteName}@${frame.frequency.toFixed(0)}Hz`);
        recentNotes.splice(0, Math.max(0, recentNotes.length - 14));
        elements.detectedNote.textContent = frame.noteName;
        elements.detectedFrequency.textContent = `${frame.frequency.toFixed(1)} Hz`;
        elements.audioConfidence.textContent = `${Math.round(frame.confidence * 100)}%`;
      }

      const remaining = Math.max(0, durationMs - (performance.now() - startedAt));
      setAudioStatus(`Listening ${Math.ceil(remaining / 1000)}s. Play one clear root or a short phrase.`, "ok");
      await new Promise((resolve) => window.setTimeout(resolve, FRAME_INTERVAL_MS));
    }

    return {
      histogram,
      recentNotes,
      frameCount,
    };
  }

  function applyAudioDetectionResult(result) {
    elements.histogramDebug.textContent = formatHistogram(result.histogram);
    elements.candidateDebug.textContent = result.candidates.length
      ? result.candidates.slice(0, 8).map(formatCandidate).join("\n")
      : "Scale inference disabled or no candidates.";
    elements.topCandidate.textContent = formatCandidate(result.topCandidate);
    elements.runnerUpCandidate.textContent = formatCandidate(result.runnerUp);

    if (!result.ok) {
      elements.audioFrameSummary.textContent = `confident frames: ${result.frameCount}\n${result.reason}`;
      elements.audioConfidence.textContent = "Low";
      setAudioStatus(result.reason, "error");
      return;
    }

    state.key = result.rootPc;
    if (result.scaleIndex !== null) {
      state.scale = result.scaleIndex;
    }
    state.source = "Audio";
    state.lastAudioDetection = result.scaleName
      ? `${result.rootName} ${result.scaleName} (${result.confidenceLabel})`
      : `${result.rootName} root (${result.confidenceLabel})`;

    refreshStateNames();
    renderAll();
    syncManualControls();

    elements.detectedNote.textContent = result.rootName;
    elements.audioConfidence.textContent = result.confidenceLabel;
    elements.audioFrameSummary.textContent = [
      `confident frames: ${result.frameCount}`,
      `distinct pitch classes: ${result.distinct}`,
      `root support: ${(result.rootSupport * 100).toFixed(0)}%`,
      `recent: ${result.recentNotes.join(", ") || "none"}`,
    ].join("\n");
    setAudioStatus(`${result.reason} Key set to ${result.rootName}.`, "ok");
  }

  async function recordAndDetect(sourceLabel) {
    if (!analyser) {
      setAudioStatus("Start the microphone before recording.", "error");
      return;
    }

    if (isRecordingAudio) {
      setAudioStatus("Already listening.", "error");
      return;
    }

    isRecordingAudio = true;
    elements.recordAudioButton.disabled = true;
    if (elements.audioCard) {
      elements.audioCard.classList.add("listening");
      elements.audioCard.classList.remove("mic-ready", "mic-error");
    }

    try {
      setAudioStatus(`Recording 3 seconds${sourceLabel ? ` (${sourceLabel})` : ""}.`, "ok");
      const windowResult = await runDetectionWindow(DETECTION_WINDOW_MS);
      const detectionResult = buildDetectionResult(windowResult);
      applyAudioDetectionResult(detectionResult);
    } finally {
      isRecordingAudio = false;
      elements.recordAudioButton.disabled = !analyser;
      if (elements.audioCard) {
        elements.audioCard.classList.remove("listening");
        elements.audioCard.classList.toggle("mic-ready", Boolean(analyser));
      }
    }
  }

  async function populateAudioDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      elements.audioDeviceSelect.disabled = true;
      return;
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter((device) => device.kind === "audioinput");
      const currentValue = elements.audioDeviceSelect.value;
      const fragment = document.createDocumentFragment();
      const defaultOption = document.createElement("option");

      defaultOption.value = "";
      defaultOption.textContent = "Default input";
      fragment.appendChild(defaultOption);

      inputs.forEach((device, index) => {
        const option = document.createElement("option");
        option.value = device.deviceId;
        option.textContent = device.label || `Audio input ${index + 1}`;
        fragment.appendChild(option);
      });

      elements.audioDeviceSelect.replaceChildren(fragment);
      elements.audioDeviceSelect.value = currentValue;
      elements.audioDeviceSelect.disabled = inputs.length === 0;
    } catch (error) {
      setAudioStatus(error instanceof Error ? error.message : String(error), "error");
    }
  }

  function stopAudioStream() {
    if (audioStream) {
      audioStream.getTracks().forEach((track) => track.stop());
    }
    audioStream = null;
    audioSource = null;
    analyser = null;
    audioBuffer = null;
  }

  async function startMicrophone() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setAudioStatus("Microphone access is unavailable in this browser.", "error");
      return;
    }

    try {
      stopAudioStream();
      const deviceId = elements.audioDeviceSelect.value;
      const constraints = deviceId
        ? { audio: { deviceId: { exact: deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } }
        : { audio: true };
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;

      if (!AudioContextClass) {
        setAudioStatus("AudioContext is unavailable in this browser.", "error");
        return;
      }

      audioStream = await navigator.mediaDevices.getUserMedia(constraints);

      if (!audioContext) {
        audioContext = new AudioContextClass();
      }
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      analyser = audioContext.createAnalyser();
      analyser.fftSize = AUDIO_FFT_SIZE;
      analyser.smoothingTimeConstant = 0;
      audioBuffer = new Float32Array(analyser.fftSize);
      audioSource = audioContext.createMediaStreamSource(audioStream);
      audioSource.connect(analyser);

      elements.recordAudioButton.disabled = false;
      elements.continuousListenButton.disabled = false;
      setAudioStatus("Microphone ready. Use Record 3 sec, or turn Voice Mode on and press SW2.", "ok");
      await populateAudioDevices();
    } catch (error) {
      setAudioStatus(error instanceof Error ? error.message : String(error), "error");
    }
  }

  function setContinuousButton(active) {
    elements.continuousListenButton.classList.toggle("active", active);
    elements.continuousListenButton.setAttribute("aria-pressed", active ? "true" : "false");
    elements.continuousListenButton.textContent = active ? "Stop" : "Continuous";
    if (elements.audioCard) {
      elements.audioCard.classList.toggle("listening", active);
      elements.audioCard.classList.toggle("mic-ready", !active && Boolean(analyser));
    }
  }

  function analyzeContinuousFrame(timestamp) {
    if (!continuousListening) {
      return;
    }

    if (timestamp - lastAudioFrameTime >= FRAME_INTERVAL_MS) {
      lastAudioFrameTime = timestamp;
      const frame = analyzeAudioFrame();

      if (frame) {
        elements.detectedNote.textContent = frame.noteName;
        elements.detectedFrequency.textContent = `${frame.frequency.toFixed(1)} Hz`;
        elements.audioConfidence.textContent = `${Math.round(frame.confidence * 100)}%`;

        if (frame.pitchClass === stablePitchClass) {
          stableFrameCount += 1;
        } else {
          stablePitchClass = frame.pitchClass;
          stableFrameCount = 1;
        }

        if (
          stableFrameCount >= CONTINUOUS_STABLE_FRAMES &&
          timestamp - lastContinuousCommitTime >= CONTINUOUS_COMMIT_COOLDOWN_MS
        ) {
          state.key = frame.pitchClass;
          state.source = "Audio";
          state.lastAudioDetection = `${frame.noteName} root (continuous)`;
          refreshStateNames();
          renderAll();
          syncManualControls();
          setAudioStatus(`Continuous set root to ${frame.noteName}.`, "ok");
          lastContinuousCommitTime = timestamp;
          stableFrameCount = 0;
        }
      }
    }

    continuousAnimationId = window.requestAnimationFrame(analyzeContinuousFrame);
  }

  function toggleContinuousListen() {
    if (!analyser) {
      setAudioStatus("Start Microphone first.", "error");
      return;
    }

    continuousListening = !continuousListening;
    setContinuousButton(continuousListening);
    stablePitchClass = null;
    stableFrameCount = 0;

    if (continuousListening) {
      setAudioStatus("Continuous listening; commits only after stable repeated frames.", "ok");
      continuousAnimationId = window.requestAnimationFrame(analyzeContinuousFrame);
    } else if (continuousAnimationId) {
      window.cancelAnimationFrame(continuousAnimationId);
      continuousAnimationId = null;
      setAudioStatus("Continuous listening stopped.", "ok");
    }
  }

  function setupAudio() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      elements.startMicButton.disabled = true;
      setAudioStatus("Microphone access is unavailable in this browser.", "error");
      return;
    }

    if (elements.voiceModeToggle) {
      elements.voiceModeToggle.addEventListener("click", () => {
        voiceModeEnabled = !voiceModeEnabled;
        renderVoiceMode();
        setAudioStatus(
          voiceModeEnabled
            ? "Voice Mode on. SW2 will record 3 seconds if the microphone is ready."
            : "Voice Mode off. SW2 changes DaisyPod display mode only.",
          "ok"
        );
      });
    }

    elements.startMicButton.addEventListener("click", startMicrophone);
    elements.recordAudioButton.addEventListener("click", () => recordAndDetect("manual"));
    elements.continuousListenButton.addEventListener("click", toggleContinuousListen);
    elements.audioDeviceSelect.addEventListener("change", () => {
      if (audioStream) {
        startMicrophone();
      }
    });
    populateAudioDevices();
    renderVoiceMode();
  }

  setupManualControls();
  setupSerial();
  setupAudio();
  renderAll();
})();
