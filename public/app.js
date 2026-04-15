const imageInput = document.getElementById("imageInput");
const uploadZone = document.getElementById("uploadZone");
const previewFrame = document.getElementById("previewFrame");
const previewImage = document.getElementById("previewImage");
const generateBtn = document.getElementById("generateBtn");
const copyBtn = document.getElementById("copyBtn");
const captionText = document.getElementById("captionText");
const statusBadge = document.getElementById("statusBadge");
const sourceTag = document.getElementById("sourceTag");
const modelTag = document.getElementById("modelTag");
const setupNote = document.getElementById("setupNote");
const styleChips = [...document.querySelectorAll(".style-chip")];
const themeToggle = document.getElementById("themeToggle");
const removeImageBtn = document.getElementById("removeImageBtn");
const toastContainer = document.getElementById("toastContainer");
const captionGrid = document.getElementById("captionGrid");
let captionCards = [];
const activeIndicator = document.querySelector(".active-indicator");
const sampleButtons = [...document.querySelectorAll(".sample-btn")];
const regenBtn = document.querySelector(".regen-btn");
const countChips = [...document.querySelectorAll(".count-chip")];
const previewEmpty = previewFrame.querySelector(".preview-empty");
const initialCaptionText = captionText.textContent;
let lastGeneratedCaption = "";
let isGenerating = false;
const sampleImageBtn = document.getElementById("sampleImageBtn");
const quickDemoBtn = document.getElementById("quickDemoBtn");
console.log("[caption-app] script loaded");
console.log("[caption-app] script loaded");

let currentImageDataUrl = "";
let currentFileName = "";
let currentPalette = [];
let aiEnabled = false;
let selectedStyle = "professional";
let selectedCount = 3;

function setStatus(message, source = "Demo mode") {
  statusBadge.textContent = message;
  sourceTag.textContent = source;
}

function setCaption(message) {
  captionText.textContent = message;
  captionText.classList.remove("caption-pop");
  setTimeout(() => {
    captionText.classList.add("caption-pop");
  }, 20);

  renderCaptionCards([message]);
}

function labelForStyle(style) {
  const labels = {
    professional: "Professional",
    storytelling: "Storytelling",
    minimal: "Minimal",
    instagram: "Instagram",
  };

  return labels[style] || "Professional";
}

function selectStyle(style) {
  selectedStyle = style;

  for (const chip of styleChips) {
    chip.classList.toggle("is-selected", chip.dataset.style === style);
  }

  if (activeIndicator) {
    const activeChip = styleChips.find((chip) => chip.dataset.style === style);
    if (activeChip) {
      activeIndicator.style.transform = `translateX(${activeChip.offsetLeft}px)`;
      activeIndicator.style.width = `${activeChip.offsetWidth}px`;
    }
  }

  if (currentImageDataUrl) {
    setCaption(`Image ready. Generate a ${labelForStyle(style).toLowerCase()} caption when you're set.`);
    setStatus(aiEnabled ? "Ready to generate" : "Ready (local mode)", sourceTag.textContent);
  }
}

function selectCount(count) {
  selectedCount = count;
  for (const chip of countChips) {
    chip.classList.toggle("is-selected", Number(chip.dataset.count) === count);
  }
  if (currentImageDataUrl) {
    setStatus(`Ready to generate (${count} captions)`, sourceTag.textContent);
  }
}

function setAiState(enabled) {
  aiEnabled = enabled;
  sourceTag.textContent = enabled ? "OpenAI vision ready" : "Local vision (Python)";
  setupNote.textContent = enabled
    ? "AI vision is active. Captions will be generated from the uploaded image."
    : "No API key detected. Captions will be generated locally using a Python vision model.";
}

function setModelTag(mode) {
  if (!modelTag) {
    return;
  }
  const normalized = (mode || "").toLowerCase();
  const label = normalized === "fine-tuned" ? "Fine-tuned" : "Pretrained";
  modelTag.textContent = `Model: ${label}`;
  modelTag.classList.toggle("is-finetuned", normalized === "fine-tuned");
}

function updatePreview(imageDataUrl) {
  if (previewEmpty) {
    previewEmpty.classList.add("is-hidden");
  }

  previewImage.classList.remove("is-visible");
  previewImage.style.display = "block";
  previewImage.src = "";

  requestAnimationFrame(() => {
    previewImage.src = imageDataUrl;
  });

  previewImage.onload = () => {
    previewImage.classList.add("is-visible");
    console.log("[caption-app] preview updated");
  };
  previewImage.onerror = () => {
    console.error("[caption-app] preview failed to load");
    showToast("Preview failed to load");
  };
}

