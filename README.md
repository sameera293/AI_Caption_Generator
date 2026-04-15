# Caption Craft

Caption Craft is a small image-caption generator website with a polished UI and a simple Node backend.

## Features

- Upload or drag and drop an image
- Instant preview area
- Generate a caption with OpenAI when `OPENAI_API_KEY` is configured
- Graceful fallback captions when no API key is available
- Responsive interface for desktop and mobile

## Run locally

1. Install dependencies:

```bash
npm install
```

2. Install Python dependencies for local captioning:

```bash
python -m pip install -r requirements.txt
```

3. (Optional) Add your OpenAI key to `.env` or set `OPENAI_API_KEY` in your terminal session.
4. Start the app:

```bash
npm start
```

5. Open `http://localhost:3000`

## Notes

- The backend uses the OpenAI Responses API with image input when a key is present.
- Without a key, the app runs a local Python vision caption model. The first run will download the model.
- `GET /api/health` returns a basic health check.
- You can configure `PORT`, `MAX_BODY_SIZE`, and `PYTHON_READY_TIMEOUT` via environment variables.
