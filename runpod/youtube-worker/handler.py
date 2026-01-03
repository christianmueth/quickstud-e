import glob
import os
import re
import subprocess
import tempfile
from typing import Any, Dict, Optional

import runpod


def _clean_text(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip())


def _parse_vtt_to_text(vtt: str) -> str:
    # Minimal VTT -> plain text (good enough for captions)
    t = vtt.replace("\r\n", "\n")
    # Drop WEBVTT header and any NOTE blocks
    t = re.sub(r"^WEBVTT[\s\S]*?\n\n", "", t)
    t = re.sub(r"^NOTE[\s\S]*?\n\n", "", t, flags=re.MULTILINE)

    out_lines = []
    for line in t.split("\n"):
        line = line.strip()
        if not line:
            continue
        # timestamps / cue settings
        if "-->" in line:
            continue
        # numeric cue ids
        if re.fullmatch(r"\d+", line):
            continue
        # inline tags like <c>
        line = re.sub(r"<[^>]+>", "", line)
        if line:
            out_lines.append(line)

    return _clean_text(" ".join(out_lines))


def _run(cmd: list[str], cwd: Optional[str] = None, timeout: int = 120) -> None:
    subprocess.run(cmd, cwd=cwd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)


def _download_subtitles(youtube_url: str, workdir: str, lang: str = "en") -> Optional[str]:
    # Try manual subs first, then auto subs.
    # Output template: workdir/subs.%(language)s.%(ext)s
    base_out = os.path.join(workdir, "subs.%(language)s.%(ext)s")

    # Manual subs
    try:
        _run(
            [
                "yt-dlp",
                "--no-playlist",
                "--skip-download",
                "--write-subs",
                "--sub-lang",
                lang,
                "--sub-format",
                "vtt",
                "-o",
                base_out,
                youtube_url,
            ],
            cwd=workdir,
            timeout=90,
        )
    except Exception:
        pass

    # Auto subs
    try:
        _run(
            [
                "yt-dlp",
                "--no-playlist",
                "--skip-download",
                "--write-auto-subs",
                "--sub-lang",
                lang,
                "--sub-format",
                "vtt",
                "-o",
                base_out,
                youtube_url,
            ],
            cwd=workdir,
            timeout=90,
        )
    except Exception:
        pass

    # Find any .vtt we got
    vtts = glob.glob(os.path.join(workdir, "subs.*.vtt"))
    if not vtts:
        vtts = glob.glob(os.path.join(workdir, "*.vtt"))
    if not vtts:
        return None

    # Prefer exact lang match if present
    for p in vtts:
        if f".{lang}." in p:
            return p

    return vtts[0]


def _download_audio(youtube_url: str, workdir: str) -> str:
    # Downloads bestaudio to workdir/audio.<ext>
    out_tmpl = os.path.join(workdir, "audio.%(ext)s")
    _run(
        [
            "yt-dlp",
            "--no-playlist",
            "-f",
            "bestaudio",
            "-o",
            out_tmpl,
            youtube_url,
        ],
        cwd=workdir,
        timeout=180,
    )

    candidates = glob.glob(os.path.join(workdir, "audio.*"))
    if not candidates:
        raise RuntimeError("Audio download produced no file")
    return candidates[0]


def _transcribe_with_faster_whisper(audio_path: str) -> str:
    # Lazy import so the container can still run subtitle-only flows quickly.
    from faster_whisper import WhisperModel

    model_name = os.environ.get("WHISPER_MODEL", "small")
    device = os.environ.get("WHISPER_DEVICE", "cuda")
    compute_type = os.environ.get("WHISPER_COMPUTE_TYPE", "float16")

    model = WhisperModel(model_name, device=device, compute_type=compute_type)
    segments, _info = model.transcribe(audio_path, vad_filter=True)

    parts = []
    for seg in segments:
        if seg.text:
            parts.append(seg.text)

    return _clean_text(" ".join(parts))


def handler(event: Dict[str, Any]) -> Dict[str, Any]:
    inp = (event or {}).get("input") or {}
    youtube_url = str(inp.get("youtubeUrl") or "").strip()
    lang = str(inp.get("lang") or "en").strip() or "en"

    if not youtube_url:
        return {"error": "Missing input.youtubeUrl"}

    with tempfile.TemporaryDirectory() as workdir:
        # 1) Subtitles (fast + cheapest)
        vtt_path = _download_subtitles(youtube_url, workdir=workdir, lang=lang)
        if vtt_path:
            with open(vtt_path, "r", encoding="utf-8", errors="ignore") as f:
                text = _parse_vtt_to_text(f.read())
            if text:
                return {"transcript": text, "method": "subtitles", "lang": lang}

        # 2) ASR fallback (heavier): download audio and transcribe
        audio_path = _download_audio(youtube_url, workdir=workdir)
        text = _transcribe_with_faster_whisper(audio_path)
        if not text:
            return {"error": "ASR returned empty transcript"}
        return {"transcript": text, "method": "asr", "lang": lang}


runpod.serverless.start({"handler": handler})
