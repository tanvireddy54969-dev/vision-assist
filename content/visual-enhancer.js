(() => {
  if (window.VisionAssistVisual) {
    return;
  }

  const VALID_MODES = ["contrast", "largetext", "cursor", "focus", "links"];

  const CLASS_BY_MODE = {
    contrast: "va-high-contrast",
    largetext: "va-large-text",
    cursor: "va-enhanced-cursor",
    focus: "va-enhanced-focus",
    links: "va-highlight-links",
  };

  const STYLE_ID_BY_MODE = {
    contrast: "va-style-contrast",
    largetext: "va-style-largetext",
    cursor: "va-style-cursor",
    focus: "va-style-focus",
    links: "va-style-links",
  };

  const activeModes = new Set();

  let cursorFollower = null;
  let cursorMoveHandler = null;
  let cursorLeaveHandler = null;
  let linksObserver = null;
  let linksMutationDebounce = null;
  let linksRenumbering = false;

  const CSS_CONTRAST = `
html.va-high-contrast,
html.va-high-contrast body {
  background-color: #1a1a2e !important;
  color: #e8e8e8 !important;
}
html.va-high-contrast * {
  color: #e8e8e8 !important;
  border-color: rgba(255, 255, 255, 0.15) !important;
  box-sizing: border-box !important;
}
html.va-high-contrast img,
html.va-high-contrast svg,
html.va-high-contrast picture,
html.va-high-contrast video,
html.va-high-contrast canvas {
  filter: none !important;
  -webkit-filter: none !important;
  opacity: 1 !important;
}
html.va-high-contrast a {
  color: #00d4ff !important;
  text-decoration: underline !important;
}
html.va-high-contrast a:visited {
  color: #b388ff !important;
}
html.va-high-contrast h1,
html.va-high-contrast h2,
html.va-high-contrast h3,
html.va-high-contrast h4,
html.va-high-contrast h5,
html.va-high-contrast h6 {
  color: #ffd700 !important;
}
html.va-high-contrast button,
html.va-high-contrast input[type="button"],
html.va-high-contrast input[type="submit"],
html.va-high-contrast input[type="reset"] {
  border: 2px solid #00d4ff !important;
  background: transparent !important;
  color: #00d4ff !important;
}
html.va-high-contrast input:not([type]),
html.va-high-contrast input[type="text"],
html.va-high-contrast input[type="search"],
html.va-high-contrast input[type="email"],
html.va-high-contrast input[type="password"],
html.va-high-contrast input[type="tel"],
html.va-high-contrast input[type="url"],
html.va-high-contrast input[type="number"],
html.va-high-contrast input[type="date"],
html.va-high-contrast input[type="time"],
html.va-high-contrast textarea,
html.va-high-contrast select {
  border: 2px solid #888888 !important;
  background-color: #2a2a4a !important;
  color: #ffffff !important;
}
html.va-high-contrast p,
html.va-high-contrast div,
html.va-high-contrast section,
html.va-high-contrast article,
html.va-high-contrast aside,
html.va-high-contrast nav,
html.va-high-contrast main,
html.va-high-contrast header,
html.va-high-contrast footer,
html.va-high-contrast li,
html.va-high-contrast blockquote,
html.va-high-contrast figure,
html.va-high-contrast figcaption,
html.va-high-contrast pre,
html.va-high-contrast table,
html.va-high-contrast thead,
html.va-high-contrast tbody,
html.va-high-contrast tr,
html.va-high-contrast td,
html.va-high-contrast th {
  border: 1px solid rgba(255, 255, 255, 0.12) !important;
}
`;

  const CSS_LARGE_TEXT = `
html.va-large-text {
  font-size: 150% !important;
}
html.va-large-text body {
  font-size: inherit !important;
}
html.va-large-text * {
  line-height: 1.8 !important;
  letter-spacing: 0.05em !important;
  word-spacing: 0.1em !important;
}
html.va-large-text p,
html.va-large-text li,
html.va-large-text blockquote,
html.va-large-text figcaption,
html.va-large-text td,
html.va-large-text th {
  margin-bottom: 1.5em !important;
  max-width: 80ch !important;
}
`;

  const CSS_CURSOR = `
#va-cursor-follower {
  position: fixed;
  left: 0;
  top: 0;
  width: 30px;
  height: 30px;
  margin: 0;
  border-radius: 50%;
  border: 3px solid #ffeb3b;
  background: rgba(255, 235, 59, 0.28);
  pointer-events: none;
  z-index: 2147483647;
  box-sizing: border-box;
  transition: left 0.12s ease-out, top 0.12s ease-out, border-color 0.15s ease, background-color 0.15s ease;
  will-change: left, top;
}
#va-cursor-follower.va-cursor-follower--clickable {
  border-color: #4caf50;
  background: rgba(76, 175, 80, 0.28);
}
html.va-enhanced-cursor,
html.va-enhanced-cursor * {
  cursor: none !important;
}
`;

  const CSS_FOCUS = `
html.va-enhanced-focus a:focus,
html.va-enhanced-focus a:focus-visible,
html.va-enhanced-focus button:focus,
html.va-enhanced-focus button:focus-visible,
html.va-enhanced-focus input:focus,
html.va-enhanced-focus input:focus-visible,
html.va-enhanced-focus select:focus,
html.va-enhanced-focus select:focus-visible,
html.va-enhanced-focus textarea:focus,
html.va-enhanced-focus textarea:focus-visible,
html.va-enhanced-focus summary:focus,
html.va-enhanced-focus summary:focus-visible,
html.va-enhanced-focus [tabindex]:not([tabindex="-1"]):focus,
html.va-enhanced-focus [tabindex]:not([tabindex="-1"]):focus-visible,
html.va-enhanced-focus [role="button"]:focus,
html.va-enhanced-focus [role="button"]:focus-visible,
html.va-enhanced-focus [role="link"]:focus,
html.va-enhanced-focus [role="link"]:focus-visible,
html.va-enhanced-focus [role="menuitem"]:focus,
html.va-enhanced-focus [role="menuitem"]:focus-visible,
html.va-enhanced-focus [contenteditable="true"]:focus,
html.va-enhanced-focus [contenteditable="true"]:focus-visible {
  outline: 3px solid #ff6b00 !important;
  outline-offset: 3px !important;
  box-shadow: 0 0 0 6px rgba(255, 107, 0, 0.3) !important;
}
`;

  const CSS_LINKS = `
html.va-highlight-links:not(.va-high-contrast) a {
  color: #0066cc !important;
  text-decoration: underline !important;
}
html.va-highlight-links.va-high-contrast a {
  color: #00d4ff !important;
  text-decoration: underline !important;
}
html.va-highlight-links a.va-link-external::after {
  content: " \\2197";
  font-size: 0.85em;
  margin-left: 0.15em;
  text-decoration: none;
  display: inline-block;
}
html.va-highlight-links .va-link-number {
  display: inline;
  font-weight: 700;
  margin-right: 0.25em;
  color: inherit;
  opacity: 0.95;
  font-size: 0.9em;
  vertical-align: baseline;
}
`;

  const CSS_BY_MODE = {
    contrast: CSS_CONTRAST,
    largetext: CSS_LARGE_TEXT,
    cursor: CSS_CURSOR,
    focus: CSS_FOCUS,
    links: CSS_LINKS,
  };

  function isValidMode(mode) {
    return typeof mode === "string" && VALID_MODES.includes(mode);
  }

  function ensureStyleElement(mode) {
    const id = STYLE_ID_BY_MODE[mode];
    if (!id || document.getElementById(id)) {
      return;
    }
    const el = document.createElement("style");
    el.id = id;
    el.textContent = CSS_BY_MODE[mode] || "";
    document.head.appendChild(el);
  }

  function removeStyleElement(mode) {
    const id = STYLE_ID_BY_MODE[mode];
    const existing = id && document.getElementById(id);
    if (existing) {
      existing.remove();
    }
  }

  function isClickableTarget(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }
    if (el === document.documentElement || el === document.body) {
      return false;
    }
    const tag = el.tagName;
    if (tag === "A" || tag === "BUTTON" || tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || tag === "LABEL") {
      return true;
    }
    if (tag === "SUMMARY") {
      return true;
    }
    const role = el.getAttribute && el.getAttribute("role");
    if (role === "button" || role === "link" || role === "menuitem" || role === "tab") {
      return true;
    }
    const tab = el.getAttribute && el.getAttribute("tabindex");
    if (tab !== null && tab !== "-1") {
      return true;
    }
    if (el.getAttribute && el.getAttribute("contenteditable") === "true") {
      return true;
    }
    if (el.onclick || el.getAttribute?.("onclick")) {
      return true;
    }
    return false;
  }

  function updateCursorFollowerState(clientX, clientY) {
    if (!cursorFollower) {
      return;
    }
    cursorFollower.style.opacity = "1";
    const target = document.elementFromPoint(clientX, clientY);
    let clickable = false;
    let node = target;
    for (let i = 0; i < 8 && node; i += 1) {
      if (isClickableTarget(node)) {
        clickable = true;
        break;
      }
      node = node.parentElement;
    }
    cursorFollower.classList.toggle("va-cursor-follower--clickable", clickable);
    const x = clientX - 15;
    const y = clientY - 15;
    cursorFollower.style.left = `${x}px`;
    cursorFollower.style.top = `${y}px`;
  }

  function setupCursorFollower() {
    if (cursorFollower) {
      return;
    }
    cursorFollower = document.createElement("div");
    cursorFollower.id = "va-cursor-follower";
    cursorFollower.setAttribute("aria-hidden", "true");
    document.body.appendChild(cursorFollower);

    cursorMoveHandler = (event) => {
      updateCursorFollowerState(event.clientX, event.clientY);
    };
    cursorLeaveHandler = () => {
      if (cursorFollower) {
        cursorFollower.style.opacity = "0";
      }
    };

    document.addEventListener("mousemove", cursorMoveHandler, true);
    document.documentElement.addEventListener("mouseleave", cursorLeaveHandler, true);
  }

  function teardownCursorFollower() {
    if (cursorMoveHandler) {
      document.removeEventListener("mousemove", cursorMoveHandler, true);
      cursorMoveHandler = null;
    }
    if (cursorLeaveHandler) {
      document.documentElement.removeEventListener("mouseleave", cursorLeaveHandler, true);
      cursorLeaveHandler = null;
    }
    if (cursorFollower && cursorFollower.parentNode) {
      cursorFollower.remove();
    }
    cursorFollower = null;
  }

  function isExternalHref(href) {
    if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:") || href.startsWith("tel:")) {
      return false;
    }
    try {
      const u = new URL(href, window.location.href);
      return u.origin !== window.location.origin;
    } catch (_e) {
      return false;
    }
  }

  function clearLinkDecorations() {
    document.querySelectorAll("a.va-link-external").forEach((a) => {
      a.classList.remove("va-link-external");
    });
    document.querySelectorAll("a .va-link-number").forEach((span) => {
      span.remove();
    });
  }

  function applyLinkDecorations() {
    const anchors = Array.from(document.querySelectorAll("a[href]"));
    anchors.forEach((a, index) => {
      const num = document.createElement("span");
      num.className = "va-link-number";
      num.setAttribute("aria-hidden", "true");
      num.textContent = `[${index + 1}]`;
      a.insertBefore(num, a.firstChild);

      if (isExternalHref(a.getAttribute("href"))) {
        a.classList.add("va-link-external");
      }
    });
  }

  function renumberAllLinks() {
    if (!activeModes.has("links") || linksRenumbering) {
      return;
    }
    linksRenumbering = true;
    try {
      if (linksObserver) {
        linksObserver.disconnect();
        linksObserver = null;
      }
      clearLinkDecorations();
      applyLinkDecorations();
      setupLinksObserver();
    } finally {
      linksRenumbering = false;
    }
  }

  function setupLinksObserver() {
    if (linksObserver) {
      linksObserver.disconnect();
      linksObserver = null;
    }
    linksObserver = new MutationObserver(() => {
      if (!activeModes.has("links") || linksRenumbering) {
        return;
      }
      clearTimeout(linksMutationDebounce);
      linksMutationDebounce = setTimeout(() => {
        linksMutationDebounce = null;
        renumberAllLinks();
      }, 150);
    });
    linksObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  function teardownLinksObserver() {
    clearTimeout(linksMutationDebounce);
    linksMutationDebounce = null;
    if (linksObserver) {
      linksObserver.disconnect();
      linksObserver = null;
    }
  }

  function enable(mode) {
    if (!isValidMode(mode) || activeModes.has(mode)) {
      return;
    }
    activeModes.add(mode);
    const cls = CLASS_BY_MODE[mode];
    if (cls) {
      document.documentElement.classList.add(cls);
    }
    ensureStyleElement(mode);

    if (mode === "cursor") {
      setupCursorFollower();
    }
    if (mode === "links") {
      applyLinkDecorations();
      setupLinksObserver();
    }
  }

  function disable(mode) {
    if (!isValidMode(mode) || !activeModes.has(mode)) {
      return;
    }
    activeModes.delete(mode);
    const cls = CLASS_BY_MODE[mode];
    if (cls) {
      document.documentElement.classList.remove(cls);
    }
    removeStyleElement(mode);

    if (mode === "cursor") {
      teardownCursorFollower();
    }
    if (mode === "links") {
      teardownLinksObserver();
      clearLinkDecorations();
    }
  }

  function toggle(mode) {
    if (!isValidMode(mode)) {
      return;
    }
    if (activeModes.has(mode)) {
      disable(mode);
    } else {
      enable(mode);
    }
  }

  function isActive(mode) {
    return isValidMode(mode) && activeModes.has(mode);
  }

  window.VisionAssistVisual = {
    enable,
    disable,
    toggle,
    isActive,
    init: enable,
    destroy: disable,
  };
})();
