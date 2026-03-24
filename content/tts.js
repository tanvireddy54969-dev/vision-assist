(() => {
  if (window.VisionAssistTTS) {
    return;
  }

  const HIGHLIGHT_CLASS = "va-tts-highlight";
  const READY_TOAST_CLASS = "va-tts-toast";
  const SELECTION_BUTTON_ID = "va-tts-selection-btn";
  const EXCLUDED_SELECTOR = [
    "nav",
    "header",
    "footer",
    "aside",
    '[role="navigation"]',
    '[role="banner"]',
    '[class*="nav"]',
    '[class*="menu"]',
    '[class*="sidebar"]',
    '[class*="footer"]',
    '[class*="header"]',
    '[class*="ad"]',
    '[class*="cookie"]',
    '[class*="popup"]',
    '[id*="ad"]',
    '[id*="cookie"]',
    '[id*="popup"]'
  ].join(",");
  const BLOCK_SELECTOR = "p,li,h1,h2,h3,h4,h5,h6,blockquote,pre,td,th,figcaption";

  const state = {
    enabled: false,
    queue: [],
    queueIndex: 0,
    currentUtterance: null,
    activeHighlight: null,
    currentRate: 1.0,
    currentPitch: 1.0,
    currentVoiceName: "",
    currentVoice: null,
    waitingForVoices: false,
    selectionButton: null,
    toastTimeout: null,
    listenersBound: false
  };

  const handlers = {
    mouseup: null,
    mousedown: null,
    runtimeMessage: null,
    voicesChanged: null
  };

  function injectTTSStyles() {
    if (document.getElementById("va-tts-style")) {
      return;
    }
    const style = document.createElement("style");
    style.id = "va-tts-style";
    style.textContent = `
      .${HIGHLIGHT_CLASS} {
        background: #fff3cd !important;
        color: #111111 !important;
        border: 2px solid #b08b00 !important;
        border-radius: 4px !important;
        transition: background-color 180ms ease, color 180ms ease;
        padding: 0 2px !important;
      }
      .${READY_TOAST_CLASS} {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 2147483646;
        background: #111827;
        color: #ffffff;
        border: 2px solid #44d3ff;
        border-radius: 10px;
        padding: 10px 14px;
        font: 600 14px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
      #${SELECTION_BUTTON_ID} {
        position: absolute;
        z-index: 2147483647;
        border: 2px solid #000;
        border-radius: 8px;
        background: #fff500;
        color: #111;
        padding: 8px 12px;
        font: 700 14px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        cursor: pointer;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);
      }
      #${SELECTION_BUTTON_ID}:focus-visible {
        outline: 3px solid #005fcc;
        outline-offset: 2px;
      }
    `;
    document.head.appendChild(style);
  }

  function isVisibleNode(node) {
    if (!node || !node.parentElement) return false;
    if (node.parentElement.closest(EXCLUDED_SELECTOR)) return false;
    const text = (node.textContent || "").trim();
    if (!text) return false;
    const style = window.getComputedStyle(node.parentElement);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  function waitForVoices() {
    return new Promise((resolve) => {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) {
        resolve(voices);
        return;
      }

      state.waitingForVoices = true;
      handlers.voicesChanged = () => {
        const updated = window.speechSynthesis.getVoices();
        if (updated.length > 0) {
          state.waitingForVoices = false;
          window.speechSynthesis.removeEventListener("voiceschanged", handlers.voicesChanged);
          handlers.voicesChanged = null;
          resolve(updated);
        }
      };
      window.speechSynthesis.addEventListener("voiceschanged", handlers.voicesChanged, { once: true });
      setTimeout(() => {
        if (state.waitingForVoices) {
          state.waitingForVoices = false;
          resolve(window.speechSynthesis.getVoices());
        }
      }, 1200);
    });
  }

  async function loadPreferences() {
    const stored = await chrome.storage.sync.get({
      ttsRate: 1.0,
      ttsPitch: 1.0,
      ttsVoice: "",
      settings: {}
    });
    const settings = stored.settings || {};

    state.currentRate = Number(settings.ttsSpeed ?? stored.ttsRate ?? 1.0) || 1.0;
    state.currentPitch = Number(settings.ttsPitch ?? stored.ttsPitch ?? 1.0) || 1.0;
    state.currentVoiceName = String(settings.ttsVoice ?? stored.ttsVoice ?? "").trim();

    const voices = await waitForVoices();
    state.currentVoice = voices.find((voice) => voice.name === state.currentVoiceName) || null;
  }

  function showToast(message) {
    const existing = document.querySelector(`.${READY_TOAST_CLASS}`);
    if (existing) existing.remove();
    const toast = document.createElement("div");
    toast.className = READY_TOAST_CLASS;
    toast.textContent = message;
    document.body.appendChild(toast);
    if (state.toastTimeout) clearTimeout(state.toastTimeout);
    state.toastTimeout = setTimeout(() => toast.remove(), 1600);
  }

  function chooseReadableRoot() {
    const preferred = document.querySelector("main, article, [role='main']");
    if (preferred && !preferred.closest(EXCLUDED_SELECTOR)) {
      return preferred;
    }

    // Fallback: pick the element with most visible text.
    let best = document.body;
    let bestLength = 0;
    const candidates = document.querySelectorAll("section,div,article,main");
    for (const el of candidates) {
      if (el.closest(EXCLUDED_SELECTOR)) continue;
      const text = (el.innerText || "").trim();
      if (text.length > bestLength) {
        best = el;
        bestLength = text.length;
      }
    }
    return best || document.body;
  }

  function collectTextBlocks(root) {
    const blocks = [];
    const blockNodes = root.querySelectorAll(BLOCK_SELECTOR);

    for (const node of blockNodes) {
      if (node.closest(EXCLUDED_SELECTOR)) continue;
      const text = (node.innerText || node.textContent || "").trim().replace(/\s+/g, " ");
      if (text.length < 20) continue;
      blocks.push({ container: node, text });
    }

    if (blocks.length > 0) return blocks;

    // Low-text fallback.
    const fallback = (root.innerText || root.textContent || "").trim().replace(/\s+/g, " ");
    if (fallback) {
      blocks.push({ container: root, text: fallback });
    }
    return blocks;
  }

  function splitSentences(text) {
    if (!text) return [];
    return text
      .split(/(?<=[.?!])\s+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);
  }

  function unwrapHighlight() {
    if (!state.activeHighlight || !state.activeHighlight.parentNode) {
      state.activeHighlight = null;
      return;
    }
    const el = state.activeHighlight;
    const parent = el.parentNode;
    while (el.firstChild) {
      parent.insertBefore(el.firstChild, el);
    }
    parent.removeChild(el);
    parent.normalize();
    state.activeHighlight = null;
  }

  function highlightSentenceInContainer(container, sentence) {
    unwrapHighlight();

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return isVisibleNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });

    const textNodes = [];
    let combined = "";
    let current;
    while ((current = walker.nextNode())) {
      textNodes.push({ node: current, start: combined.length, end: combined.length + current.textContent.length });
      combined += current.textContent;
    }

    if (!combined.trim()) return;

    const target = sentence.trim();
    const startIdx = combined.indexOf(target);
    if (startIdx < 0) return;
    const endIdx = startIdx + target.length;

    let startNode = null;
    let endNode = null;
    let startOffset = 0;
    let endOffset = 0;

    for (const part of textNodes) {
      if (!startNode && startIdx >= part.start && startIdx <= part.end) {
        startNode = part.node;
        startOffset = Math.max(0, startIdx - part.start);
      }
      if (!endNode && endIdx >= part.start && endIdx <= part.end) {
        endNode = part.node;
        endOffset = Math.max(0, endIdx - part.start);
        break;
      }
    }

    if (!startNode || !endNode) return;

    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);

    const wrapper = document.createElement("span");
    wrapper.className = HIGHLIGHT_CLASS;
    const contents = range.extractContents();
    wrapper.appendChild(contents);
    range.insertNode(wrapper);
    state.activeHighlight = wrapper;
    wrapper.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function clearQueue() {
    state.queue = [];
    state.queueIndex = 0;
    state.currentUtterance = null;
  }

  function stop() {
    window.speechSynthesis.cancel();
    clearQueue();
    unwrapHighlight();
  }

  function speakQueue() {
    if (!state.enabled) return;
    if (state.queueIndex >= state.queue.length) {
      stop();
      return;
    }

    const item = state.queue[state.queueIndex];
    highlightSentenceInContainer(item.container, item.sentence);

    const utterance = new SpeechSynthesisUtterance(item.sentence);
    utterance.rate = state.currentRate;
    utterance.pitch = state.currentPitch;
    if (state.currentVoice) {
      utterance.voice = state.currentVoice;
    }
    utterance.onend = () => {
      state.queueIndex += 1;
      speakQueue();
    };
    utterance.onerror = () => {
      state.queueIndex += 1;
      speakQueue();
    };

    state.currentUtterance = utterance;
    window.speechSynthesis.speak(utterance);
  }

  function readFromBlocks(blocks) {
    stop();
    const queue = [];
    for (const block of blocks) {
      const sentences = splitSentences(block.text);
      for (const sentence of sentences) {
        queue.push({ sentence, container: block.container });
      }
      // Preserve paragraph breaks in speech rhythm.
      queue.push({ sentence: " ", container: block.container });
    }

    // Handle very long pages by chunked queueing (already one sentence per utterance).
    state.queue = queue.filter((item) => item.sentence.trim().length > 0);
    state.queueIndex = 0;

    if (state.queue.length === 0) {
      showToast("No readable content found");
      return;
    }
    speakQueue();
  }

  function readPage() {
    const root = chooseReadableRoot();
    const blocks = collectTextBlocks(root);
    if (!blocks.length) {
      showToast("No readable content found");
      return;
    }
    readFromBlocks(blocks);
  }

  function readSelected() {
    const selection = window.getSelection();
    const selectedText = selection ? selection.toString().trim().replace(/\s+/g, " ") : "";
    if (!selectedText) {
      showToast("No text selected");
      return;
    }

    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
      ? range.commonAncestorContainer.parentElement
      : range.commonAncestorContainer;
    const sentences = splitSentences(selectedText).map((sentence) => ({
      sentence,
      container: container || document.body
    }));
    stop();
    state.queue = sentences;
    state.queueIndex = 0;
    speakQueue();
  }

  function pause() {
    window.speechSynthesis.pause();
  }

  function resume() {
    window.speechSynthesis.resume();
  }

  function setRate(rate) {
    const value = Number(rate);
    if (Number.isFinite(value) && value > 0) {
      state.currentRate = value;
    }
  }

  async function setVoice(voiceName) {
    state.currentVoiceName = String(voiceName || "").trim();
    const voices = await waitForVoices();
    state.currentVoice = voices.find((voice) => voice.name === state.currentVoiceName) || null;
  }

  function removeSelectionButton() {
    if (state.selectionButton && state.selectionButton.parentNode) {
      state.selectionButton.remove();
    }
    state.selectionButton = null;
  }

  function showSelectionButton() {
    if (!state.enabled) return;
    const selection = window.getSelection();
    const selectedText = selection ? selection.toString().trim() : "";
    if (!selection || !selectedText) {
      removeSelectionButton();
      return;
    }

    const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    if (!range) return;

    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) {
      removeSelectionButton();
      return;
    }

    if (!state.selectionButton) {
      const btn = document.createElement("button");
      btn.id = SELECTION_BUTTON_ID;
      btn.type = "button";
      btn.textContent = "Read Selection";
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        readSelected();
        removeSelectionButton();
      });
      state.selectionButton = btn;
      document.body.appendChild(btn);
    }

    state.selectionButton.style.top = `${window.scrollY + rect.bottom + 8}px`;
    state.selectionButton.style.left = `${window.scrollX + rect.left}px`;
  }

  async function onRuntimeMessage(message, _sender, sendResponse) {
    if (!state.enabled) return false;

    if (message?.type === "READ_PAGE") {
      readPage();
      sendResponse({ ok: true });
      return true;
    }
    if (message?.type === "READ_SELECTED") {
      readSelected();
      sendResponse({ ok: true });
      return true;
    }
    if (message?.type === "TTS_CONTROL") {
      if (message.action === "pause") pause();
      if (message.action === "resume") resume();
      if (message.action === "stop") stop();
      sendResponse({ ok: true });
      return true;
    }
    return false;
  }

  async function init() {
    if (state.enabled) return;
    state.enabled = true;
    injectTTSStyles();
    await loadPreferences();

    handlers.mouseup = () => setTimeout(showSelectionButton, 0);
    handlers.mousedown = (event) => {
      if (state.selectionButton && event.target !== state.selectionButton) {
        removeSelectionButton();
      }
    };
    handlers.runtimeMessage = (message, sender, sendResponse) => {
      onRuntimeMessage(message, sender, sendResponse).catch((error) => {
        sendResponse({ ok: false, error: error.message });
      });
      return true;
    };

    document.addEventListener("mouseup", handlers.mouseup);
    document.addEventListener("mousedown", handlers.mousedown);
    chrome.runtime.onMessage.addListener(handlers.runtimeMessage);
    state.listenersBound = true;
    showToast("TTS Ready");
  }

  function destroy() {
    if (!state.enabled) return;
    state.enabled = false;
    stop();
    removeSelectionButton();

    if (handlers.mouseup) document.removeEventListener("mouseup", handlers.mouseup);
    if (handlers.mousedown) document.removeEventListener("mousedown", handlers.mousedown);
    if (handlers.runtimeMessage) chrome.runtime.onMessage.removeListener(handlers.runtimeMessage);
    if (handlers.voicesChanged) window.speechSynthesis.removeEventListener("voiceschanged", handlers.voicesChanged);

    handlers.mouseup = null;
    handlers.mousedown = null;
    handlers.runtimeMessage = null;
    handlers.voicesChanged = null;
    state.listenersBound = false;
  }

  window.VisionAssistTTS = {
    init,
    destroy,
    readPage,
    readSelected,
    pause,
    resume,
    stop,
    setRate,
    setVoice
  };
})();
