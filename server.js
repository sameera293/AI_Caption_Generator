import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const PORT = process.env.PORT || 3000;
const MAX_BODY_SIZE = Number(process.env.MAX_BODY_SIZE || 15_000_000);
const PYTHON_READY_TIMEOUT = Number(process.env.PYTHON_READY_TIMEOUT || 20000);
const PUBLIC_DIR = join(process.cwd(), "public");

function loadEnvFile() {
  const envPath = join(process.cwd(), ".env");

  if (!existsSync(envPath)) {
    return;
  }

  const fileContents = readFileSync(envPath, "utf-8");

  for (const line of fileContents.split(/\r?\n/)) {
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmedLine.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();
    let value = trimmedLine.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1).trim();
    }

    if (key && !process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadEnvFile();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  response.end(JSON.stringify(payload));
}

let pythonWorker = null;
let pythonWorkerReady = false;
let pythonWorkerQueue = new Map();
let pythonWorkerCounter = 0;
const pythonReadyWaiters = new Set();

function startPythonWorker() {
  if (pythonWorker) {
    return;
  }

  const scriptPath = join(process.cwd(), "py", "caption_worker.py");
  pythonWorker = spawn("python", ["-u", scriptPath], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      TRANSFORMERS_OFFLINE: "1",
      HF_HUB_DISABLE_TELEMETRY: "1",
    },
  });

  const lineReader = createInterface({ input: pythonWorker.stdout });

  lineReader.on("line", (line) => {
    if (!line.trim()) {
      return;
    }

    try {
      const message = JSON.parse(line);
      if (message.type === "ready") {
        pythonWorkerReady = true;
        for (const waiter of pythonReadyWaiters) {
          waiter();
        }
        pythonReadyWaiters.clear();
        return;
      }

      const { id, caption, captions, error } = message;
      const pending = pythonWorkerQueue.get(id);
      if (!pending) {
        return;
      }
      pythonWorkerQueue.delete(id);

      if (error) {
        pending.reject(new Error(error));
        return;
      }
      pending.resolve({ caption, captions });
    } catch (error) {
      // Ignore malformed lines.
    }
  });

  pythonWorker.stderr.on("data", (chunk) => {
    const message = chunk.toString();

    // Ignore HF unauthenticated warnings and other non-fatal notices.
    if (
      message.includes("unauthenticated requests") ||
      message.includes("Warning:") ||
      message.includes("Loading weights")
    ) {
      return;
    }

    for (const pending of pythonWorkerQueue.values()) {
      pending.reject(new Error(message));
    }
    pythonWorkerQueue.clear();
  });

  pythonWorker.on("exit", () => {
    pythonWorker = null;
    pythonWorkerReady = false;
    for (const waiter of pythonReadyWaiters) {
      waiter(new Error("Python worker exited before ready."));
    }
    pythonReadyWaiters.clear();
  });
}

function waitForPythonReady(timeoutMs = PYTHON_READY_TIMEOUT) {
  if (pythonWorkerReady) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const waiter = (error) => {
      clearTimeout(timer);
      pythonReadyWaiters.delete(waiter);
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    const timer = setTimeout(() => {
      pythonReadyWaiters.delete(waiter);
      reject(new Error("Python captioner is still warming up."));
    }, timeoutMs);

    pythonReadyWaiters.add(waiter);
  });
}

function runPythonCaptioner(imageDataUrl, style = "professional", count = 1) {
  return new Promise((resolve, reject) => {
    startPythonWorker();

    waitForPythonReady()
      .then(() => {
        const id = String(++pythonWorkerCounter);
        pythonWorkerQueue.set(id, { resolve, reject });

        const payload = JSON.stringify({ id, imageDataUrl, style, count });
        pythonWorker.stdin.write(`${payload}\n`);
      })
      .catch(reject);
  });
}

function hasOpenAiKey() {
  const apiKey = process.env.OPENAI_API_KEY || "";
  return Boolean(apiKey.trim() && apiKey.trim() !== "your_actual_key_here");
}

function getModelMode() {
  const modelDir = process.env.BLIP_MODEL_DIR || "";
  return modelDir.trim() ? "fine-tuned" : "pretrained";
}

