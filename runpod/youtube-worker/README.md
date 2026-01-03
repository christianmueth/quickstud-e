# RunPod YouTube Worker (Download → Transcript)

This worker is meant to make **paste-a-YouTube-link** reliable by moving YouTube fetching off Vercel.

It implements the contract expected by the app’s RunPod client in [lib/runpodYoutubeClient.ts](../../lib/runpodYoutubeClient.ts):

- Input: `{ "youtubeUrl": "https://www.youtube.com/watch?v=...", "lang": "en" }`
- Output (success): `{ "transcript": "..." }`

## Behavior

1. Tries to download subtitles (manual, then auto) via `yt-dlp` and returns a plain-text transcript.
2. If subtitles are unavailable, downloads audio and runs `faster-whisper` as ASR.

## Deploy

### Option 1 (No local Docker): GitHub Actions → GHCR (recommended)

If Docker Desktop isn’t working locally, you can build/publish the image using GitHub Actions.

1. Push this repo to GitHub (already done).
2. In GitHub, go to **Actions** and run the workflow:
   - `Publish RunPod YouTube worker (GHCR)`
3. After it runs, your image will be published to GHCR at:
   - `ghcr.io/<github-owner>/quickstud-youtube-worker:latest`

Notes:
- Ensure GitHub Actions has permission to publish packages (repo Settings → Actions → General → Workflow permissions).
- GHCR images can be private by default; RunPod must be able to pull the image. The simplest setup is making the package public.

### Option 2: Build and push locally (Docker)

1. Build and push an image (example):

   - `docker build -t <your-registry>/quickstud-youtube-worker:latest .`
   - `docker push <your-registry>/quickstud-youtube-worker:latest`

2. Create a RunPod Serverless endpoint using that image.

3. Set Vercel env vars:

   - `RUNPOD_YOUTUBE_ENDPOINT_ID=<runpod-endpoint-id>`
   - `RUNPOD_YOUTUBE_API_KEY=<runpod-api-key>` (or reuse `RUNPOD_API_KEY`)

Optional tuning:

- `RUNPOD_YOUTUBE_TIMEOUT_MS=180000`
- `RUNPOD_YOUTUBE_POLL_MS=1500`
- `WHISPER_MODEL=small` (or `base`, `medium`, etc.)
- `WHISPER_DEVICE=cuda`
- `WHISPER_COMPUTE_TYPE=float16`

## Notes

- The first ASR run may be slower if the Whisper model needs to download.
- If you want “subtitles only” (no ASR), remove the ASR section in `handler.py`.
