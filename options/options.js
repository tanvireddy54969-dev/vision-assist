const DEFAULT_SETTINGS = {
  ttsSpeed: 1.0,
  ttsVoice: "",
  fontMultiplier: 1.5,
  geminiApiKey: "",
  defaultFeatures: {
    tts: false,
    images: false,
    voice: false,
    contrast: false,
    largetext: false,
    simplify: false
  }
};

function el(id) {
  return document.getElementById(id);
}

function getSettingsFromForm() {
  return {
    ttsSpeed: Number(el("tts-speed").value),
    ttsVoice: el("tts-voice").value,
    fontMultiplier: Number(el("font-multiplier").value),
    geminiApiKey: el("api-key").value.trim(),
    defaultFeatures: {
      tts: el("default-tts").checked,
      images: el("default-images").checked,
      voice: el("default-voice").checked,
      contrast: el("default-contrast").checked,
      largetext: el("default-largetext").checked,
      simplify: el("default-simplify").checked
    }
  };
}

function applySettingsToForm(settings) {
  el("tts-speed").value = settings.ttsSpeed;
  el("tts-speed-value").textContent = String(settings.ttsSpeed);
  el("tts-voice").value = settings.ttsVoice;
  el("font-multiplier").value = settings.fontMultiplier;
  el("font-multiplier-value").textContent = String(settings.fontMultiplier);
  el("api-key").value = settings.geminiApiKey || "";

  el("default-tts").checked = Boolean(settings.defaultFeatures.tts);
  el("default-images").checked = Boolean(settings.defaultFeatures.images);
  el("default-voice").checked = Boolean(settings.defaultFeatures.voice);
  el("default-contrast").checked = Boolean(settings.defaultFeatures.contrast);
  el("default-largetext").checked = Boolean(settings.defaultFeatures.largetext);
  el("default-simplify").checked = Boolean(settings.defaultFeatures.simplify);
}

async function saveSettings(showStatus = true) {
  const settings = getSettingsFromForm();
  await chrome.storage.sync.set({ visionAssistSettings: settings, visionAssistToggles: settings.defaultFeatures });
  if (showStatus) {
    el("save-status").textContent = "Settings saved";
    setTimeout(() => {
      el("save-status").textContent = "";
    }, 1500);
  }
}

function populateVoices(selectedVoice) {
  const voices = speechSynthesis.getVoices();
  const voiceSelect = el("tts-voice");
  voiceSelect.innerHTML = '<option value="">Default system voice</option>';

  voices.forEach((voice) => {
    const option = document.createElement("option");
    option.value = voice.name;
    option.textContent = `${voice.name} (${voice.lang})`;
    voiceSelect.appendChild(option);
  });

  if (selectedVoice) {
    voiceSelect.value = selectedVoice;
  }
}

async function loadSettings() {
  const stored = await chrome.storage.sync.get("visionAssistSettings");
  const merged = {
    ...DEFAULT_SETTINGS,
    ...(stored.visionAssistSettings || {}),
    defaultFeatures: {
      ...DEFAULT_SETTINGS.defaultFeatures,
      ...((stored.visionAssistSettings || {}).defaultFeatures || {})
    }
  };
  applySettingsToForm(merged);
  populateVoices(merged.ttsVoice);
}

function bindEvents() {
  el("tts-speed").addEventListener("input", (event) => {
    el("tts-speed-value").textContent = event.target.value;
  });

  el("font-multiplier").addEventListener("input", (event) => {
    el("font-multiplier-value").textContent = event.target.value;
  });

  el("save-api-key").addEventListener("click", async () => {
    const data = await chrome.storage.sync.get("visionAssistSettings");
    const settings = {
      ...DEFAULT_SETTINGS,
      ...(data.visionAssistSettings || {}),
      geminiApiKey: el("api-key").value.trim()
    };
    await chrome.storage.sync.set({ visionAssistSettings: settings });
    el("save-status").textContent = "API key saved";
    setTimeout(() => {
      el("save-status").textContent = "";
    }, 1500);
  });

  el("save-settings").addEventListener("click", () => {
    saveSettings(true).catch((error) => {
      console.error("Failed to save VisionAssist settings:", error);
      el("save-status").textContent = "Save failed";
    });
  });

  speechSynthesis.addEventListener("voiceschanged", () => {
    const selected = el("tts-voice").value;
    populateVoices(selected);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  loadSettings().catch((error) => {
    console.error("Failed to load VisionAssist settings:", error);
  });
});
