# YouTube Transcript → Flashcards Implementation

## ✅ What's Working

Successfully implemented robust YouTube caption extraction using **yt-dlp** with automatic flashcard generation.

### Test Results
- ✅ **"Me at the zoo"** (jNQXAC9IVRw) - First YouTube video
- ✅ **"Gangnam Style"** (9bZkp7q19f0) - Popular video
- ✅ **"Stanford Physics Lecture"** (yy989li6xgY) - Your target video
  - 3,909 caption segments
  - 192 KB of transcript text
  - Successfully extracted and formatted

## Architecture

### Extraction Flow
```
YouTube URL
    ↓
1. yt-dlp subtitle download (PRIMARY - most reliable)
    ↓ (if fails)
2. youtube-transcript library (FALLBACK)
    ↓ (if fails)
3. HTML scraping for ytInitialPlayerResponse
    ↓ (if fails)
4. ytdl-core with caption extraction
  ↓ (if fails)
4b. YouTube timedtext endpoints (manual + auto captions)
  ↓ (if fails)
5. RunPod YouTube worker (downloads + ASR on RunPod)
    ↓ (if fails)
6. Server-side audio download + RunPod ASR (LAST RESORT; often blocked on Vercel)
```

### Files Modified/Created

**Core Libraries:**
- `lib/youtube.ts` - ID extraction + oEmbed metadata
- `lib/captions.ts` - VTT/SRT/TXT formatters
- `lib/fallback/yt-dlp.ts` - yt-dlp subtitle download + parsing

**API Routes:**
- `app/api/youtube/transcript/route.ts` - Standalone transcript API
- `app/api/flashcards/route.ts` - Integrated YouTube → flashcards

**Test Scripts:**
- `scripts/test-ytdlp.ts` - Tests yt-dlp with multiple videos
- `scripts/test-full-flow.ts` - End-to-end flow validation

## Requirements

### System Dependencies
**yt-dlp must be installed:**

```powershell
# Windows (winget)
winget install yt-dlp.yt-dlp

# Windows (scoop)
scoop install yt-dlp

# Mac
brew install yt-dlp

# Linux/Universal
pip install yt-dlp
```

Verify installation:
```bash
yt-dlp --version
```

### Environment Variables
```env
# RunPod LLM (flashcard generation)
RUNPOD_ENDPOINT=https://api.runpod.ai/v2/<id>/run
RUNPOD_API_KEY=...

# RunPod ASR ("RunPod Whisper")
RUNPOD_ASR_ENDPOINT_ID=...  # or RUNPOD_ASR_ENDPOINT
RUNPOD_ASR_API_KEY=...      # or reuse RUNPOD_API_KEY

# Optional: RunPod YouTube ingestion worker (recommended for YouTube URLs that block Vercel)
RUNPOD_YOUTUBE_ENDPOINT_ID=...
RUNPOD_YOUTUBE_API_KEY=...  # or reuse RUNPOD_API_KEY
```

## Usage

### 1. Via UI (Recommended)
1. Go to `/app` and click "Create Deck"
2. Enter title
3. Paste YouTube URL: `https://www.youtube.com/watch?v=VIDEO_ID`
4. Click "Generate Flashcards"
5. System automatically:
   - Extracts video ID
   - Downloads captions with yt-dlp
   - Parses transcript
   - Generates flashcards with GPT-4o-mini

### 2. Via API

**Get Transcript Only:**
```bash
curl -X POST http://localhost:3000/api/youtube/transcript \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.youtube.com/watch?v=jNQXAC9IVRw"}'
```

**Generate Flashcards:**
```bash
curl -X POST http://localhost:3000/api/flashcards \
  -H "Content-Type: application/json" \
  -d '{
    "title": "My Deck",
    "url": "https://www.youtube.com/watch?v=jNQXAC9IVRw"
  }'
```

### 3. Test Scripts

```bash
# Test yt-dlp with 3 videos
npx ts-node -P tsconfig.scripts.json scripts/test-ytdlp.ts

# Test full extraction flow
npx ts-node -P tsconfig.scripts.json scripts/test-full-flow.ts
```

## Supported Videos

### ✅ Works With
- Videos with auto-generated captions
- Videos with manual/uploaded captions
- Public videos
- Unlisted videos (if you have the link)
- Most language captions (specify with `lang` parameter)

### ❌ May Not Work
- Age-restricted videos (requires authentication)
- Region-locked videos
- Private videos
- Videos with captions completely disabled
- Live streams (captions may not be available yet)

## Fallback Strategy

If yt-dlp fails (e.g., video has no captions or yt-dlp isn't available), the system:

1. Tries alternative caption sources (see Architecture above)
2. Tries timedtext endpoints (manual + auto captions)
3. If configured, offloads YouTube download + ASR to RunPod (`RUNPOD_YOUTUBE_ENDPOINT_ID`)
4. As a last resort, attempts server-side audio download + RunPod ASR
  - Often blocked on Vercel for some videos (HTTP 410/403/429)
  - Prefer the RunPod YouTube worker if you need paste-a-link to be reliable

## Performance

- **Caption extraction:** 2-5 seconds
- **Flashcard generation:** 3-8 seconds (depends on transcript length)
- **Total:** ~5-13 seconds from URL to deck

## Known Issues & Limitations

1. **yt-dlp must be installed** on the server/deployment environment
2. **Rate limiting:** YouTube may rate-limit if making many requests
3. **Caption quality:** Auto-generated captions may have errors
4. **Very long videos:** Transcripts are truncated to 20,000 characters

## Deployment Considerations

### Vercel/Serverless
- yt-dlp is usually not available on Vercel
- Some YouTube videos block Vercel from downloading audio
- For reliable paste-a-YouTube-link behavior, use the RunPod YouTube ingestion worker

### VPS/Dedicated Server
- `pip install yt-dlp` on the server
- Ensure yt-dlp is in PATH

### Docker
```dockerfile
RUN pip install yt-dlp
```

## Future Enhancements

- [ ] Cache transcripts in database (by video ID)
- [ ] Support more languages (currently defaults to English)
- [ ] Allow users to choose which caption track to use
- [ ] Add progress indicators for long videos
- [ ] Support timestamp-specific flashcard generation
- [ ] Add video chapter detection for better flashcard organization

## Testing Checklist

Before deployment:
- [ ] Run `scripts/test-ytdlp.ts` - all 3 videos should succeed
- [ ] Run `scripts/test-full-flow.ts` - complete flow should work
- [ ] Test in UI with a real YouTube URL
- [ ] Verify flashcards are generated correctly
- [ ] Test with a video that has no captions (should fail gracefully)
- [ ] Check logs for any errors

## Support

Common issues:
- **"yt-dlp not found"** → Install yt-dlp (see Requirements)
- **"No captions available"** → Video may not have captions enabled
- **Empty flashcards** → Check that transcript extraction succeeded
- **API timeout** → Video may be too long or network issue

For debugging, check server logs for:
```
[YouTube] Attempting yt-dlp subtitle download for: VIDEO_ID
[YouTube] yt-dlp succeeded: N caption segments, N chars
```