function getStyleInstruction(style) {
  const styles = {
    professional:
      "Use a polished, clear, professional tone suitable for a brand, portfolio, or product presentation.",
    storytelling:
      "Use a narrative tone that feels like a short story moment, but stay grounded in visible details.",
    minimal:
      "Use a minimal, concise caption with 4-8 words, no extra adjectives or fluff.",
    instagram:
      "Use an Instagram-friendly tone that feels trendy, catchy, and natural. Emojis are allowed but not required.",
  };

  return styles[style] || styles.professional;
}

function sanitizePath(urlPath) {
  const safePath = normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  const normalizedPath =
    safePath === "/" || safePath === "\\" ? "index.html" : safePath.replace(/^[/\\]+/, "");
  return join(PUBLIC_DIR, normalizedPath);
}

function generateFallbackCaption({ fileName = "image", palette = [] }) {
  const cleanedName = fileName.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
  const tones = palette.length
    ? `featuring ${palette.slice(0, 3).join(", ")} tones`
    : "with a clean visual mood";

  const options = [
    `A polished moment from ${cleanedName || "your upload"}, ${tones}.`,
    `Visual story from ${cleanedName || "this scene"} ${tones} and project-ready charm.`,
    `Fresh upload energy: ${cleanedName || "an eye-catching frame"} ${tones}.`,
  ];

  return options[Math.floor(Math.random() * options.length)];
}

function analyzeImageDataUrl(imageDataUrl) {
  if (!imageDataUrl || typeof imageDataUrl !== "string") {
    return null;
  }

  const match = imageDataUrl.match(/^data:image\/(\w+);base64,/i);

  if (!match) {
    return null;
  }

  const mimeType = match[1];
  const base64Payload = imageDataUrl.split(",")[1];

  if (!base64Payload) {
    return null;
  }

  try {
    const buffer = Buffer.from(base64Payload, "base64");
    const pixelOffset = buffer.indexOf(Buffer.from([0xff, 0xd9]));

    // Short-circuit if this isn't a JPEG; we still can use size heuristic.
    const byteSize = buffer.length;
    const sizeLabel =
      byteSize < 40000 ? "compact" : byteSize < 250000 ? "balanced" : "high-detail";

    let colorMood = "neutral";
    let brightness = "soft";

    if (mimeType === "jpeg" || mimeType === "jpg") {
      // Quick heuristic: sample some bytes and map to tone.
      let sum = 0;
      let count = 0;
      for (let i = 0; i < buffer.length; i += Math.max(1, Math.floor(buffer.length / 500))) {
        sum += buffer[i];
        count += 1;
      }
      const avg = sum / Math.max(1, count);

      brightness = avg > 170 ? "bright" : avg > 110 ? "balanced" : "moody";
      colorMood = avg > 180 ? "airy" : avg > 130 ? "warm" : "deep";
    }

    return {
      byteSize,
      sizeLabel,
      colorMood,
      brightness,
    };
  } catch (error) {
    return null;
  }
}

function generateHeuristicCaption({ fileName = "image", palette = [], imageDataUrl }) {
  const cleanedName = fileName.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
  const tones = palette.length
    ? palette.slice(0, 3).join(", ")
    : "neutral, warm";
  const analysis = analyzeImageDataUrl(imageDataUrl);
  const sizeNote = analysis ? analysis.sizeLabel : "balanced";
  const mood = analysis ? analysis.colorMood : "warm";
  const light = analysis ? analysis.brightness : "soft";

  const options = [
    `A ${light}, ${mood}-toned frame from ${cleanedName || "your image"}, with ${tones} hues.`,
    `${cleanedName || "This upload"} feels ${mood} and ${light}, with ${tones} notes throughout.`,
    `A ${sizeNote}, ${mood} visual moment from ${cleanedName || "the scene"}, colored by ${tones}.`,
    `A ${light} ${mood} vibe with ${tones} tones in ${cleanedName || "this snapshot"}.`,
  ];

  return options[Math.floor(Math.random() * options.length)];
}

