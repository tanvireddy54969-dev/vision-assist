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

  const modules = {
    tts: {
      init: () => {
        const tts = window.VisionAssistTTS;
        if (!tts) {
          console.warn("VisionAssistTTS module not available");
          return;
        }
        if (typeof tts.init === "function") {
          tts.init();
          return;
        }
        // If the module is already loaded but has no init lifecycle, keep it usable.
        if (typeof tts.readPage === "function") {
          console.log("VisionAssistTTS loaded (no init method)");
        } else {
          console.warn("VisionAssistTTS module not available");
        }
      },
      destroy: () => {
        const tts = window.VisionAssistTTS;
        if (!tts) return;
        if (typeof tts.stop === "function") {
          tts.stop();
        }
        if (typeof tts.destroy === "function") {
          tts.destroy();
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
        window.VisionAssistTTS.readPage();
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: "VisionAssistTTS module not available" });
      }
      return true;
    }

    return false;
  });
})();
