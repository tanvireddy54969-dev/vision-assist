(() => {
  const state = {
    tts: false,
    images: false,
    voice: false,
    contrast: false,
    largetext: false,
    simplify: false
  };

  function toggleCSS(name, enabled) {
    const classMap = {
      "high-contrast": "va-high-contrast",
      "large-text": "va-large-text",
      simplified: "va-simplified"
    };
    const className = classMap[name];
    if (!className) return;
    document.body.classList.toggle(className, enabled);
  }

  async function fallbackReadPageWithChromeTTS() {
    const text = (document.body?.innerText || "").trim().replace(/\s+/g, " ");
    if (!text) return { ok: false, error: "No readable content found" };

    const data = await chrome.storage.sync.get("visionAssistSettings");
    const settings = data.visionAssistSettings || {};
    const rate = Number(settings.ttsSpeed ?? 1.0) || 1.0;
    const clipped = text.slice(0, 5000);
    return chrome.runtime.sendMessage({ type: "TTS_SPEAK", text: clipped, rate });
  }

  const modules = {
    tts: {
      init: () => {
        if (window.VisionAssistTTS?.init) {
          window.VisionAssistTTS.init();
        } else {
          console.warn("VisionAssistTTS module not available");
        }
      },
      destroy: () => {
        if (window.VisionAssistTTS?.destroy) {
          window.VisionAssistTTS.destroy();
        }
      }
    },
    images: {
      init: () => console.log("Images init"),
      destroy: () => console.log("Images destroy")
    },
    voice: {
      init: () => console.log("Voice init"),
      destroy: () => console.log("Voice destroy")
    },
    contrast: {
      init: () => toggleCSS("high-contrast", true),
      destroy: () => toggleCSS("high-contrast", false)
    },
    largetext: {
      init: () => toggleCSS("large-text", true),
      destroy: () => toggleCSS("large-text", false)
    },
    simplify: {
      init: () => toggleCSS("simplified", true),
      destroy: () => toggleCSS("simplified", false)
    }
  };

  function setFeatureState(feature, enabled) {
    const moduleHandler = modules[feature];
    if (!moduleHandler) return;

    state[feature] = enabled;
    if (enabled) {
      moduleHandler.init();
    } else {
      moduleHandler.destroy();
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "TOGGLE_FEATURE") {
      setFeatureState(message.feature, Boolean(message.enabled));
      sendResponse({ ok: true, state: { ...state } });
      return true;
    }

    if (message?.type === "READ_PAGE") {
      if (window.VisionAssistTTS?.readPage) {
        // Ensure TTS is initialized even if toggle sync lagged.
        if (window.VisionAssistTTS?.init) {
          window.VisionAssistTTS.init();
          state.tts = true;
        }
        try {
          window.VisionAssistTTS.readPage();
          sendResponse({ ok: true, mode: "speechSynthesis" });
        } catch (_error) {
          fallbackReadPageWithChromeTTS()
            .then((result) => sendResponse({ ok: true, mode: "chrome.tts", result }))
            .catch((fallbackError) => sendResponse({ ok: false, error: fallbackError.message }));
        }
      } else {
        fallbackReadPageWithChromeTTS()
          .then((result) => sendResponse({ ok: true, mode: "chrome.tts", result }))
          .catch((fallbackError) => sendResponse({ ok: false, error: fallbackError.message }));
      }
      return true;
    }

    return false;
  });
})();
