import json
import sys
import base64
import io
import os

from PIL import Image
from transformers import BlipProcessor, BlipForConditionalGeneration
from transformers.utils import logging as hf_logging

try:
    from huggingface_hub.utils import disable_progress_bars
except Exception:
    disable_progress_bars = None


MODEL_NAME = "Salesforce/blip-image-captioning-base"
MODEL_ENV_KEY = "BLIP_MODEL_DIR"


def resolve_model_dir() -> str:
    model_dir = os.environ.get(MODEL_ENV_KEY, "").strip()
    if not model_dir:
        return ""
    model_dir = os.path.abspath(os.path.expanduser(model_dir))
    return model_dir if os.path.isdir(model_dir) else ""


def load_image(image_data_url: str) -> Image.Image:
    if "," not in image_data_url:
        raise ValueError("Invalid image data URL.")
    _, data = image_data_url.split(",", 1)
    image_bytes = base64.b64decode(data)
    return Image.open(io.BytesIO(image_bytes)).convert("RGB")


def apply_style(caption: str, style: str) -> str:
    caption = caption.strip().rstrip(".!?")

    if style == "storytelling":
        return f"{caption}. A quiet moment that hints at a larger story."
    if style == "minimal":
        words = caption.split()
        concise = " ".join(words[:8]) if words else caption
        return f"{concise}."
    if style == "instagram":
        return f"{caption}. #photography #instagood"
    return f"{caption}."


def generate_captions(model, processor, image, count: int) -> list[str]:
    if count <= 1:
        inputs = processor(images=image, return_tensors="pt")
        output = model.generate(**inputs, max_new_tokens=16)
        caption = processor.decode(output[0], skip_special_tokens=True)
        return [caption]

    inputs = processor(images=image, return_tensors="pt")
    output = model.generate(
        **inputs,
        max_new_tokens=18,
        num_return_sequences=count,
        num_beams=max(3, count),
        do_sample=True,
        top_p=0.9,
        temperature=1.0,
    )
    captions = [processor.decode(item, skip_special_tokens=True) for item in output]
    return captions


def main() -> None:
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
    os.environ.setdefault("TRANSFORMERS_NO_ADVISORY_WARNINGS", "1")

    hf_logging.set_verbosity_error()
    if disable_progress_bars:
        disable_progress_bars()

    local_model_dir = resolve_model_dir()
    if local_model_dir:
        processor = BlipProcessor.from_pretrained(local_model_dir, local_files_only=True)
        model = BlipForConditionalGeneration.from_pretrained(local_model_dir, local_files_only=True)
    else:
        processor = BlipProcessor.from_pretrained(MODEL_NAME)
        model = BlipForConditionalGeneration.from_pretrained(MODEL_NAME)

    print(json.dumps({"type": "ready"}), flush=True)

    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            payload = json.loads(line)
            request_id = payload.get("id", "")
            image_data_url = payload.get("imageDataUrl", "")
            style = payload.get("style", "professional")
            count = int(payload.get("count", 1) or 1)
            count = max(1, min(5, count))

            image = load_image(image_data_url)
            raw_captions = generate_captions(model, processor, image, count)
            styled_captions = [apply_style(caption, style) for caption in raw_captions]
            primary_caption = styled_captions[0] if styled_captions else ""

            print(
                json.dumps(
                    {
                        "id": request_id,
                        "caption": primary_caption,
                        "captions": styled_captions,
                    }
                ),
                flush=True,
            )
        except Exception as exc:
            print(json.dumps({"id": payload.get("id", ""), "error": str(exc)}), flush=True)


if __name__ == "__main__":
    main()
