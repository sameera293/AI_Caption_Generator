import json
import sys
import base64
import io

from PIL import Image
from transformers import BlipProcessor, BlipForConditionalGeneration


MODEL_NAME = "Salesforce/blip-image-captioning-base"
_processor = None
_model = None


def get_model():
    global _processor, _model
    if _processor is None or _model is None:
        _processor = BlipProcessor.from_pretrained(MODEL_NAME)
        _model = BlipForConditionalGeneration.from_pretrained(MODEL_NAME)
    return _processor, _model


def load_image(image_data_url: str) -> Image.Image:
    if "," not in image_data_url:
        raise ValueError("Invalid image data URL.")
    _, data = image_data_url.split(",", 1)
    image_bytes = base64.b64decode(data)
    return Image.open(io.BytesIO(image_bytes)).convert("RGB")


def apply_style(caption: str, style: str) -> str:
    caption = caption.strip().rstrip(".!?")

    if style == "funny":
        return f"{caption}. (This shot is a whole mood.)"
    if style == "instagram":
        return f"{caption}. #photography #instagood"
    return f"{caption}."


def main() -> None:
    payload = json.loads(sys.stdin.read() or "{}")
    image_data_url = payload.get("imageDataUrl", "")
    style = payload.get("style", "professional")

    image = load_image(image_data_url)
    processor, model = get_model()

    inputs = processor(images=image, return_tensors="pt")
    output = model.generate(**inputs, max_new_tokens=16)
    caption = processor.decode(output[0], skip_special_tokens=True)

    styled_caption = apply_style(caption, style)
    print(json.dumps({"caption": styled_caption}))


if __name__ == "__main__":
    main()
