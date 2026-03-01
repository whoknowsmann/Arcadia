#!/bin/bash
set -euo pipefail

BASE_URL="https://myrient.erista.me/files/No-Intro/Nintendo%20-%20Super%20Nintendo%20Entertainment%20System"
DEST="/mnt/g/Myrient/Nintendo - Super Nintendo Entertainment System"
LOG="/mnt/g/Myrient/logs/snes.log"
FILELIST="/mnt/g/Myrient/logs/snes_files.txt"
PARALLEL=5

mkdir -p "$DEST"
mkdir -p "$(dirname "$LOG")"

echo "[$(date)] Fetching SNES file list..." | tee -a "$LOG"

# Get file listing and extract zip filenames
curl -s "$BASE_URL/" \
    | grep -oP 'href="[^"]*\.zip"' \
    | sed 's/href="//;s/"//' \
    > "$FILELIST"

TOTAL=$(wc -l < "$FILELIST")
echo "[$(date)] Found $TOTAL files to download" | tee -a "$LOG"

cat "$FILELIST" | xargs -P "$PARALLEL" -I {} bash -c '
    url="'"$BASE_URL"'/{}"
    decoded=$(python3 -c "import urllib.parse; print(urllib.parse.unquote(\"{}\"))" 2>/dev/null || basename "{}")
    dest="'"$DEST"'"
    log="'"$LOG"'"

    if [[ -f "$dest/$decoded" ]]; then
        echo "[SKIP] $decoded" >> "$log"
        exit 0
    fi

    wget -q -c --tries=10 -O "$dest/$decoded.part" "$url" 2>> "$log"
    if [[ $? -eq 0 ]] && [[ -f "$dest/$decoded.part" ]] && [[ -s "$dest/$decoded.part" ]]; then
        mv "$dest/$decoded.part" "$dest/$decoded"
        echo "[OK] $decoded" >> "$log"
    else
        echo "[FAIL] $decoded" >> "$log"
        rm -f "$dest/$decoded.part"
    fi
'

FINAL=$(find "$DEST" -maxdepth 1 -type f ! -name "*.part" | wc -l)
FINAL_SIZE=$(du -sh "$DEST" 2>/dev/null | cut -f1)
echo "[$(date)] COMPLETE: $FINAL / $TOTAL files, $FINAL_SIZE" | tee -a "$LOG"