function getColorName(r, g, b) {
  const isLight = r + g + b > 620;
  const max = Math.max(r, g, b);

  if (max === r && g > 140) return "sunset";
  if (max === r) return isLight ? "rose" : "crimson";
  if (max === g) return isLight ? "sage" : "forest";
  if (max === b) return isLight ? "sky" : "midnight";
  return isLight ? "ivory" : "espresso";
}

function extractPalette(imageDataUrl) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      const sampleSize = 24;

      canvas.width = sampleSize;
      canvas.height = sampleSize;
      context.drawImage(image, 0, 0, sampleSize, sampleSize);

      const { data } = context.getImageData(0, 0, sampleSize, sampleSize);
      const buckets = [];

      for (let index = 0; index < data.length; index += 4) {
        buckets.push(getColorName(data[index], data[index + 1], data[index + 2]));
      }

      const uniquePalette = [...new Set(buckets)].slice(0, 4);
      resolve(uniquePalette);
    };

    image.onerror = () => resolve([]);
    image.src = imageDataUrl;
  });
}

async function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Unable to read file."));
    reader.readAsDataURL(file);
  });
}

async function handleSelectedFile(file) {
  if (!file) {
    return;
  }

  console.log("[caption-app] image selected", file.name);
  currentFileName = file.name;
  currentImageDataUrl = await readFileAsDataUrl(file);
  currentPalette = await extractPalette(currentImageDataUrl);

  updatePreview(currentImageDataUrl);
  setCaption("Image ready. Generate a caption when you're set.");
  setStatus(aiEnabled ? "Ready to generate" : "Ready (local mode)", sourceTag.textContent);
  generateBtn.disabled = false;
  copyBtn.disabled = true;

  showToast("Image uploaded");
}

async function handleSampleImage(sample) {
  const dataUrl = SAMPLE_IMAGES[sample];
  if (!dataUrl) {
    return;
  }

  console.log("[caption-app] sample image loaded", sample);
  currentFileName = sample === "demo" ? "demo.jpg" : `${sample}.png`;
  try {
    currentImageDataUrl = await normalizeSampleImage(dataUrl);
  } catch (error) {
    console.error("[caption-app] sample image load failed", error);
    showToast("Sample image failed to load");
    return;
  }
  currentPalette = await extractPalette(currentImageDataUrl);

  updatePreview(currentImageDataUrl);
  setCaption("Sample image loaded. Generate a caption when you're set.");
  setStatus(aiEnabled ? "Ready to generate" : "Ready (local mode)", sourceTag.textContent);
  generateBtn.disabled = false;
  copyBtn.disabled = true;
  showToast("Sample image loaded");
}

async function fetchStatus() {
  try {
    const response = await fetch("/api/status");
    const payload = await response.json();
    setAiState(Boolean(payload.aiEnabled));
    setStatus(payload.aiEnabled ? "AI ready" : "Local mode ready", sourceTag.textContent);
    setModelTag(payload.modelMode);
  } catch (error) {
    setAiState(false);
    setStatus("Status unavailable", "Connection issue");
    setModelTag("unknown");
  }
}

async function generateCaption() {
  if (!currentImageDataUrl) {
    return;
  }

  if (isGenerating) {
    return;
  }

  isGenerating = true;
  console.log("[caption-app] caption generation triggered");
  setCaption("Generating a caption...");
  setStatus("Generating", aiEnabled ? "OpenAI vision" : "Local vision (Python)");
  generateBtn.classList.add("is-loading");
  generateBtn.disabled = true;
  copyBtn.disabled = true;

  try {
    const response = await fetch("/api/caption", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        imageDataUrl: currentImageDataUrl,
        fileName: currentFileName,
        palette: currentPalette,
        style: selectedStyle,
        count: selectedCount,
      }),
    });

    const payload = await response.json();

    if (!response.ok) {
      const detailSuffix = payload.errorDetail ? ` (${payload.errorDetail})` : "";
      const combinedError = (payload.error || "Unable to generate caption.") + detailSuffix;

      if (combinedError.toLowerCase().includes("insufficient_quota")) {
        setAiState(false);
        throw new Error(
          "OpenAI quota exceeded. Local captions are available without an API key."
        );
      }

      if (combinedError.toLowerCase().includes("warming up")) {
        setCaption("Model is warming up. Retrying in a moment...");
        setStatus("Warming up model", "Local vision (Python)");
        setTimeout(() => {
          generateCaption();
        }, 2000);
        return;
      }

      throw new Error(combinedError);
    }

    setCaption(payload.caption);
    lastGeneratedCaption = payload.caption;
    setStatus(
      `Caption ready: ${labelForStyle(payload.style || selectedStyle)}`,
      payload.source === "openai" ? "OpenAI vision" : "Local vision (Python)"
    );
    copyBtn.disabled = false;
    updateAlternateCaptions(payload.captions || [payload.caption]);
  } catch (error) {
    setCaption(
      error.message ||
        "We hit a snag while generating the caption. Check the API setup and try again."
    );
    setStatus("Generation failed", "Error");
  } finally {
    generateBtn.classList.remove("is-loading");
    generateBtn.disabled = false;
    isGenerating = false;
  }
}

