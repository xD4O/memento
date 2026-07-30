"""Render one avatar clip from an audio file via AvatarForcing (offline).

Usage: render_avatar.py <in_audio> <out_mp4>
Run with the spike venv python. Talking-only recipe: silent user audio +
motionless listener frames (the model requires user streams).
"""

import os
import subprocess
import sys
import tempfile
from pathlib import Path

AF_DIR = os.environ.get("AVATARFORCING_DIR", "/home/cyrax/Desktop/avatarforcing-spike")
REF = os.environ.get("NARRATOR_REF", "/home/cyrax/Desktop/memento/assets/narrator.jpg")
MAX_S = float(os.environ.get("AVATAR_MAX_S", "12"))

src, out = sys.argv[1], sys.argv[2]

with tempfile.TemporaryDirectory(prefix="avatar-live-") as td:
    tdp = Path(td)
    wav = tdp / "in.wav"
    subprocess.run(
        ["ffmpeg", "-nostdin", "-y", "-i", src, "-t", str(MAX_S),
         "-ac", "1", "-ar", "16000", str(wav)],
        check=True, capture_output=True, timeout=60,
    )
    probe = subprocess.run(
        ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(wav)],
        check=True, capture_output=True, text=True, timeout=30,
    )
    dur = float(probe.stdout.strip() or 0)
    if dur < 0.6:
        print("too-short", file=sys.stderr)
        sys.exit(3)

    silent = tdp / "silent.wav"
    subprocess.run(
        ["ffmpeg", "-nostdin", "-y", "-f", "lavfi",
         "-i", "anullsrc=r=16000:cl=mono", "-t", str(dur), str(silent)],
        check=True, capture_output=True, timeout=60,
    )
    still_dir = tdp / "user"
    still_dir.mkdir()
    src_frame = sorted(Path(AF_DIR, "data", "user").glob("*.jpg"))[0]
    frame_bytes = src_frame.read_bytes()
    for i in range(int(dur * 25) + 30):
        (still_dir / f"{i:05d}.jpg").write_bytes(frame_bytes)

    subprocess.run(
        [f"{AF_DIR}/.venv/bin/python", "inference.py",
         "--avatar_ref_path", REF,
         "--avatar_audio_path", str(wav),
         "--user_audio_path", str(silent),
         "--user_video_path", str(still_dir),
         "--res_video_path", out,
         "--nfe", "10"],
        check=True, capture_output=True, timeout=900, cwd=AF_DIR,
    )

if not (Path(out).exists() and Path(out).stat().st_size > 10000):
    sys.exit(4)
print(out)
