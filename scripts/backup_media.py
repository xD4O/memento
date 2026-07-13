"""Mirror the MinIO media bucket to a local directory (download-only sync).

Raw media is the source of truth for the entire journal — this must succeed
nightly. Files are only added, never deleted (a MinIO-side deletion must not
propagate to the backup).
"""

import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from minio import Minio

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

DEST = Path(sys.argv[1] if len(sys.argv) > 1 else Path.home() / "memento-backups" / "media")
DEST.mkdir(parents=True, exist_ok=True)

s3 = Minio(
    f"{os.environ['S3_ENDPOINT_HOST']}:{os.environ['S3_ENDPOINT_PORT']}",
    access_key=os.environ["S3_ACCESS_KEY"],
    secret_key=os.environ["S3_SECRET_KEY"],
    secure=False,
)
bucket = os.environ["S3_BUCKET"]

copied = skipped = 0
for obj in s3.list_objects(bucket, recursive=True):
    target = DEST / obj.object_name
    if target.exists() and target.stat().st_size == obj.size:
        skipped += 1
        continue
    target.parent.mkdir(parents=True, exist_ok=True)
    s3.fget_object(bucket, obj.object_name, str(target))
    copied += 1

print(f"media mirror: {copied} copied, {skipped} up-to-date -> {DEST}")