async function copyCaption() {
  try {
    await navigator.clipboard.writeText(captionText.textContent);
    setStatus("Copied to clipboard", sourceTag.textContent);
    showToast("Caption copied");
  } catch (error) {
    setStatus("Copy failed", sourceTag.textContent);
  }
}

imageInput.addEventListener("change", (event) => {
  const [file] = event.target.files;
  handleSelectedFile(file);
});

uploadZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  uploadZone.classList.add("is-active");
});

uploadZone.addEventListener("dragleave", () => {
  uploadZone.classList.remove("is-active");
});

uploadZone.addEventListener("drop", (event) => {
  event.preventDefault();
  uploadZone.classList.remove("is-active");
  const [file] = event.dataTransfer.files;
  handleSelectedFile(file);
});

generateBtn.addEventListener("click", generateCaption);
copyBtn.addEventListener("click", copyCaption);

for (const chip of styleChips) {
  chip.addEventListener("click", () => selectStyle(chip.dataset.style));
}

for (const chip of countChips) {
  chip.addEventListener("click", () => selectCount(Number(chip.dataset.count)));
}

fetchStatus();

if (activeIndicator && styleChips.length) {
  const activeChip = styleChips.find((chip) => chip.classList.contains("is-selected"));
  if (activeChip) {
    activeIndicator.style.transform = `translateX(${activeChip.offsetLeft}px)`;
    activeIndicator.style.width = `${activeChip.offsetWidth}px`;
  }
}

if (countChips.length) {
  const defaultChip = countChips.find((chip) => chip.classList.contains("is-selected"));
  if (defaultChip) {
    selectedCount = Number(defaultChip.dataset.count) || selectedCount;
  }
}

if (themeToggle) {
  const savedTheme = localStorage.getItem("caption-theme") || "dark";
  document.body.classList.toggle("theme-light", savedTheme === "light");
  themeToggle.querySelector("span").textContent = savedTheme === "light" ? "Light" : "Dark";
  themeToggle.querySelector("i").className =
    savedTheme === "light" ? "fa-solid fa-sun" : "fa-solid fa-moon";

  themeToggle.addEventListener("click", () => {
    const isLight = document.body.classList.toggle("theme-light");
    const theme = isLight ? "light" : "dark";
    localStorage.setItem("caption-theme", theme);
    themeToggle.querySelector("span").textContent = isLight ? "Light" : "Dark";
    themeToggle.querySelector("i").className =
      isLight ? "fa-solid fa-sun" : "fa-solid fa-moon";
  });
}

if (removeImageBtn) {
  removeImageBtn.addEventListener("click", () => {
    imageInput.value = "";
    currentImageDataUrl = "";
    currentFileName = "";
    lastGeneratedCaption = "";
    previewImage.src = "";
    previewImage.style.display = "none";
    if (previewEmpty) {
      previewEmpty.classList.remove("is-hidden");
    }
    setCaption(initialCaptionText);
    setStatus("Waiting for upload", sourceTag.textContent);
    generateBtn.disabled = true;
    copyBtn.disabled = true;
    showToast("Image removed");
  });
}

