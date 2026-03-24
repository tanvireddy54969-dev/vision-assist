// Background service worker for Gemini-powered accessibility features.
// Handles image descriptions, base64 image descriptions, and webpage summaries.

const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
const GEMINI_KEY_STORAGE_KEY = "geminiApiKey";

// Fallback key used when no key is set in chrome.storage.sync.
// Replace this with your Gemini API key if needed.
const FALLBACK_GEMINI_API_KEY = "AIzaSyDHJIRmS_JQcQLw_H_IPqdzsp6LH4sHuZU";

const IMAGE_DESCRIPTION_PROMPT =
  "Describe this image in one concise sentence for a visually impaired user. Focus on what's important: people, actions, objects, text in the image. Be specific but brief.";

const SUMMARY_PROMPT_PREFIX =
  "Summarize the following webpage content in 3-4 clear, concise sentences for a visually impaired user who wants a quick overview:";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_CACHE_SIZE = 200;
const MAX_REQUESTS_PER_MINUTE = 14; // Keep one request below API cap.
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const QUEUE_WAIT_TIMEOUT_MS = 30 * 1000;

function responseFromGeminiFailure(error) {
  const code = error && error.message;
  switch (code) {
    case "GEMINI_MODEL_NOT_FOUND":
      return {
        success: false,
        error:
          "This Gemini model is unavailable for your key. In service-worker.js try gemini-2.0-flash or check Google AI Studio.",
      };
    case "GEMINI_AUTH_FAILED":
      return {
        success: false,
        error: "Please set your Gemini API key in extension settings",
      };
    case "GEMINI_QUOTA":
      return {
        success: false,
        error: "AI usage quota exceeded. Try again in a few minutes.",
      };
    case "GEMINI_BLOCKED":
      return {
        success: false,
        error: "Description not available for this image",
      };
    case "GEMINI_EMPTY_RESPONSE":
    case "GEMINI_CALL_FAILED":
    default:
      return { success: false, error: "AI service temporarily unavailable" };
  }
}

function runTaskWithoutThrow(task) {
  return (async () => {
    try {
      return await task();
    } catch (error) {
      return responseFromGeminiFailure(error);
    }
  })();
}

// In-memory cache persists for this browser session.
const imageDescriptionCache = new Map(); // Map<imageUrl, description>

// Request timestamps for rate limiting.
const requestTimestamps = [];

// FIFO queue for rate-limited requests.
const requestQueue = [];
let queueTimer = null;

let cachedApiKey = null;
let apiKeyLoaded = false;

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "sync" && changes[GEMINI_KEY_STORAGE_KEY]) {
    cachedApiKey = changes[GEMINI_KEY_STORAGE_KEY].newValue || null;
    apiKeyLoaded = true;
  }
});

async function getGeminiApiKey() {
  try {
    if (!apiKeyLoaded) {
      const result = await chrome.storage.sync.get([GEMINI_KEY_STORAGE_KEY]);
      cachedApiKey = result[GEMINI_KEY_STORAGE_KEY] || null;
      apiKeyLoaded = true;
    }
  } catch (error) {
    // Ignore storage issues and rely on fallback key.
  }

  const key = (cachedApiKey || FALLBACK_GEMINI_API_KEY || "").trim();
  return key || null;
}

function pruneOldTimestamps() {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
  while (requestTimestamps.length && requestTimestamps[0] <= cutoff) {
    requestTimestamps.shift();
  }
}

function getMsUntilNextSlot() {
  pruneOldTimestamps();
  if (requestTimestamps.length < MAX_REQUESTS_PER_MINUTE) {
    return 0;
  }
  const oldest = requestTimestamps[0];
  const wait = RATE_LIMIT_WINDOW_MS - (Date.now() - oldest);
  return Math.max(wait, 0);
}

function scheduleQueueProcessing() {
  if (!requestQueue.length || queueTimer) {
    return;
  }

  const delay = getMsUntilNextSlot();
  queueTimer = setTimeout(() => {
    queueTimer = null;
    processQueue();
  }, delay);
}

async function processQueue() {
  try {
    while (requestQueue.length) {
      const delay = getMsUntilNextSlot();
      if (delay > 0) {
        scheduleQueueProcessing();
        return;
      }

      const item = requestQueue.shift();
      if (!item) {
        break;
      }

      clearTimeout(item.timeoutId);
      requestTimestamps.push(Date.now());

      try {
        const result = await item.task();
        item.resolve(result);
      } catch (error) {
        item.resolve(responseFromGeminiFailure(error));
      }
    }
  } catch (error) {
    // Never let queue processing crash the worker.
  }
}

function enqueueRateLimitedTask(task) {
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      const index = requestQueue.findIndex((entry) => entry.timeoutId === timeoutId);
      if (index >= 0) {
        requestQueue.splice(index, 1);
        resolve({
          success: false,
          error: "Describing images... please wait a moment",
        });
      }
    }, QUEUE_WAIT_TIMEOUT_MS);

    requestQueue.push({ task, resolve, timeoutId });
    scheduleQueueProcessing();
  });
}

