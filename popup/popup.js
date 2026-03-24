const TOGGLE_IDS = {
  tts: "toggle-tts",
  images: "toggle-images",
  voice: "toggle-voice",
  contrast: "toggle-contrast",
  largetext: "toggle-largetext",
  simplify: "toggle-simplify"
};

const DEFAULT_STATE = {
  tts: false,
  images: false,
  voice: false,
  contrast: false,
  largetext: false,
  simplify: false
};

function getCurrentTab() {
  return chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => tabs[0]);
}

function getDomainFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch (error) {
    return "Unknown page";
  }
}

function sendFeatureToggle(tabId, feature, enabled) {
  if (!tabId) return;
  chrome.tabs.sendMessage(tabId, { type: "TOGGLE_FEATURE", feature, enabled }).catch(() => {
    // The target page may not allow script injection.
  });
}

async function loadState() {
  const stored = await chrome.storage.sync.get("visionAssistToggles");
  return { ...DEFAULT_STATE, ...(stored.visionAssistToggles || {}) };
}

async function saveState(state) {
  await chrome.storage.sync.set({ visionAssistToggles: state });
}

async function initPopup() {
  const domainEl = document.getElementById("active-domain");
  const readPageBtn = document.getElementById("read-page-btn");
  const tab = await getCurrentTab();
  const tabId = tab?.id;
  const currentState = await loadState();

  domainEl.textContent = tab?.url ? getDomainFromUrl(tab.url) : "No active tab";

  Object.entries(TOGGLE_IDS).forEach(([feature, id]) => {
    const input = document.getElementById(id);
    input.checked = Boolean(currentState[feature]);

    input.addEventListener("change", async () => {
      currentState[feature] = input.checked;
      await saveState(currentState);
      sendFeatureToggle(tabId, feature, input.checked);
    });
  });

  readPageBtn.addEventListener("click", () => {
    if (!tabId) return;
    chrome.tabs.sendMessage(tabId, { type: "READ_PAGE" }).catch(() => {
      // Ignore when page cannot receive messages.
    });
  });

  // Sync popup state to currently open tab when popup opens.
  Object.entries(currentState).forEach(([feature, enabled]) => {
    sendFeatureToggle(tabId, feature, enabled);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initPopup().catch((error) => {
    console.error("VisionAssist popup failed to initialize:", error);
  });
});
