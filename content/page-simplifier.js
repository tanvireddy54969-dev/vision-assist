(() => {
  if (window.VisionAssistSimplify) {
    return;
  }

  const STYLE_ID = "va-simplified-style";
  const OVERLAY_ID = "va-simplified-overlay";
  const STORAGE_ROOT_KEY = "visionAssistSettings";
  const DARK_PREF_KEY = "pageSimplifierDark";

  const DEFAULTS = {
    darkMode: false,
    fontSize: 18,
  };

  const state = {
    active: false,
    darkMode: DEFAULTS.darkMode,
    fontSize: DEFAULTS.fontSize,
    overlay: null,
    keydownHandler: null,
    sourceContainer: null,
    utterance: null,
    lastRender: null,
  };

  function getStorageApi() {
    return chrome && chrome.storage && chrome.storage.sync ? chrome.storage.sync : null;
  }

  function loadPreferences() {
    return new Promise((resolve) => {
      const sync = getStorageApi();
      if (!sync) {
        resolve({ darkMode: DEFAULTS.darkMode });
        return;
      }
      sync.get(STORAGE_ROOT_KEY, (data) => {
        const settings = (data && data[STORAGE_ROOT_KEY]) || {};
        resolve({
          darkMode: Boolean(settings[DARK_PREF_KEY]),
        });
      });
    });
  }

  function savePreference(key, value) {
    const sync = getStorageApi();
    if (!sync) {
      return;
    }
    sync.get(STORAGE_ROOT_KEY, (data) => {
      const settings = (data && data[STORAGE_ROOT_KEY]) || {};
      settings[key] = value;
      sync.set({ [STORAGE_ROOT_KEY]: settings });
    });
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${OVERLAY_ID} {
        --va-bg: #fefefe;
        --va-text: #333333;
        --va-muted: #6b7280;
        --va-panel: #ffffff;
        --va-border: #e5e7eb;
        --va-link: #1d4ed8;
        --va-code-bg: #f3f4f6;
        --va-quote-border: #9ca3af;

        position: fixed;
        inset: 0;
        z-index: 2147483647;
        background: var(--va-bg);
        color: var(--va-text);
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      }

      #${OVERLAY_ID}.va-dark {
        --va-bg: #1a1a2e;
        --va-text: #e8e8e8;
        --va-muted: #a3a8c2;
        --va-panel: #111522;
        --va-border: #2f3553;
        --va-link: #7dd3fc;
        --va-code-bg: #0f1324;
        --va-quote-border: #5b638f;
      }

      #${OVERLAY_ID} * {
        box-sizing: border-box;
      }

      #${OVERLAY_ID} .va-simplified-header {
        position: sticky;
        top: 0;
        z-index: 3;
        background: var(--va-panel);
        border-bottom: 1px solid var(--va-border);
        padding: 16px 20px;
      }

      #${OVERLAY_ID} .va-simplified-header-inner {
        max-width: 700px;
        margin: 0 auto;
      }

      #${OVERLAY_ID} .va-title-row {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
      }

      #${OVERLAY_ID} .va-title-block h1 {
        margin: 0;
        font-size: 1.6rem;
        line-height: 1.25;
      }

      #${OVERLAY_ID} .va-source-url {
        margin-top: 6px;
        font-size: 0.85rem;
        color: var(--va-muted);
        word-break: break-all;
      }

      #${OVERLAY_ID} .va-reading-time {
        margin-top: 6px;
        font-size: 0.9rem;
        font-weight: 600;
        color: var(--va-muted);
      }

      #${OVERLAY_ID} .va-close-btn {
        border: 1px solid var(--va-border);
        background: transparent;
        color: var(--va-text);
        border-radius: 8px;
        padding: 8px 10px;
        font-size: 0.9rem;
        cursor: pointer;
      }

      #${OVERLAY_ID} .va-toolbar {
        margin-top: 12px;
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      #${OVERLAY_ID} .va-toolbar button {
        border: 1px solid var(--va-border);
        background: transparent;
        color: var(--va-text);
        border-radius: 8px;
        padding: 8px 12px;
        font-size: 0.9rem;
        cursor: pointer;
      }

      #${OVERLAY_ID} .va-content-scroll {
        height: calc(100vh - 150px);
        overflow: auto;
      }

      #${OVERLAY_ID} .va-content {
        max-width: 700px;
        margin: 0 auto;
        padding: 28px 20px 60px;
        font-size: var(--va-font-size, 18px);
        line-height: 1.8;
      }

      #${OVERLAY_ID} .va-content h1,
      #${OVERLAY_ID} .va-content h2,
      #${OVERLAY_ID} .va-content h3,
      #${OVERLAY_ID} .va-content h4,
      #${OVERLAY_ID} .va-content h5,
      #${OVERLAY_ID} .va-content h6 {
        line-height: 1.35;
        margin: 1.2em 0 0.45em;
      }

      #${OVERLAY_ID} .va-content h1 { font-size: 2rem; }
      #${OVERLAY_ID} .va-content h2 { font-size: 1.7rem; }
      #${OVERLAY_ID} .va-content h3 { font-size: 1.45rem; }
      #${OVERLAY_ID} .va-content h4 { font-size: 1.25rem; }
      #${OVERLAY_ID} .va-content h5 { font-size: 1.1rem; }
      #${OVERLAY_ID} .va-content h6 { font-size: 1rem; }

      #${OVERLAY_ID} .va-content p,
      #${OVERLAY_ID} .va-content ul,
      #${OVERLAY_ID} .va-content ol,
      #${OVERLAY_ID} .va-content blockquote,
      #${OVERLAY_ID} .va-content pre,
      #${OVERLAY_ID} .va-content table,
      #${OVERLAY_ID} .va-content figure {
        margin: 0.95em 0;
      }

      #${OVERLAY_ID} .va-content a {
        color: var(--va-link);
        text-decoration: underline;
        text-underline-offset: 2px;
      }

      #${OVERLAY_ID} .va-link-badge {
        font-size: 0.72em;
        vertical-align: super;
        margin-left: 4px;
        color: var(--va-link);
      }

      #${OVERLAY_ID} .va-content img {
        max-width: 100%;
        height: auto;
        border-radius: 8px;
        display: block;
        margin: 10px auto;
      }

      #${OVERLAY_ID} .va-figure-caption {
        font-size: 0.9em;
        color: var(--va-muted);
        text-align: center;
        margin-top: 8px;
      }

      #${OVERLAY_ID} .va-content ul,
      #${OVERLAY_ID} .va-content ol {
        padding-left: 1.4em;
      }

      #${OVERLAY_ID} .va-content code,
      #${OVERLAY_ID} .va-content pre {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        background: var(--va-code-bg);
      }

      #${OVERLAY_ID} .va-content code {
        padding: 2px 4px;
        border-radius: 4px;
      }

      #${OVERLAY_ID} .va-content pre {
        padding: 12px;
        border-radius: 8px;
        overflow-x: auto;
      }

      #${OVERLAY_ID} .va-content blockquote {
        border-left: 4px solid var(--va-quote-border);
        padding-left: 14px;
        margin-left: 0;
        font-style: italic;
      }

      #${OVERLAY_ID} .va-table-wrap {
        overflow-x: auto;
        border: 1px solid var(--va-border);
        border-radius: 8px;
      }

      #${OVERLAY_ID} .va-content table {
        width: 100%;
        border-collapse: collapse;
      }

      #${OVERLAY_ID} .va-content th,
      #${OVERLAY_ID} .va-content td {
        border: 1px solid var(--va-border);
        padding: 8px 10px;
        text-align: left;
        vertical-align: top;
      }

      #${OVERLAY_ID} .va-links-section {
        margin-top: 2rem;
        padding-top: 1rem;
        border-top: 1px solid var(--va-border);
      }

      #${OVERLAY_ID} .va-links-section h2 {
        margin: 0 0 12px;
        font-size: 1.15rem;
      }

      #${OVERLAY_ID} .va-links-list {
        margin: 0;
        padding-left: 1.25em;
      }

      #${OVERLAY_ID} .va-empty {
        margin: 24px 0;
        color: var(--va-muted);
      }
    `;

    document.head.appendChild(style);
  }

  function isVisible(el) {
    if (!(el instanceof Element)) {
      return false;
    }
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") {
      return false;
    }
    return true;
  }

  function findBySemanticPriority() {
    const semanticSelectors = [
      "article",
      "main",
      '[role="main"]',
    ];

    for (let i = 0; i < semanticSelectors.length; i += 1) {
      const node = document.querySelector(semanticSelectors[i]);
      if (node && isVisible(node)) {
        return node;
      }
    }

    const candidates = Array.from(document.querySelectorAll("*"));
    const re = /(article|content|post|entry|story)/i;
    for (let i = 0; i < candidates.length; i += 1) {
      const el = candidates[i];
      if (!isVisible(el)) {
        continue;
      }
      const id = el.id || "";
      const cls = el.className && typeof el.className === "string" ? el.className : "";
      if (re.test(id) || re.test(cls)) {
        return el;
      }
    }

    return null;
  }

  function scoreContentContainer(el) {
    const text = (el.innerText || "").trim();
    const textLength = text.length;
    const links = el.querySelectorAll("a").length;
    const scriptsAndStyles = el.querySelectorAll("script, style").length;

    return textLength - links * 50 - scriptsAndStyles * 100;
  }

  function findByHeuristic() {
    const nodes = Array.from(document.querySelectorAll("div, section"));
    let best = null;
    let bestScore = -Infinity;

    for (let i = 0; i < nodes.length; i += 1) {
      const el = nodes[i];
      if (!isVisible(el)) {
        continue;
      }
      const score = scoreContentContainer(el);
      if (score > bestScore) {
        best = el;
        bestScore = score;
      }
    }

    return best || document.body;
  }

  function findMainContentContainer() {
    const semantic = findBySemanticPriority();
    if (semantic) {
      return semantic;
    }
    return findByHeuristic();
  }

  function getPageTitle(container) {
    const docTitle = (document.title || "").trim();
    if (docTitle) {
      return docTitle;
    }
    const h1 = (container && container.querySelector("h1")) || document.querySelector("h1");
    return h1 ? (h1.textContent || "Untitled page").trim() : "Untitled page";
  }

  function sanitizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function shouldSkipElement(el) {
    if (!isVisible(el)) {
      return true;
    }

    const tag = el.tagName.toLowerCase();
    const isHeading = /^h[1-6]$/.test(tag);
    const isImage = tag === "img" || tag === "figure";

    if (isHeading || isImage || tag === "ul" || tag === "ol" || tag === "table" || tag === "pre") {
      return false;
    }

    const textLength = sanitizeText(el.textContent).length;
    return textLength < 20;
  }

  function makeLinkSafe(anchor) {
    const href = anchor.getAttribute("href") || "";
    const text = sanitizeText(anchor.textContent) || href;
    return {
      href,
      text,
    };
  }

  function cloneWithAllowedChildren(el, linkRegistry) {
    const tag = el.tagName.toLowerCase();

    if (tag === "img") {
      const img = document.createElement("img");
      const src = el.getAttribute("src") || el.getAttribute("data-src") || "";
      const alt = el.getAttribute("alt") || "";
      if (src) {
        img.src = src;
      }
      img.alt = alt;
      return img;
    }

    if (tag === "code") {
      const code = document.createElement("code");
      code.textContent = el.textContent || "";
      return code;
    }

    const clone = document.createElement(tag);

    if (tag === "a") {
      const href = el.getAttribute("href") || "";
      clone.href = href;
      clone.textContent = sanitizeText(el.textContent) || href;
      clone.target = "_blank";
      clone.rel = "noopener noreferrer";

      const number = linkRegistry.length + 1;
      const badge = document.createElement("sup");
      badge.className = "va-link-badge";
      badge.textContent = `[${number}]`;
      clone.appendChild(badge);

      linkRegistry.push({
        number,
        href,
        text: sanitizeText(el.textContent) || href,
      });

      return clone;
    }

    if (tag === "pre") {
      clone.textContent = el.textContent || "";
      return clone;
    }

    const childNodes = Array.from(el.childNodes);

    for (let i = 0; i < childNodes.length; i += 1) {
      const node = childNodes[i];
      if (node.nodeType === Node.TEXT_NODE) {
        clone.appendChild(document.createTextNode(node.textContent || ""));
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) {
        continue;
      }
      const childEl = node;
      const childTag = childEl.tagName.toLowerCase();
      if (childTag === "script" || childTag === "style" || childTag === "noscript") {
        continue;
      }
      if (!isVisible(childEl)) {
        continue;
      }

      if (childTag === "a" || childTag === "code" || childTag === "img") {
        clone.appendChild(cloneWithAllowedChildren(childEl, linkRegistry));
      } else {
        const nested = cloneWithAllowedChildren(childEl, linkRegistry);
        if (nested.textContent || nested.querySelector("img")) {
          clone.appendChild(nested);
        }
      }
    }

    if (!clone.textContent.trim() && !clone.querySelector("img")) {
      clone.textContent = sanitizeText(el.textContent);
    }

    return clone;
  }

  function createFigureWithCaption(sourceFigure, linkRegistry) {
    const figure = document.createElement("figure");
    const img = sourceFigure.tagName.toLowerCase() === "img"
      ? cloneWithAllowedChildren(sourceFigure, linkRegistry)
      : cloneWithAllowedChildren(sourceFigure.querySelector("img"), linkRegistry);

    if (img) {
      figure.appendChild(img);
    }

    const aiDescription = sourceFigure.getAttribute("aria-label")
      || sourceFigure.querySelector("img")?.getAttribute("aria-label")
      || "";
    const figcaptionText = sanitizeText(sourceFigure.querySelector("figcaption")?.textContent || "");
    const altText = sanitizeText(img ? img.getAttribute("alt") : "");
    const captionText = aiDescription || figcaptionText || altText;

    if (captionText) {
      const caption = document.createElement("figcaption");
      caption.className = "va-figure-caption";
      caption.textContent = captionText;
      figure.appendChild(caption);
    }

    return figure;
  }

  function extractReadableContent(container) {
    const selectors = "p,h1,h2,h3,h4,h5,h6,ul,ol,blockquote,pre,code,table,figure,img";
    const nodes = Array.from(container.querySelectorAll(selectors));
    const fragments = [];
    const links = [];

    for (let i = 0; i < nodes.length; i += 1) {
      const el = nodes[i];
      const tag = el.tagName.toLowerCase();

      if (shouldSkipElement(el)) {
        continue;
      }

      if (tag === "img" || tag === "figure") {
        const figure = createFigureWithCaption(tag === "figure" ? el : el, links);
        fragments.push(figure);
        continue;
      }

      if (tag === "table") {
        const wrapper = document.createElement("div");
        wrapper.className = "va-table-wrap";
        const table = cloneWithAllowedChildren(el, links);
        wrapper.appendChild(table);
        fragments.push(wrapper);
        continue;
      }

      const clone = cloneWithAllowedChildren(el, links);
      if (!clone) {
        continue;
      }

      if (tag === "code") {
        const pre = document.createElement("pre");
        pre.appendChild(clone);
        fragments.push(pre);
      } else {
        fragments.push(clone);
      }
    }

    return { fragments, links };
  }

  function getWordCountFromFragments(fragments) {
    const allText = fragments.map((node) => sanitizeText(node.textContent)).join(" ").trim();
    if (!allText) {
      return 0;
    }
    return allText.split(/\s+/).length;
  }

  function estimateReadingMinutes(wordCount) {
    return Math.max(1, Math.round(wordCount / 200));
  }

  function setOverlayFontSize(px) {
    state.fontSize = Math.max(14, Math.min(30, px));
    if (state.overlay) {
      state.overlay.style.setProperty("--va-font-size", `${state.fontSize}px`);
    }
  }

  function setOverlayTheme(darkMode) {
    state.darkMode = Boolean(darkMode);
    if (state.overlay) {
      state.overlay.classList.toggle("va-dark", state.darkMode);
    }
    savePreference(DARK_PREF_KEY, state.darkMode);
  }

  function getReadableTextFromOverlay() {
    if (!state.overlay) {
      return "";
    }
    const content = state.overlay.querySelector(".va-content");
    return sanitizeText(content ? content.innerText : "");
  }

  function stopReadAloud() {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    state.utterance = null;
  }

  function readAloudOverlay() {
    const text = getReadableTextFromOverlay();
    if (!text || !window.speechSynthesis) {
      return;
    }

    if (window.speechSynthesis.speaking) {
      stopReadAloud();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.pitch = 1;
    state.utterance = utterance;
    window.speechSynthesis.speak(utterance);
  }

  function buildLinksSection(links) {
    const section = document.createElement("section");
    section.className = "va-links-section";

    const title = document.createElement("h2");
    title.textContent = "Links";
    section.appendChild(title);

    if (!links.length) {
      const empty = document.createElement("p");
      empty.className = "va-empty";
      empty.textContent = "No links found in the simplified content.";
      section.appendChild(empty);
      return section;
    }

    const list = document.createElement("ol");
    list.className = "va-links-list";

    for (let i = 0; i < links.length; i += 1) {
      const item = links[i];
      const li = document.createElement("li");
      const anchor = document.createElement("a");
      anchor.href = item.href;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.textContent = item.text || item.href || `Link ${item.number}`;
      li.appendChild(anchor);
      list.appendChild(li);
    }

    section.appendChild(list);
    return section;
  }

  function createOverlayShell(title, readingMinutes) {
    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;

    overlay.innerHTML = `
      <header class="va-simplified-header">
        <div class="va-simplified-header-inner">
          <div class="va-title-row">
            <div class="va-title-block">
              <h1>${title}</h1>
              <div class="va-source-url">${window.location.href}</div>
              <div class="va-reading-time">Estimated reading time: ${readingMinutes} minute${readingMinutes === 1 ? "" : "s"}</div>
            </div>
            <button type="button" class="va-close-btn" aria-label="Close simplified view">✕ Close Simplified View</button>
          </div>
          <div class="va-toolbar">
            <button type="button" data-action="font-dec">Font Size -</button>
            <button type="button" data-action="font-inc">Font Size +</button>
            <button type="button" data-action="theme-toggle">Dark/Light</button>
            <button type="button" data-action="read-aloud">Read Aloud</button>
          </div>
        </div>
      </header>
      <div class="va-content-scroll">
        <main class="va-content" role="document"></main>
      </div>
    `;

    return overlay;
  }

  function onOverlayClick(event) {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    if (target.classList.contains("va-close-btn")) {
      deactivate();
      return;
    }

    const action = target.getAttribute("data-action");
    if (!action) {
      return;
    }

    if (action === "font-inc") {
      setOverlayFontSize(state.fontSize + 1);
    } else if (action === "font-dec") {
      setOverlayFontSize(state.fontSize - 1);
    } else if (action === "theme-toggle") {
      setOverlayTheme(!state.darkMode);
    } else if (action === "read-aloud") {
      readAloudOverlay();
    }
  }

  function onOverlayKeydown(event) {
    if (!state.active || !state.overlay) {
      return;
    }

    const scrollContainer = state.overlay.querySelector(".va-content-scroll");
    if (!scrollContainer) {
      return;
    }

    const key = event.key;
    if (key === "Escape") {
      event.preventDefault();
      deactivate();
      return;
    }

    if (key === "ArrowDown") {
      event.preventDefault();
      scrollContainer.scrollBy({ top: 120, behavior: "smooth" });
      return;
    }

    if (key === "ArrowUp") {
      event.preventDefault();
      scrollContainer.scrollBy({ top: -120, behavior: "smooth" });
      return;
    }

    if (key === "+" || key === "=") {
      event.preventDefault();
      setOverlayFontSize(state.fontSize + 1);
      return;
    }

    if (key === "-" || key === "_") {
      event.preventDefault();
      setOverlayFontSize(state.fontSize - 1);
      return;
    }

    if (key.toLowerCase() === "d") {
      event.preventDefault();
      setOverlayTheme(!state.darkMode);
    }
  }

  function renderSimplifiedView() {
    const container = findMainContentContainer();
    state.sourceContainer = container;

    const { fragments, links } = extractReadableContent(container);
    const wordCount = getWordCountFromFragments(fragments);
    const readingMinutes = estimateReadingMinutes(wordCount);
    const title = getPageTitle(container);

    const overlay = createOverlayShell(title, readingMinutes);
    const content = overlay.querySelector(".va-content");

    if (!fragments.length) {
      const empty = document.createElement("p");
      empty.className = "va-empty";
      empty.textContent = "Could not extract enough readable content from this page.";
      content.appendChild(empty);
    } else {
      for (let i = 0; i < fragments.length; i += 1) {
        content.appendChild(fragments[i]);
      }
    }

    content.appendChild(buildLinksSection(links));

    overlay.addEventListener("click", onOverlayClick);

    state.lastRender = {
      title,
      readingMinutes,
      wordCount,
      linksCount: links.length,
    };

    return overlay;
  }

  async function init() {
    if (state.active) {
      return;
    }

    ensureStyles();

    const prefs = await loadPreferences();
    state.darkMode = prefs.darkMode;

    state.overlay = renderSimplifiedView();
    setOverlayFontSize(state.fontSize);
    setOverlayTheme(state.darkMode);

    document.documentElement.appendChild(state.overlay);

    state.keydownHandler = onOverlayKeydown;
    document.addEventListener("keydown", state.keydownHandler, true);

    stopReadAloud();
    state.active = true;
  }

  function destroy() {
    if (!state.active) {
      return;
    }

    stopReadAloud();

    if (state.keydownHandler) {
      document.removeEventListener("keydown", state.keydownHandler, true);
      state.keydownHandler = null;
    }

    if (state.overlay && state.overlay.parentNode) {
      state.overlay.parentNode.removeChild(state.overlay);
    }

    state.overlay = null;
    state.sourceContainer = null;
    state.active = false;
  }

  function activate() {
    init();
  }

  function deactivate() {
    destroy();
  }

  function isActive() {
    return state.active;
  }

  window.VisionAssistSimplify = {
    init,
    destroy,
    activate,
    deactivate,
    isActive,
  };
})();