async function runWithRateLimit(task) {
  const safeTask = () => runTaskWithoutThrow(task);
  try {
    const delay = getMsUntilNextSlot();
    if (delay <= 0) {
      requestTimestamps.push(Date.now());
      return await safeTask();
    }
    return await enqueueRateLimitedTask(safeTask);
  } catch (error) {
    return responseFromGeminiFailure(error);
  }
}

function setCache(imageUrl, description) {
  if (!imageUrl) {
    return;
  }

  // Refresh recency when updating existing entries.
  if (imageDescriptionCache.has(imageUrl)) {
    imageDescriptionCache.delete(imageUrl);
  }
  imageDescriptionCache.set(imageUrl, description);

  if (imageDescriptionCache.size > MAX_CACHE_SIZE) {
    const oldestKey = imageDescriptionCache.keys().next().value;
    if (oldestKey) {
      imageDescriptionCache.delete(oldestKey);
    }
  }
}

function parseDataUrl(dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl || "");
  if (!match) {
    return null;
  }
  return {
    mimeType: match[1],
    base64: match[2],
  };
}

function base64ByteSize(base64) {
  const cleaned = (base64 || "").replace(/\s/g, "");
  if (!cleaned) {
    return 0;
  }
  const padding = cleaned.endsWith("==") ? 2 : cleaned.endsWith("=") ? 1 : 0;
  return Math.floor((cleaned.length * 3) / 4) - padding;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

async function imageUrlToBase64(imageUrl) {
  if (!imageUrl || typeof imageUrl !== "string") {
    throw new Error("Invalid image URL");
  }

  if (imageUrl.startsWith("data:")) {
    const parsed = parseDataUrl(imageUrl);
    if (!parsed || !parsed.base64 || !parsed.mimeType) {
      throw new Error("Invalid data URL");
    }
    return parsed;
  }

  let fetchUrl = imageUrl;
  try {
    fetchUrl = new URL(imageUrl).href;
  } catch (_error) {
    throw new Error("IMAGE_FETCH_FAILED");
  }

  const fetchHeaders = {
    Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  };
  try {
    const hostname = new URL(fetchUrl).hostname || "";
    if (/wikimedia\.org$/i.test(hostname)) {
      fetchHeaders.Referer = "https://en.wikipedia.org/";
    } else if (/wikipedia\.org$/i.test(hostname)) {
      fetchHeaders.Referer = `https://${hostname}/`;
    }
  } catch (_error) {
    // Referer is optional; ignore parse issues.
  }

  let response;
  try {
    response = await fetch(fetchUrl, {
      credentials: "omit",
      redirect: "follow",
      headers: fetchHeaders,
    });
  } catch (error) {
    throw new Error("IMAGE_FETCH_FAILED");
  }

  if (!response || !response.ok) {
    throw new Error("IMAGE_FETCH_FAILED");
  }

  const blob = await response.blob();
  if (!blob.size) {
    throw new Error("IMAGE_FETCH_FAILED");
  }
  if (blob.type && blob.type.startsWith("text/")) {
    throw new Error("IMAGE_FETCH_FAILED");
  }
  if (blob.size > MAX_IMAGE_BYTES) {
    return { isLargeImage: true };
  }

  const mimeType = blob.type || "image/jpeg";
  const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
  const normalizedMimeType = allowedTypes.includes(mimeType) ? mimeType : "image/jpeg";

  const buffer = await blob.arrayBuffer();
  const base64 = arrayBufferToBase64(buffer);
  return { base64, mimeType: normalizedMimeType };
}

async function callGemini(parts, apiKey) {
  const payload = {
    contents: [{ parts }],
  };

  let response;
  try {
    response = await fetch(`${GEMINI_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw new Error("GEMINI_CALL_FAILED");
  }

  let data;
  try {
    const raw = await response.text();
    data = raw ? JSON.parse(raw) : {};
  } catch (error) {
    throw new Error("GEMINI_CALL_FAILED");
  }

  if (!response.ok) {
    const err = data.error || {};
    const statusStr = String(err.status || "").toUpperCase();
    const combinedMsg = `${err.message || ""} ${statusStr}`.toLowerCase();

    if (response.status === 404 || statusStr === "NOT_FOUND" || combinedMsg.includes("not found")) {
      throw new Error("GEMINI_MODEL_NOT_FOUND");
    }
    if (
      response.status === 403 ||
      statusStr === "PERMISSION_DENIED" ||
      combinedMsg.includes("api key not valid") ||
      combinedMsg.includes("permission denied")
    ) {
      throw new Error("GEMINI_AUTH_FAILED");
    }
    if (
      response.status === 429 ||
      statusStr === "RESOURCE_EXHAUSTED" ||
      combinedMsg.includes("quota") ||
      combinedMsg.includes("rate limit")
    ) {
      throw new Error("GEMINI_QUOTA");
    }
    throw new Error("GEMINI_CALL_FAILED");
  }

  const text =
    data &&
    data.candidates &&
    data.candidates[0] &&
    data.candidates[0].content &&
    data.candidates[0].content.parts &&
    data.candidates[0].content.parts
      .map((part) => part.text || "")
      .join(" ")
      .trim();

  if (text) {
    return text;
  }

  const candidate = data.candidates && data.candidates[0];
  const finishRaw =
    (candidate && (candidate.finishReason || candidate.finish_reason)) || "";
  const finish = String(finishRaw).toUpperCase();
  const blockedFinishes = new Set([
    "SAFETY",
    "BLOCKLIST",
    "PROHIBITED_CONTENT",
    "RECITATION",
    "SPII",
  ]);
  if (finish && blockedFinishes.has(finish)) {
    throw new Error("GEMINI_BLOCKED");
  }

  const promptFb = data.promptFeedback || data.prompt_feedback;
  const blockReason = promptFb && (promptFb.blockReason || promptFb.block_reason);
  if (blockReason) {
    throw new Error("GEMINI_BLOCKED");
  }

  throw new Error("GEMINI_EMPTY_RESPONSE");
}

async function handleDescribeImage(imageUrl) {
  try {
    if (!imageUrl) {
      return { success: false, error: "Could not access this image" };
    }

    if (imageDescriptionCache.has(imageUrl)) {
      return {
        success: true,
        description: imageDescriptionCache.get(imageUrl),
      };
    }

    const apiKey = await getGeminiApiKey();
    if (!apiKey) {
      return {
        success: false,
        error: "Please set your Gemini API key in extension settings",
      };
    }

    const imageData = await imageUrlToBase64(imageUrl);
    if (imageData && imageData.isLargeImage) {
      const largeImageDescription = "Large image";
      setCache(imageUrl, largeImageDescription);
      return { success: true, description: largeImageDescription };
    }

    const description = await runWithRateLimit(async () => {
      const text = await callGemini(
        [
          { text: IMAGE_DESCRIPTION_PROMPT },
          {
            inline_data: {
              mime_type: imageData.mimeType,
              data: imageData.base64,
            },
          },
        ],
        apiKey
      );
      return { success: true, description: text };
    });

    if (description.success) {
      setCache(imageUrl, description.description);
    }
    return description;
  } catch (error) {
    if (error && error.message === "IMAGE_FETCH_FAILED") {
      return { success: false, error: "Could not access this image" };
    }
    if (error && error.message === "GEMINI_BLOCKED") {
      return { success: false, error: "Description not available for this image" };
    }
    return { success: false, error: "AI service temporarily unavailable" };
  }
}

async function handleDescribeImageBase64(base64, mimeType) {
  try {
    const apiKey = await getGeminiApiKey();
    if (!apiKey) {
      return {
        success: false,
        error: "Please set your Gemini API key in extension settings",
      };
    }

    const safeMimeType =
      typeof mimeType === "string" && mimeType.trim() ? mimeType.trim() : "image/jpeg";
    const cleanedBase64 = (base64 || "").replace(/^data:[^;]+;base64,/i, "");
    const sizeBytes = base64ByteSize(cleanedBase64);
    if (sizeBytes > MAX_IMAGE_BYTES) {
      return { success: true, description: "Large image" };
    }

    if (!cleanedBase64) {
      return { success: false, error: "Could not access this image" };
    }

    return await runWithRateLimit(async () => {
      const text = await callGemini(
        [
          { text: IMAGE_DESCRIPTION_PROMPT },
          {
            inline_data: {
              mime_type: safeMimeType,
              data: cleanedBase64,
            },
          },
        ],
        apiKey
      );
      return { success: true, description: text };
    });
  } catch (error) {
    return { success: false, error: "AI service temporarily unavailable" };
  }
}

async function handleSummarizeText(text) {
  try {
    const apiKey = await getGeminiApiKey();
    if (!apiKey) {
      return {
        success: false,
        error: "Please set your Gemini API key in extension settings",
      };
    }

    const content = typeof text === "string" ? text.trim() : "";
    if (!content) {
      return { success: true, summary: "" };
    }

    return await runWithRateLimit(async () => {
      const summary = await callGemini(
        [{ text: `${SUMMARY_PROMPT_PREFIX} ${content}` }],
        apiKey
      );
      return { success: true, summary };
    });
  } catch (error) {
    return { success: false, error: "AI service temporarily unavailable" };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (!message || typeof message.type !== "string") {
        sendResponse({ success: false, error: "Invalid request" });
        return;
      }

      if (message.type === "DESCRIBE_IMAGE") {
        const result = await handleDescribeImage(message.imageUrl);
        sendResponse(result);
        return;
      }

      if (message.type === "DESCRIBE_IMAGE_BASE64") {
        const result = await handleDescribeImageBase64(message.base64, message.mimeType);
        sendResponse(result);
        return;
      }

      if (message.type === "SUMMARIZE_TEXT") {
        const result = await handleSummarizeText(message.text);
        sendResponse(result);
        return;
      }

      sendResponse({ success: false, error: "Unsupported message type" });
    } catch (error) {
      sendResponse({ success: false, error: "AI service temporarily unavailable" });
    }
  })();

  // Keep the message channel open for async responses.
  return true;
});
