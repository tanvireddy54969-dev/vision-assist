const imageDescriptionCache = new Map();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "DESCRIBE_IMAGE") {
    const imageUrl = message.imageUrl || "";
    if (!imageUrl) {
      sendResponse({ ok: false, error: "Missing imageUrl" });
      return false;
    }

    if (imageDescriptionCache.has(imageUrl)) {
      sendResponse({ ok: true, description: imageDescriptionCache.get(imageUrl), cached: true });
      return false;
    }

    const mockDescription = `Mock description for image: ${imageUrl}`;
    imageDescriptionCache.set(imageUrl, mockDescription);
    sendResponse({ ok: true, description: mockDescription, cached: false });
    return false;
  }

  if (message?.type === "SUMMARIZE_TEXT") {
    const text = message.text || "";
    if (!text.trim()) {
      sendResponse({ ok: false, error: "Missing text input" });
      return false;
    }

    const summary = text.length > 220 ? `${text.slice(0, 220)}...` : text;
    sendResponse({ ok: true, summary: `Mock summary: ${summary}` });
    return false;
  }

  return false;
});