async function generateCaptionWithOpenAI(imageDataUrl, style = "professional") {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return null;
  }

  const body = {
    model: "gpt-4.1-mini",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `Look carefully at the uploaded image and write one caption that clearly matches the visible subject, setting, or action. ${getStyleInstruction(style)} Keep it under 18 words, natural, vivid, and specific to the image. Do not invent details. Return only the caption.`,
          },
          {
            type: "input_image",
            image_url: imageDataUrl,
            detail: "high",
          },
        ],
      },
    ],
  };

  const openAiResponse = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!openAiResponse.ok) {
    const errorText = await openAiResponse.text();
    throw new Error(`OpenAI request failed: ${openAiResponse.status} ${errorText}`);
  }

  const data = await openAiResponse.json();
  const caption =
    data.output_text?.trim() ||
    data.output?.flatMap((item) => item.content || []).find((entry) => entry.text)?.text?.trim();

  if (!caption) {
    throw new Error("No caption returned by the model.");
  }

  return caption;
}

async function serveStaticAsset(request, response) {
  try {
    const requestUrl = new URL(request.url, `http://${request.headers.host}`);
    const filePath = sanitizePath(requestUrl.pathname);
    const extension = extname(filePath);
    const contents = await readFile(filePath);
    const cacheHeader =
      extension === ".html" ? "no-cache" : "public, max-age=604800, immutable";

    response.writeHead(200, {
      "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
      "Cache-Control": cacheHeader,
      "X-Content-Type-Options": "nosniff",
    });
    response.end(contents);
  } catch (error) {
    response.writeHead(404, {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    });
    response.end("Not found");
  }
}

async function readRequestBody(request) {
  let rawBody = "";
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_SIZE) {
      throw new Error("Payload too large.");
    }
    rawBody += chunk;
  }

  return rawBody;
}

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/api/status") {
    sendJson(response, 200, {
      aiEnabled: hasOpenAiKey(),
      pythonReady: pythonWorkerReady,
      maxBodySize: MAX_BODY_SIZE,
      modelMode: getModelMode(),
    });
    return;
  }

  if (request.method === "GET" && request.url === "/api/health") {
    sendJson(response, 200, {
      status: "ok",
      pythonReady: pythonWorkerReady,
      openaiConfigured: hasOpenAiKey(),
      modelMode: getModelMode(),
    });
    return;
  }

  if (request.method === "POST" && request.url === "/api/caption") {
    let rawBody = "";

    try {
      rawBody = await readRequestBody(request);

      const payload = JSON.parse(rawBody);

      if (!payload.imageDataUrl) {
        sendJson(response, 400, { error: "Image data is required." });
        return;
      }

      const style = payload.style || "professional";
      const count = Math.min(Math.max(Number(payload.count || 1), 1), 5);

      if (!hasOpenAiKey()) {
        const result = await runPythonCaptioner(payload.imageDataUrl, style, count);
        sendJson(response, 200, {
          caption: result.caption,
          captions: result.captions,
          source: "local",
          style,
        });
        return;
      }

      try {
        const caption = await generateCaptionWithOpenAI(payload.imageDataUrl, style);
        sendJson(response, 200, { caption, captions: [caption], source: "openai", style });
        return;
      } catch (error) {
        const result = await runPythonCaptioner(payload.imageDataUrl, style, count);
        sendJson(response, 200, {
          caption: result.caption,
          captions: result.captions,
          source: "local",
          style,
          warning: "OpenAI unavailable. Falling back to local caption.",
        });
        return;
      }
    } catch (error) {
      if (error?.message === "Payload too large.") {
        sendJson(response, 413, {
          error: "Image payload is too large. Please upload a smaller file.",
        });
        return;
      }

      let safePayload = {};
      try {
        safePayload = JSON.parse(rawBody || "{}");
      } catch (parseError) {
        safePayload = {};
      }
      const fallbackCaption = generateFallbackCaption(safePayload);
      sendJson(response, 500, {
        error: "Something went wrong while generating the caption. Check your API key and try again.",
        errorDetail: error?.message || "Unknown error",
        fallbackCaption,
      });
      return;
    }
  }

  await serveStaticAsset(request, response);
});

process.on("SIGINT", () => {
  if (pythonWorker) {
    pythonWorker.kill("SIGTERM");
  }
  process.exit(0);
});

server.listen(PORT, () => {
  console.log(`Caption Craft is running at http://localhost:${PORT}`);
});
