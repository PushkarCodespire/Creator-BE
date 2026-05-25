#!/bin/sh
# =============================================================
# Docker entrypoint — runs before the Node process starts.
# =============================================================
# 1. Ensures upload sub-directories exist on the PVC mount.
# 2. Pre-populates the PVC with seed avatar images so the
#    seeded featured creators show their profile pictures on
#    first deploy (files are baked into the image at
#    /app/seed-assets/; the PVC mount is at /app/uploads/).
# =============================================================

set -e

# Create upload sub-directories if they don't exist yet.
# (A freshly provisioned PVC is empty; the app needs these.)
for dir in avatars content documents temp chat; do
  mkdir -p "/app/uploads/$dir" 2>/dev/null || true
done

# Copy seed avatars to PVC on first run (skip if already present).
if [ -d "/app/seed-assets/avatars" ]; then
  for f in /app/seed-assets/avatars/*; do
    [ -f "$f" ] || continue
    fname=$(basename "$f")
    dest="/app/uploads/avatars/$fname"
    if [ ! -f "$dest" ]; then
      cp "$f" "$dest" 2>/dev/null || true
    fi
  done
fi

exec "$@"
