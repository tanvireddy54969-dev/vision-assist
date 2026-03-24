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

  function readPageWithTTS() {
    const pageText = (document.body?.innerText || "").trim().replace(/\s+/g, " ");
    if (!pageText) return;
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(pageText);
    speechSynthesis.speak(utterance);
  }

  const modules = {
    tts: {
      init: () => console.log("TTS init"),
      destroy: () => console.log("TTS destroy")
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
      readPageWithTTS();
      sendResponse({ ok: true });
      return true;
    }

    return false;
  });
})();
