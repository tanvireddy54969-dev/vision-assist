(() => {
  if (window.VisionAssistImageDescriber) {
    return;
  }

  const STYLE_ID = "va-image-describer-style";
  const IMAGE_MIN_SIZE = 50;
  const TOOLTIP_LOADING_TEXT = "Analyzing image...";
  const TOOLTIP_ERROR_TEXT = "Description unavailable";
  const BADGE_TEXT = "AI";

  const state = {
    enabled: false,
    imageObserver: null,
    mutationObserver: null,
    resizeHandler: null,
    scrollHandler: null,
    processedImages: new WeakSet(),
    imageMeta: new WeakMap(),
    imageToContainer: new WeakMap(),
    imageToBadge: new WeakMap(),
    imageToTooltip: new WeakMap(),
    pendingDescriptions: new WeakSet()
  };

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      /* Wrapper around the image: guarantees a wide enough containing block for the
         tooltip. Without this, an inline <a> parent can be ~0–24px “wide” for abs
         children and forces one character per line. */
      .va-img-container {
        position: relative !important;
        display: inline-block !important;
        max-width: 100% !important;
        vertical-align: baseline !important;
      }

      .va-img-container > img {
        display: block !important;
        max-width: 100% !important;
        height: auto !important;
      }

      .va-ai-badge {
        position: absolute !important;
        top: 6px !important;
        right: 6px !important;
        width: 24px !important;
        height: 24px !important;
        border-radius: 999px !important;
        border: none !important;
        background: #1d4ed8 !important;
        color: #ffffff !important;
        font: 700 10px/24px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
        text-align: center !important;
        cursor: pointer !important;
        z-index: 2147483646 !important;
        padding: 0 !important;
        margin: 0 !important;
      }

      .va-ai-badge:focus-visible {
        outline: 2px solid #ffffff !important;
        outline-offset: 2px !important;
        box-shadow: 0 0 0 2px #1d4ed8 !important;
      }

      /* Sibling of .va-ai-badge under .va-img-container — never inside the 24px badge. */
      .va-ai-tooltip {
        position: absolute !important;
        top: 34px !important;
        right: 6px !important;
        left: auto !important;
        width: 300px !important;
        max-width: min(300px, calc(100vw - 32px)) !important;
        min-width: 200px !important;
        background: #333 !important;
        color: #fff !important;
        border-radius: 8px !important;
        padding: 8px 10px !important;
        font: 500 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
        white-space: normal !important;
        word-wrap: break-word !important;
        overflow-wrap: break-word !important;
        word-break: normal !important;
        writing-mode: horizontal-tb !important;
        text-orientation: mixed !important;
        unicode-bidi: plaintext !important;
        direction: ltr !important;
        box-sizing: border-box !important;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35) !important;
        z-index: 2147483647 !important;
        display: none !important;
        pointer-events: none !important;
        overflow: visible !important;
      }

      .va-ai-tooltip[data-visible="true"] {
        display: block !important;
      }
    `;
    document.head.appendChild(style);
  }

  function hasMeaningfulAltText(img) {
    const alt = (img.getAttribute("alt") || "").trim();
    if (alt.length <= 10) {
      return false;
    }
    const normalized = alt.toLowerCase();
    const generic = ["image", "photo", "img"];
    return !generic.includes(normalized);
  }

  function getDescribeSourceUrl(img) {
    const raw = (img.currentSrc || img.src || "").trim();
    if (!raw) return "";
    try {
      return new URL(raw, document.baseURI).href;
    } catch (_error) {
      return raw;
    }
  }

  function shouldProcessImage(img) {
    if (!(img instanceof HTMLImageElement)) return false;
    if (!img.isConnected) return false;
    if (!getDescribeSourceUrl(img)) return false;
    if (state.processedImages.has(img)) return false;
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      if (img.naturalWidth < IMAGE_MIN_SIZE || img.naturalHeight < IMAGE_MIN_SIZE) {
        return false;
      }
    } else if (img.width < IMAGE_MIN_SIZE || img.height < IMAGE_MIN_SIZE) {
      return false;
    }
    if (hasMeaningfulAltText(img)) return false;
    return true;
  }

  function createOverlay(img) {
    if (state.imageToBadge.has(img)) {
      return;
    }

    const parent = img.parentElement;
    if (!parent) {
      return;
    }

    let container = parent;
    if (!parent.classList.contains("va-img-container")) {
      const wrapper = document.createElement("span");
      wrapper.className = "va-img-container";
      parent.insertBefore(wrapper, img);
      wrapper.appendChild(img);
      container = wrapper;
    }

    const badge = document.createElement("button");
    badge.type = "button";
    badge.className = "va-ai-badge";
    badge.textContent = BADGE_TEXT;
    badge.setAttribute("aria-label", "AI image description");

    const tooltip = document.createElement("div");
    tooltip.className = "va-ai-tooltip";
    tooltip.textContent = TOOLTIP_LOADING_TEXT;
    tooltip.setAttribute("role", "tooltip");
    tooltip.setAttribute("data-visible", "false");

    container.appendChild(badge);
    container.appendChild(tooltip);

    const showTooltip = () => {
      tooltip.setAttribute("data-visible", "true");
    };
    const hideTooltip = () => {
      tooltip.setAttribute("data-visible", "false");
    };

    badge.addEventListener("mouseenter", showTooltip);
    badge.addEventListener("mouseleave", hideTooltip);
    badge.addEventListener("focus", showTooltip);
    badge.addEventListener("blur", hideTooltip);
    img.addEventListener("mouseenter", showTooltip);
    img.addEventListener("mouseleave", hideTooltip);

    img.setAttribute("tabindex", "0");
    img.addEventListener("focus", () => {
      showTooltip();
      const meta = state.imageMeta.get(img);
      const description = meta?.description || TOOLTIP_LOADING_TEXT;
      speakImageDescription(description);
    });
    img.addEventListener("blur", hideTooltip);

    state.imageToBadge.set(img, badge);
    state.imageToTooltip.set(img, tooltip);
    state.imageToContainer.set(img, container);
    state.imageMeta.set(img, {
      description: TOOLTIP_LOADING_TEXT,
      described: false
    });
  }

  function updateOverlay(img, descriptionText, isError) {
    const tooltip = state.imageToTooltip.get(img);
    const meta = state.imageMeta.get(img);
    if (!tooltip || !meta) {
      return;
    }

    const trimmed = typeof descriptionText === "string" ? descriptionText.trim() : "";
    const finalText = trimmed || TOOLTIP_ERROR_TEXT;
    tooltip.textContent = finalText;
    meta.description = finalText;
    meta.described = !isError;

    if (!isError) {
      img.setAttribute("aria-label", finalText);
    }
  }

  function whenImageReadyForDescribe(img) {
    if (img.complete && img.naturalWidth > 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const done = () => resolve();
      img.addEventListener("load", done, { once: true });
      img.addEventListener("error", done, { once: true });
      setTimeout(done, 5000);
    });
  }

  async function requestDescription(img) {
    if (state.pendingDescriptions.has(img)) {
      return;
    }

    state.pendingDescriptions.add(img);
    await whenImageReadyForDescribe(img);

    const imageUrl = getDescribeSourceUrl(img);
    if (!imageUrl) {
      state.pendingDescriptions.delete(img);
      updateOverlay(img, "Could not access this image", true);
      return;
    }

    chrome.runtime.sendMessage({ type: "DESCRIBE_IMAGE", imageUrl }, (response) => {
      state.pendingDescriptions.delete(img);

      if (chrome.runtime.lastError) {
        updateOverlay(img, TOOLTIP_ERROR_TEXT, true);
        return;
      }

      if (response && response.success) {
        updateOverlay(img, response.description, false);
      } else {
        const errorText = response?.error || TOOLTIP_ERROR_TEXT;
        updateOverlay(img, errorText, true);
      }
    });
  }

  function onImageIntersect(entries) {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const img = entry.target;
      const meta = state.imageMeta.get(img);
      if (!meta || meta.described) continue;
      requestDescription(img).catch(() => {
        state.pendingDescriptions.delete(img);
        updateOverlay(img, TOOLTIP_ERROR_TEXT, true);
      });
      if (state.imageObserver) {
        state.imageObserver.unobserve(img);
      }
    }
  }

  function processImage(img) {
    if (!shouldProcessImage(img)) {
      return;
    }

    state.processedImages.add(img);
    createOverlay(img);
    if (state.imageObserver) {
      state.imageObserver.observe(img);
    }
  }

  function scanImages(root = document) {
    const images = root.querySelectorAll("img");
    for (const img of images) {
      processImage(img);
    }
  }

  function handleMutations(mutations) {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.tagName === "IMG") {
          processImage(node);
        } else {
          scanImages(node);
        }
      }
    }
  }

  function speakImageDescription(description) {
    // Speak only when TTS module is present and browser speech APIs are available.
    if (!window.VisionAssistTTS || !("speechSynthesis" in window)) {
      return;
    }
    const text = `Image: ${description || TOOLTIP_ERROR_TEXT}`;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      window.speechSynthesis.speak(utterance);
    } catch (_error) {
      // Never fail image interactions due to speech issues.
    }
  }

  function initObservers() {
    state.imageObserver = new IntersectionObserver(onImageIntersect, {
      root: null,
      threshold: 0.15
    });

    state.mutationObserver = new MutationObserver(handleMutations);
    state.mutationObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  function init() {
    if (state.enabled) {
      return;
    }
    state.enabled = true;

    injectStyles();
    initObservers();
    scanImages(document);
  }

  function destroy() {
    if (!state.enabled) {
      return;
    }
    state.enabled = false;

    if (state.imageObserver) {
      state.imageObserver.disconnect();
      state.imageObserver = null;
    }
    if (state.mutationObserver) {
      state.mutationObserver.disconnect();
      state.mutationObserver = null;
    }
    if (state.resizeHandler) {
      window.removeEventListener("resize", state.resizeHandler);
      state.resizeHandler = null;
    }
    if (state.scrollHandler) {
      window.removeEventListener("scroll", state.scrollHandler);
      state.scrollHandler = null;
    }

    document.querySelectorAll(".va-ai-tooltip").forEach((el) => el.remove());
    document.querySelectorAll(".va-ai-badge").forEach((badge) => badge.remove());

    document.querySelectorAll(".va-img-container").forEach((wrapper) => {
      const innerImg = wrapper.querySelector(":scope > img");
      if (innerImg && wrapper.parentElement) {
        wrapper.parentElement.insertBefore(innerImg, wrapper);
      }
      wrapper.remove();
    });
  }

  window.VisionAssistImageDescriber = {
    init,
    destroy
  };

  init();
})();
