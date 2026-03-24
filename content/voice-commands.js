(() => {
  if (window.VisionAssistVoice) {
    return;
  }

  const STYLE_ID = "va-voice-commands-style";
  const INDICATOR_ID = "va-voice-indicator";
  const HELP_MODAL_ID = "va-voice-help-modal";

  /** @type {SpeechRecognition | null} */
  let recognition = null;

  /** Debounce interim transcripts when Chrome never marks results as final. */
  let recognitionInterimTimer = null;

  /** Avoid double-firing the same phrase (final + debounced interim). */
  let lastProcessedTranscript = "";
  let lastProcessedAt = 0;

  const state = {
    initialized: false,
    listening: false,
    userStopped: false,
    micSessionStarted: false,
    restartTimer: null,
    indicatorTimers: [],
    toastTimer: null,
    boundKeydown: null,
    boundIndicatorClick: null,
    preferredLang: "en-US",
  };

  // ——— Styles (indicator pulse, toasts, help modal) ———

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      @keyframes va-voice-pulse {
        0%, 100% { transform: scale(1); opacity: 1; }
        50% { transform: scale(1.08); opacity: 0.85; }
      }
      #${INDICATOR_ID} {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 999999;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 6px;
        max-width: min(320px, 90vw);
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif !important;
        pointer-events: none;
      }
      #${INDICATOR_ID} .va-voice-indicator-inner {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        border-radius: 999px;
        background: #1a1a1a !important;
        color: #f5f5f5 !important;
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.45);
        border: 2px solid rgba(255, 255, 255, 0.12);
      }
      #${INDICATOR_ID}.va-voice--listening .va-voice-icon {
        color: #22c55e !important;
        animation: va-voice-pulse 1.2s ease-in-out infinite;
      }
      #${INDICATOR_ID}.va-voice--idle .va-voice-icon {
        color: #ef4444 !important;
        animation: none;
      }
      #${INDICATOR_ID} .va-voice-icon {
        font-size: 22px;
        line-height: 1;
      }
      #${INDICATOR_ID} .va-voice-label {
        font-size: 13px;
        font-weight: 600;
        line-height: 1.2;
      }
      #${INDICATOR_ID} .va-voice-last {
        font-size: 12px;
        font-weight: 500;
        line-height: 1.3;
        color: #d4d4d4 !important;
        max-width: 280px;
        text-align: right;
        word-break: break-word;
        padding: 6px 10px;
        border-radius: 8px;
        background: rgba(0, 0, 0, 0.35);
      }
      #${INDICATOR_ID} .va-voice-start-btn {
        pointer-events: auto !important;
        margin-top: 8px;
        padding: 10px 16px;
        border-radius: 999px;
        border: 2px solid #38bdf8 !important;
        background: #0c4a6e !important;
        color: #f8fafc !important;
        font: 700 13px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif !important;
        cursor: pointer;
        width: 100%;
        max-width: 280px;
      }
      #${INDICATOR_ID} .va-voice-start-btn:hover {
        filter: brightness(1.08);
      }
      #${INDICATOR_ID} .va-voice-start-btn:focus-visible {
        outline: 3px solid #fbbf24 !important;
        outline-offset: 2px;
      }
      #${INDICATOR_ID}.va-voice--needs-tap .va-voice-start-btn {
        display: block;
      }
      #${INDICATOR_ID}:not(.va-voice--needs-tap) .va-voice-start-btn {
        display: none;
      }
      .va-voice-toast {
        position: fixed;
        left: 50%;
        bottom: 24px;
        transform: translateX(-50%);
        z-index: 999999;
        max-width: min(480px, 92vw);
        padding: 12px 18px;
        border-radius: 10px;
        background: #111827 !important;
        color: #ffffff !important;
        font: 600 15px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif !important;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
        text-align: center;
        pointer-events: none;
      }
      #${HELP_MODAL_ID} {
        position: fixed;
        inset: 0;
        z-index: 1000000;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background: rgba(0, 0, 0, 0.75) !important;
        box-sizing: border-box;
      }
      #${HELP_MODAL_ID}[hidden] {
        display: none !important;
      }
      #${HELP_MODAL_ID} .va-voice-help-panel {
        max-width: 640px;
        max-height: min(90vh, 720px);
        overflow: auto;
        padding: 28px 32px;
        border-radius: 16px;
        background: #0a0a0a !important;
        color: #fafafa !important;
        border: 3px solid #fbbf24 !important;
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif !important;
        font-size: 1.25rem !important;
        line-height: 1.65 !important;
        box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
      }
      #${HELP_MODAL_ID} .va-voice-help-panel h2 {
        margin: 0 0 16px;
        font-size: 1.65rem !important;
        color: #fbbf24 !important;
      }
      #${HELP_MODAL_ID} .va-voice-help-panel ul {
        margin: 0;
        padding-left: 1.35em;
      }
      #${HELP_MODAL_ID} .va-voice-help-panel li {
        margin-bottom: 12px;
      }
      #${HELP_MODAL_ID} .va-voice-help-hint {
        margin-top: 20px;
        font-size: 1.1rem !important;
        color: #a3e635 !important;
      }
    `;
    document.head.appendChild(style);
  }

  function removeStylesIfUnused() {
    const el = document.getElementById(STYLE_ID);
    if (el && !state.initialized) {
      el.remove();
    }
  }

  // ——— Indicator ———

  function getIndicator() {
    return document.getElementById(INDICATOR_ID);
  }

  function ensureIndicator() {
    let root = getIndicator();
    if (root) {
      if (!root.querySelector(".va-voice-start-btn")) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "va-voice-start-btn";
        btn.setAttribute("aria-label", "Start microphone for voice commands");
        btn.textContent = "Start listening";
        const last = root.querySelector(".va-voice-last");
        if (last && last.parentNode === root) {
          root.insertBefore(btn, last);
        } else {
          root.appendChild(btn);
        }
      }
      return root;
    }
    root = document.createElement("div");
    root.id = INDICATOR_ID;
    root.setAttribute("role", "status");
    root.setAttribute("aria-live", "polite");
    root.innerHTML = `
      <div class="va-voice-indicator-inner">
        <span class="va-voice-icon" aria-hidden="true">&#x1F3A4;</span>
        <span class="va-voice-label">Voice</span>
      </div>
      <button type="button" class="va-voice-start-btn" aria-label="Start microphone for voice commands">
        Start listening
      </button>
      <div class="va-voice-last" hidden></div>
    `;
    document.documentElement.appendChild(root);
    return root;
  }

  function removeIndicator() {
    const root = getIndicator();
    if (root) {
      root.remove();
    }
  }

  function setIndicatorListening(isListening, isError) {
    const root = getIndicator();
    if (!root) {
      return;
    }
    root.classList.toggle("va-voice--listening", isListening && !isError);
    root.classList.toggle("va-voice--idle", !isListening || isError);
    const label = root.querySelector(".va-voice-label");
    if (label) {
      if (isError) {
        label.textContent = "Mic error";
      } else if (!state.micSessionStarted) {
        label.textContent = "Tap Start below";
      } else {
        label.textContent = isListening ? "Listening…" : "Idle";
      }
    }
  }

  function setNeedsTap(needsTap) {
    const root = getIndicator();
    if (!root) {
      return;
    }
    root.classList.toggle("va-voice--needs-tap", Boolean(needsTap));
    if (needsTap) {
      setIndicatorListening(false, false);
    }
  }

  function clearRecognitionInterimTimer() {
    if (recognitionInterimTimer) {
      clearTimeout(recognitionInterimTimer);
      recognitionInterimTimer = null;
    }
  }

  function combineSpeechResults(results) {
    return Array.from(results)
      .map((r) => (r && r[0] ? r[0].transcript : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  async function startListeningFromUserGesture() {
    if (!recognition || state.userStopped || !state.initialized) {
      return;
    }
    if (navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
      } catch (_err) {
        showToast(
          "Could not open microphone here — still trying speech. Allow mic in the site lock icon if needed."
        );
      }
    }
    state.micSessionStarted = true;
    setNeedsTap(false);
    tryStartRecognition();
  }

  function bindIndicatorControls() {
    const root = getIndicator();
    if (!root || state.boundIndicatorClick) {
      return;
    }
    state.boundIndicatorClick = (ev) => {
      const btn = ev.target && ev.target.closest && ev.target.closest(".va-voice-start-btn");
      if (!btn) {
        return;
      }
      ev.preventDefault();
      ev.stopPropagation();
      startListeningFromUserGesture();
    };
    root.addEventListener("click", state.boundIndicatorClick, true);
  }

  function unbindIndicatorControls() {
    const root = getIndicator();
    if (root && state.boundIndicatorClick) {
      root.removeEventListener("click", state.boundIndicatorClick, true);
    }
    state.boundIndicatorClick = null;
  }

  function showLastHeard(text) {
    const root = getIndicator();
    if (!root) {
      return;
    }
    const last = root.querySelector(".va-voice-last");
    if (!last) {
      return;
    }
    last.hidden = !text;
    last.textContent = text ? `Heard: “${text}”` : "";
    state.indicatorTimers.forEach(clearTimeout);
    state.indicatorTimers.length = 0;
    if (text) {
      const t = setTimeout(() => {
        last.hidden = true;
        last.textContent = "";
      }, 4500);
      state.indicatorTimers.push(t);
    }
  }

  // ——— Toasts ———

  function showToast(message) {
    document.querySelectorAll(".va-voice-toast").forEach((n) => n.remove());
    if (state.toastTimer) {
      clearTimeout(state.toastTimer);
      state.toastTimer = null;
    }
    const toast = document.createElement("div");
    toast.className = "va-voice-toast";
    toast.textContent = message;
    document.documentElement.appendChild(toast);
    state.toastTimer = setTimeout(() => {
      toast.remove();
      state.toastTimer = null;
    }, 2000);
  }

  // ——— Help modal ———

  function isHelpOpen() {
    const m = document.getElementById(HELP_MODAL_ID);
    return m && !m.hasAttribute("hidden");
  }

  function closeHelp() {
    const m = document.getElementById(HELP_MODAL_ID);
    if (m) {
      m.setAttribute("hidden", "");
      m.setAttribute("aria-hidden", "true");
    }
  }

  function openHelp() {
    let modal = document.getElementById(HELP_MODAL_ID);
    if (!modal) {
      modal = document.createElement("div");
      modal.id = HELP_MODAL_ID;
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");
      modal.setAttribute("aria-labelledby", "va-voice-help-title");
      modal.innerHTML = `
        <div class="va-voice-help-panel">
          <h2 id="va-voice-help-title">Voice commands</h2>
          <ul>
            <li><strong>Read page</strong> / <strong>read this page</strong> — Read the page with TTS</li>
            <li><strong>Stop reading</strong> / <strong>stop</strong> — Stop speech</li>
            <li><strong>Pause</strong> — Pause speech</li>
            <li><strong>Resume</strong> / <strong>continue</strong> — Resume speech</li>
            <li><strong>Next heading</strong> — Jump to next heading</li>
            <li><strong>Previous heading</strong> — Jump to previous heading</li>
            <li><strong>Describe image</strong> / <strong>what is this image</strong> — Describe an image</li>
            <li><strong>High contrast</strong> / <strong>dark mode</strong> — Toggle high contrast</li>
            <li><strong>Large text</strong> / <strong>bigger text</strong> — Toggle large text</li>
            <li><strong>Simplify</strong> / <strong>simplify page</strong> / <strong>clean view</strong> — Toggle simplified layout</li>
            <li><strong>Go to link</strong> [number] — Activate a numbered link</li>
            <li><strong>Scroll down</strong> / <strong>scroll up</strong> — Scroll by one screen</li>
            <li><strong>Go to top</strong> / <strong>top of page</strong> — Scroll to top</li>
            <li><strong>Go to bottom</strong> — Scroll to bottom</li>
            <li><strong>Click</strong> / <strong>press</strong> — Activate focused control</li>
            <li><strong>Go back</strong> — Browser back</li>
            <li><strong>Search for</strong> [words] — Fill the search box</li>
            <li><strong>Help</strong> / <strong>what can I say</strong> — Show this panel</li>
          </ul>
          <p class="va-voice-help-hint">Say <strong>close help</strong>, or press <strong>Escape</strong>, to dismiss.</p>
        </div>
      `;
      document.documentElement.appendChild(modal);
      modal.addEventListener("click", (e) => {
        if (e.target === modal) {
          closeHelp();
        }
      });
    }
    modal.removeAttribute("hidden");
    modal.setAttribute("aria-hidden", "false");
  }

  function helpVoiceClose(t) {
    return (
      t.includes("close help") ||
      t.includes("close the help") ||
      t.includes("dismiss help") ||
      t.includes("hide help")
    );
  }

  // ——— Settings ———

  function loadRecognitionLang() {
    if (!chrome?.storage?.sync?.get) {
      return;
    }
    chrome.storage.sync.get("visionAssistSettings", (data) => {
      const lang = data?.visionAssistSettings?.speechRecognitionLang;
      if (typeof lang === "string" && lang.trim()) {
        state.preferredLang = lang.trim();
        if (recognition) {
          recognition.lang = state.preferredLang;
        }
      }
    });
  }

  // ——— DOM helpers ———

  function isElementVisible(el) {
    if (!(el instanceof Element)) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    const st = window.getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) {
      return false;
    }
    return rect.width > 0 && rect.height > 0;
  }

  function getHeadings() {
    return Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6")).filter(isElementVisible);
  }

  function focusHeading(h) {
    if (!h) {
      return;
    }
    try {
      h.setAttribute("tabindex", "-1");
      h.scrollIntoView({ block: "center", behavior: "smooth" });
      h.focus({ preventScroll: true });
    } catch (_e) {
      h.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }

  function jumpNextHeading() {
    const headings = getHeadings();
    if (!headings.length) {
      return { ok: false, detail: "No headings found" };
    }
    const anchorY = window.scrollY + Math.min(window.innerHeight * 0.15, 120);
    let target = null;
    for (const h of headings) {
      const top = h.getBoundingClientRect().top + window.scrollY;
      if (top > anchorY + 2) {
        target = h;
        break;
      }
    }
    if (!target) {
      target = headings[0];
    }
    focusHeading(target);
    return { ok: true, detail: "Jumping to next heading" };
  }

  function jumpPreviousHeading() {
    const headings = getHeadings();
    if (!headings.length) {
      return { ok: false, detail: "No headings found" };
    }
    const anchorY = window.scrollY + Math.min(window.innerHeight * 0.15, 120);
    let target = null;
    for (let i = headings.length - 1; i >= 0; i--) {
      const h = headings[i];
      const top = h.getBoundingClientRect().top + window.scrollY;
      if (top < anchorY - 2) {
        target = h;
        break;
      }
    }
    if (!target) {
      target = headings[headings.length - 1];
    }
    focusHeading(target);
    return { ok: true, detail: "Jumping to previous heading" };
  }

  function getDescribeSourceUrl(img) {
    const raw = (img.currentSrc || img.src || "").trim();
    if (!raw) {
      return "";
    }
    try {
      return new URL(raw, document.baseURI).href;
    } catch (_e) {
      return raw;
    }
  }

  function findTargetImageForDescribe() {
    const ae = document.activeElement;
    if (ae && ae.tagName === "IMG" && getDescribeSourceUrl(ae)) {
      return ae;
    }
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const imgs = Array.from(document.querySelectorAll("img")).filter((img) => {
      if (!getDescribeSourceUrl(img)) {
        return false;
      }
      return isElementVisible(img);
    });
    if (!imgs.length) {
      return null;
    }
    let best = imgs[0];
    let bestD = Infinity;
    for (const img of imgs) {
      const r = img.getBoundingClientRect();
      const mx = r.left + r.width / 2;
      const my = r.top + r.height / 2;
      const d = (mx - cx) ** 2 + (my - cy) ** 2;
      if (d < bestD) {
        bestD = d;
        best = img;
      }
    }
    return best;
  }

  function speakText(text) {
    if (!("speechSynthesis" in window)) {
      return;
    }
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1;
      window.speechSynthesis.speak(u);
    } catch (_e) {
      /* ignore */
    }
  }

  function describeImageCommand() {
    const img = findTargetImageForDescribe();
    if (!img) {
      return { ok: false, detail: "No image to describe" };
    }
    const url = getDescribeSourceUrl(img);
    if (!url) {
      return { ok: false, detail: "No image URL" };
    }
    chrome.runtime.sendMessage({ type: "DESCRIBE_IMAGE", imageUrl: url }, (response) => {
      if (chrome.runtime.lastError) {
        speakText("Could not describe this image.");
        showToast(`Heard: describe image → ${chrome.runtime.lastError.message}`);
        return;
      }
      if (response?.success && response.description) {
        const desc = String(response.description).trim();
        speakText(`Image: ${desc}`);
        showToast(`Heard: describe image → ${desc.length > 90 ? `${desc.slice(0, 87)}…` : desc}`);
      } else {
        const err = response?.error || "Description unavailable";
        speakText(err);
        showToast(`Heard: describe image → ${err}`);
      }
    });
    return { ok: true, detail: "Requesting image description…" };
  }

  function collectVisibleLinks() {
    return Array.from(document.querySelectorAll('a[href]')).filter((a) => {
      if (!isElementVisible(a)) {
        return false;
      }
      const href = (a.getAttribute("href") || "").trim();
      if (!href || href.startsWith("javascript:")) {
        return false;
      }
      return true;
    });
  }

  function goToLinkNumber(n) {
    const links = collectVisibleLinks();
    if (!links.length) {
      return { ok: false, detail: "No links found" };
    }
    if (n < 1 || n > links.length) {
      return { ok: false, detail: `Link ${n} out of range (1–${links.length})` };
    }
    const a = links[n - 1];
    try {
      a.focus({ preventScroll: false });
    } catch (_e) {
      /* ignore */
    }
    a.scrollIntoView({ block: "center", behavior: "smooth" });
    setTimeout(() => {
      try {
        a.click();
      } catch (_e) {
        const ev = new MouseEvent("click", { bubbles: true, cancelable: true, view: window });
        a.dispatchEvent(ev);
      }
    }, 200);
    return { ok: true, detail: `Opening link ${n}` };
  }

  function findSearchInput() {
    const selectors = [
      'input[type="search"]',
      'input[name="q"]',
      'input[name="query"]',
      'input[name="search"]',
      "#search",
      'input[role="searchbox"]',
      '[role="search"] input[type="text"]',
      '[role="search"] input[type="search"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el instanceof HTMLInputElement && isElementVisible(el)) {
        return el;
      }
    }
    const byAria = document.querySelector('[aria-label*="search" i]');
    if (byAria instanceof HTMLInputElement && isElementVisible(byAria)) {
      return byAria;
    }
    return null;
  }

  function runSearchQuery(query) {
    const q = (query || "").trim();
    if (!q) {
      return { ok: false, detail: "Empty search query" };
    }
    const input = findSearchInput();
    if (!input) {
      return { ok: false, detail: "No search field found" };
    }
    input.focus();
    input.value = q;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    try {
      const proto = Object.getPrototypeOf(input);
      const desc = Object.getOwnPropertyDescriptor(proto, "value");
      if (desc?.set) {
        desc.set.call(input, q);
      }
    } catch (_e) {
      /* ignore */
    }
    input.dispatchEvent(new InputEvent("input", { bubbles: true, data: q, inputType: "insertText" }));
    return { ok: true, detail: "Search field filled" };
  }

  function toggleContrast() {
    if (window.VisionAssistVisual?.toggle) {
      window.VisionAssistVisual.toggle("contrast");
      const on = window.VisionAssistVisual.isActive?.("contrast");
      return { ok: true, detail: on ? "High contrast on" : "High contrast off" };
    }
    const el = document.documentElement;
    const on = !el.classList.contains("va-high-contrast");
    el.classList.toggle("va-high-contrast", on);
    return { ok: true, detail: on ? "High contrast on" : "High contrast off" };
  }

  function toggleLargeText() {
    if (window.VisionAssistVisual?.toggle) {
      window.VisionAssistVisual.toggle("largetext");
      const on = window.VisionAssistVisual.isActive?.("largetext");
      return { ok: true, detail: on ? "Large text on" : "Large text off" };
    }
    const el = document.documentElement;
    const on = !el.classList.contains("va-large-text");
    el.classList.toggle("va-large-text", on);
    return { ok: true, detail: on ? "Large text on" : "Large text off" };
  }

  function toggleSimplify() {
    const el = document.documentElement;
    const on = !el.classList.contains("va-simplified");
    el.classList.toggle("va-simplified", on);
    return { ok: true, detail: on ? "Simplified view on" : "Simplified view off" };
  }

  function clickFocused() {
    const el = document.activeElement;
    if (!el || el === document.body || el === document.documentElement) {
      return { ok: false, detail: "Nothing focused to click" };
    }
    if (typeof el.click === "function") {
      el.click();
    } else {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    }
    return { ok: true, detail: "Activated focused element" };
  }

  function dispatchVaCommand(name) {
    document.dispatchEvent(new CustomEvent("va-command", { detail: { command: name } }));
  }

  /** Phrases starting with or containing word "stop" — used after "stop reading" check. */
  const RE_STOP_GENERAL = /\bstop\b/i;

  function handleTranscript(raw) {
    const text = String(raw || "").trim();
    const t = text.toLowerCase();
    const originalSnippet = text.length > 80 ? `${text.slice(0, 77)}…` : text;

    if (!t) {
      return { handled: false, label: "" };
    }

    if (isHelpOpen() && helpVoiceClose(t)) {
      closeHelp();
      return { handled: true, label: `Heard: “${originalSnippet}” → Help closed`, dispatch: "close-help" };
    }

    if (t.includes("what can i say") || (t.includes("help") && !helpVoiceClose(t))) {
      openHelp();
      return { handled: true, label: `Heard: “${originalSnippet}” → Showing help`, dispatch: "help" };
    }

    const searchIdx = t.indexOf("search for");
    if (searchIdx !== -1) {
      const query = t.slice(searchIdx + "search for".length).trim();
      const res = runSearchQuery(query);
      dispatchVaCommand("search");
      return { handled: true, label: `Heard: “${originalSnippet}” → ${res.detail}`, dispatch: "search" };
    }

    let linkMatch = t.match(/go\s+to\s+link\s*(\d+)/i);
    if (!linkMatch && /\blink\b/.test(t) && /\d/.test(t)) {
      linkMatch = t.match(/link\s*(\d+)/i);
    }
    if (linkMatch) {
      const n = parseInt(linkMatch[1], 10);
      if (!Number.isNaN(n) && t.includes("link")) {
        const res = goToLinkNumber(n);
        dispatchVaCommand("go-to-link");
        return { handled: true, label: `Heard: “${originalSnippet}” → ${res.detail}`, dispatch: "go-to-link" };
      }
    }

    if (t.includes("read this page") || t.includes("read page")) {
      if (window.VisionAssistTTS?.init) {
        window.VisionAssistTTS.init();
      }
      if (window.VisionAssistTTS?.readPage) {
        window.VisionAssistTTS.readPage();
        dispatchVaCommand("read-page");
        return { handled: true, label: `Heard: “${originalSnippet}” → Reading page`, dispatch: "read-page" };
      }
      return { handled: true, label: `Heard: “${originalSnippet}” → TTS not available`, dispatch: "read-page" };
    }

    if (t.includes("stop reading")) {
      if (window.VisionAssistTTS?.stop) window.VisionAssistTTS.stop();
      else if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      dispatchVaCommand("stop-reading");
      return { handled: true, label: `Heard: “${originalSnippet}” → Stopped reading`, dispatch: "stop-reading" };
    }
    if (RE_STOP_GENERAL.test(t) && !t.includes("scroll")) {
      if (window.VisionAssistTTS?.stop) window.VisionAssistTTS.stop();
      else if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      dispatchVaCommand("stop-reading");
      return { handled: true, label: `Heard: “${originalSnippet}” → Stopped reading`, dispatch: "stop-reading" };
    }

    if (t.includes("pause")) {
      window.VisionAssistTTS?.pause?.();
      dispatchVaCommand("pause");
      return { handled: true, label: `Heard: “${originalSnippet}” → Paused`, dispatch: "pause" };
    }

    if (t.includes("resume") || t.includes("continue")) {
      window.VisionAssistTTS?.resume?.();
      dispatchVaCommand("resume");
      return { handled: true, label: `Heard: “${originalSnippet}” → Resumed`, dispatch: "resume" };
    }

    if (t.includes("next heading")) {
      const res = jumpNextHeading();
      dispatchVaCommand("next-heading");
      return {
        handled: true,
        label: `Heard: “${originalSnippet}” → ${res.detail}`,
        dispatch: "next-heading",
      };
    }

    if (t.includes("previous heading")) {
      const res = jumpPreviousHeading();
      dispatchVaCommand("previous-heading");
      return {
        handled: true,
        label: `Heard: “${originalSnippet}” → ${res.detail}`,
        dispatch: "previous-heading",
      };
    }

    if (t.includes("describe image") || t.includes("what is this image")) {
      const res = describeImageCommand();
      dispatchVaCommand("describe-image");
      return {
        handled: true,
        label: `Heard: “${originalSnippet}” → ${res.detail}`,
        dispatch: "describe-image",
      };
    }

    if (t.includes("high contrast") || t.includes("dark mode")) {
      const res = toggleContrast();
      dispatchVaCommand("toggle-contrast");
      return { handled: true, label: `Heard: “${originalSnippet}” → ${res.detail}`, dispatch: "toggle-contrast" };
    }

    if (t.includes("large text") || t.includes("bigger text")) {
      const res = toggleLargeText();
      dispatchVaCommand("toggle-large-text");
      return { handled: true, label: `Heard: “${originalSnippet}” → ${res.detail}`, dispatch: "toggle-large-text" };
    }

    if (t.includes("simplify page") || t.includes("clean view") || t.includes("simplify")) {
      const res = toggleSimplify();
      dispatchVaCommand("toggle-simplify");
      return { handled: true, label: `Heard: “${originalSnippet}” → ${res.detail}`, dispatch: "toggle-simplify" };
    }

    if (t.includes("scroll down")) {
      window.scrollBy({ top: window.innerHeight * 0.9, left: 0, behavior: "smooth" });
      dispatchVaCommand("scroll-down");
      return { handled: true, label: `Heard: “${originalSnippet}” → Scrolled down`, dispatch: "scroll-down" };
    }

    if (t.includes("scroll up")) {
      window.scrollBy({ top: -window.innerHeight * 0.9, left: 0, behavior: "smooth" });
      dispatchVaCommand("scroll-up");
      return { handled: true, label: `Heard: “${originalSnippet}” → Scrolled up`, dispatch: "scroll-up" };
    }

    if (t.includes("go to top") || t.includes("top of page")) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      dispatchVaCommand("scroll-top");
      return { handled: true, label: `Heard: “${originalSnippet}” → Top of page`, dispatch: "scroll-top" };
    }

    if (t.includes("go to bottom")) {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
      dispatchVaCommand("scroll-bottom");
      return { handled: true, label: `Heard: “${originalSnippet}” → Bottom of page`, dispatch: "scroll-bottom" };
    }

    if (t === "click" || t === "press" || /^click\b/.test(t) || /^press\b/.test(t)) {
      const res = clickFocused();
      dispatchVaCommand("click-focused");
      return { handled: true, label: `Heard: “${originalSnippet}” → ${res.detail}`, dispatch: "click-focused" };
    }

    if (t.includes("go back")) {
      window.history.back();
      dispatchVaCommand("go-back");
      return { handled: true, label: `Heard: “${originalSnippet}” → Going back`, dispatch: "go-back" };
    }

    return { handled: false, label: "" };
  }

  function processFinalResult(transcript) {
    const trimmed = String(transcript || "").trim();
    if (!trimmed) {
      return;
    }
    const now = Date.now();
    if (trimmed === lastProcessedTranscript && now - lastProcessedAt < 700) {
      return;
    }
    lastProcessedTranscript = trimmed;
    lastProcessedAt = now;

    showLastHeard(trimmed);
    const result = handleTranscript(trimmed);
    if (result.handled) {
      showToast(result.label);
      return;
    }
    const safe = trimmed.length > 60 ? `${trimmed.slice(0, 57)}…` : trimmed;
    showToast(`Didn't understand: “${safe}”. Say 'help' for commands.`);
  }

  function scheduleRecognitionRestart() {
    if (state.userStopped || !state.initialized) {
      return;
    }
    if (state.restartTimer) {
      clearTimeout(state.restartTimer);
    }
    state.restartTimer = setTimeout(() => {
      state.restartTimer = null;
      tryStartRecognition();
    }, 350);
  }

  function tryStartRecognition() {
    if (!recognition || state.userStopped || !state.initialized) {
      return;
    }
    try {
      recognition.start();
    } catch (_e) {
      scheduleRecognitionRestart();
    }
  }

  function createRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      return null;
    }
    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = state.preferredLang;

    rec.onstart = () => {
      state.listening = true;
      setNeedsTap(false);
      setIndicatorListening(true, false);
    };

    rec.onend = () => {
      state.listening = false;
      setIndicatorListening(false, false);
      scheduleRecognitionRestart();
    };

    rec.onerror = (event) => {
      const code = event.error || "";
      state.listening = false;
      if (code === "no-speech" || code === "audio-capture") {
        setIndicatorListening(false, code === "audio-capture");
        scheduleRecognitionRestart();
        return;
      }
      if (code === "not-allowed" || code === "service-not-allowed") {
        setIndicatorListening(false, true);
        state.micSessionStarted = false;
        state.userStopped = false;
        setNeedsTap(true);
        showToast(
          "Microphone access needed. Tap “Start listening”, then click Allow in the prompt."
        );
        return;
      }
      setIndicatorListening(false, true);
      scheduleRecognitionRestart();
    };

    rec.onresult = (event) => {
      let hadFinal = false;
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const row = event.results[i];
        if (!row || !row.isFinal) {
          continue;
        }
        const transcript = row[0]?.transcript || "";
        if (transcript.trim()) {
          hadFinal = true;
          clearRecognitionInterimTimer();
          processFinalResult(transcript);
        }
      }
      if (hadFinal) {
        return;
      }
      const combined = combineSpeechResults(event.results);
      if (!combined) {
        return;
      }
      clearRecognitionInterimTimer();
      recognitionInterimTimer = setTimeout(() => {
        recognitionInterimTimer = null;
        processFinalResult(combined);
      }, 850);
    };

    return rec;
  }

  function onGlobalKeydown(ev) {
    if (ev.key === "Escape" && isHelpOpen()) {
      ev.preventDefault();
      closeHelp();
    }
  }

  function init() {
    if (state.initialized) {
      if (state.micSessionStarted) {
        tryStartRecognition();
      } else {
        setNeedsTap(true);
      }
      return;
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showToast("Speech recognition is not available in this browser.");
      return;
    }

    injectStyles();
    ensureIndicator();
    loadRecognitionLang();

    recognition = createRecognition();
    if (!recognition) {
      return;
    }

    state.initialized = true;
    state.userStopped = false;
    state.micSessionStarted = false;

    if (!state.boundKeydown) {
      state.boundKeydown = onGlobalKeydown;
      document.addEventListener("keydown", state.boundKeydown, true);
    }

    bindIndicatorControls();
    setNeedsTap(true);
    showToast("Tap “Start listening” on the page (Chrome needs a click here for the mic).");
  }

  function destroy() {
    clearRecognitionInterimTimer();
    lastProcessedTranscript = "";
    lastProcessedAt = 0;
    state.userStopped = true;
    state.initialized = false;
    state.listening = false;
    if (state.restartTimer) {
      clearTimeout(state.restartTimer);
      state.restartTimer = null;
    }
    state.indicatorTimers.forEach(clearTimeout);
    state.indicatorTimers.length = 0;
    if (state.toastTimer) {
      clearTimeout(state.toastTimer);
      state.toastTimer = null;
    }
    if (recognition) {
      try {
        recognition.onend = null;
        recognition.onerror = null;
        recognition.onresult = null;
        recognition.stop();
      } catch (_e) {
        /* ignore */
      }
      try {
        recognition.abort();
      } catch (_e2) {
        /* ignore */
      }
      recognition = null;
    }
    unbindIndicatorControls();
    state.micSessionStarted = false;
    if (state.boundKeydown) {
      document.removeEventListener("keydown", state.boundKeydown, true);
      state.boundKeydown = null;
    }
    closeHelp();
    document.getElementById(HELP_MODAL_ID)?.remove();
    removeIndicator();
    document.querySelectorAll(".va-voice-toast").forEach((n) => n.remove());
    removeStylesIfUnused();
  }

  function start() {
    state.userStopped = false;
    if (!state.initialized) {
      init();
      return;
    }
    if (!state.micSessionStarted) {
      setNeedsTap(true);
      showToast("Tap “Start listening” on the page to use voice commands.");
      return;
    }
    tryStartRecognition();
  }

  function stop() {
    state.userStopped = true;
    if (state.restartTimer) {
      clearTimeout(state.restartTimer);
      state.restartTimer = null;
    }
    if (recognition) {
      try {
        recognition.stop();
      } catch (_e) {
        /* ignore */
      }
    }
    state.listening = false;
    setIndicatorListening(false, false);
  }

  function isListening() {
    return state.listening;
  }

  window.VisionAssistVoice = {
    init,
    destroy,
    start,
    stop,
    isListening,
  };
})();