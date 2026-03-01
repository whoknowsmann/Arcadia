#!/bin/bash
set -euo pipefail

BASE_URL="https://myrient.erista.me/files/Redump/Nintendo%20-%20GameCube%20-%20NKit%20RVZ%20%5Bzstd-19-128k%5D"
DEST="/mnt/g/Myrient/Nintendo - GameCube"
LOG="/mnt/g/Myrient/logs/gamecube.log"
FILELIST="/mnt/g/Myrient/logs/gamecube_usajp.txt"
PARALLEL=5

mkdir -p "$DEST"

TOTAL=$(wc -l < "$FILELIST")
echo "[$(date)] v3: Downloading $TOTAL GameCube games (USA + Japan) with $PARALLEL parallel workers" | tee -a "$LOG"

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