function showToast(message) {
  if (!toastContainer) {
    return;
  }

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${message}`;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 2800);
}

function regenerateCaption() {
  if (!currentImageDataUrl) {
    return;
  }
  console.log("[caption-app] regenerate clicked");
  generateCaption();
}

function runDemo() {
  if (!currentImageDataUrl) {
    return;
  }
  console.log("[caption-app] quick demo triggered");
  generateCaption();
}

function renderCaptionCards(captions) {
  if (!captionGrid) {
    return;
  }

  const safeCaptions = captions.filter(Boolean);
  const primary = safeCaptions[0] || "Caption will appear here.";
  const cleanCaption = primary.replace(/[.!?]+$/, "");
  const fallback = [
    primary,
    `${cleanCaption} with a modern, cinematic tone.`,
    `${cleanCaption} Capturing a clean, premium vibe.`,
  ];

  const targetCount = Math.max(3, selectedCount || 3);
  const variations = [];

  for (let index = 0; index < targetCount; index += 1) {
    variations.push(safeCaptions[index] || fallback[index] || primary);
  }

  captionGrid.innerHTML = "";
  captionCards = variations.map((text, index) => {
    const card = document.createElement("div");
    card.className = "caption-card";
    if (index === 0) {
      card.classList.add("is-active");
    }
    card.innerHTML = `<p>${text}</p>`;
    captionGrid.appendChild(card);
    return card;
  });
}

function updateAlternateCaptions(captions) {
  renderCaptionCards(captions);
}

renderCaptionCards([initialCaptionText]);

async function normalizeSampleImage(dataUrl) {
  if (dataUrl.startsWith("/")) {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  }

  if (!dataUrl.startsWith("data:image/svg+xml")) {
    return dataUrl;
  }

  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.width || 1200;
      canvas.height = image.height || 800;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    };
    image.onerror = () => reject(new Error("Unable to render sample image."));
    image.src = dataUrl;
  });
}

const SAMPLE_IMAGES = {
  camera: "/sample.webp",
  demo: "/demo.jpg",
};

for (const btn of sampleButtons) {
  btn.addEventListener("click", async () => {
    const sample = resolveSampleFromButton(btn);
    try {
      await handleSampleImage(sample);
      if (btn.id === "quickDemoBtn" || sample === "demo") {
        runDemo();
      }
    } catch (error) {
      console.error("[caption-app] sample click failed", error);
      showToast("Sample image failed to load");
    }
  });
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest(".sample-btn");
  if (!button) {
    return;
  }
  event.preventDefault();
  const sample = resolveSampleFromButton(button);
  console.log("[caption-app] delegated sample click", sample);
  await handleSampleImage(sample);
  if (button.id === "quickDemoBtn" || sample === "demo") {
    runDemo();
  }
});

if (sampleImageBtn) {
  sampleImageBtn.addEventListener("click", async (event) => {
    event.preventDefault();
    console.log("[caption-app] sample image button clicked");
    showToast("Loading sample image...");
    try {
      await handleSampleImage("camera");
    } catch (error) {
      console.error("[caption-app] sample image load failed", error);
      showToast("Sample image failed to load");
    }
  });
  sampleImageBtn.onclick = async (event) => {
    event.preventDefault();
    console.log("[caption-app] sample image button onclick");
    showToast("Loading sample image...");
    try {
      await handleSampleImage("camera");
    } catch (error) {
      console.error("[caption-app] sample image load failed", error);
      showToast("Sample image failed to load");
    }
  };
}

if (quickDemoBtn) {
  quickDemoBtn.addEventListener("click", async (event) => {
    event.preventDefault();
    console.log("[caption-app] quick demo button clicked");
    showToast("Loading demo image...");
    try {
      await handleSampleImage("demo");
      runDemo();
    } catch (error) {
      console.error("[caption-app] quick demo failed", error);
      showToast("Demo image failed to load");
    }
  });
  quickDemoBtn.onclick = async (event) => {
    event.preventDefault();
    console.log("[caption-app] quick demo onclick");
    showToast("Loading demo image...");
    try {
      await handleSampleImage("demo");
      runDemo();
    } catch (error) {
      console.error("[caption-app] quick demo failed", error);
      showToast("Demo image failed to load");
    }
  };
}

if (toastContainer) {
  showToast("UI ready");
}

function resolveSampleFromButton(button) {
  if (!button) {
    return "";
  }
  if (button.id === "quickDemoBtn") {
    return "demo";
  }
  if (button.id === "sampleImageBtn") {
    return "camera";
  }
  return button.dataset.sample || "";
}

if (regenBtn) {
  regenBtn.addEventListener("click", () => {
    regenerateCaption();
  });
}

if (copyBtn) {
  copyBtn.setAttribute("data-tooltip", "Copy caption");
}
