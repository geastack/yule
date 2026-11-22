#!/bin/sh
# Copies the baked globes and the staged songs to the watch's microSD card
# over USB: run scripts/bake.mjs and scripts/music.mjs first. A transfer that
# drops bytes is tried again. From the repository root:
#
#   sh scripts/push.sh   (BOARD=<alias> for another board)
set -e
cd "$(dirname "$0")/.."
BOARD=${BOARD:-amoled}

push() {
  for try in 1 2 3; do
    if npx --no-install gea devctl push "$1" "$2" --board "$BOARD" --transport usb; then
      return 0
    fi
    echo "retrying $2"
  done
  return 1
}

for file in .gea/sd/yule/globes/*.565; do
  push "$file" "/sdcard/yule/globes/$(basename "$file")"
done
if [ -d .gea/sd/yule/music ]; then
  for file in .gea/sd/yule/music/*; do
    push "$file" "/sdcard/yule/music/$(basename "$file")"
  done
fi
