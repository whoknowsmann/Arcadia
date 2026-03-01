#!/bin/bash
# ============================================================
# Myrient Bulk Downloader
# Downloads entire ROM/game collections from Myrient
# Supports resume, parallel downloads, and progress logging
# ============================================================

set -euo pipefail

BASE_URL="https://myrient.erista.me/files"
DEST_DIR="/mnt/g/Myrient"
LOG_DIR="$DEST_DIR/logs"
MAX_PARALLEL=5          # parallel wget processes
RETRY_COUNT=10          # retries per file
WAIT_BETWEEN=0.5        # seconds between requests (be nice to the server)

mkdir -p "$LOG_DIR"

# ---- Define collections to download ----
# Format: "CATEGORY/URL-encoded-folder-name|local-folder-name"
declare -a COLLECTIONS=(
    "No-Intro/Nintendo%20-%20Game%20Boy|Nintendo - Game Boy"
    "No-Intro/Nintendo%20-%20Game%20Boy%20Color|Nintendo - Game Boy Color"
    "No-Intro/Nintendo%20-%20Game%20Boy%20Advance|Nintendo - Game Boy Advance"
    "Redump/Nintendo%20-%20GameCube%20-%20NKit%20RVZ%20%5Bzstd-19-128k%5D|Nintendo - GameCube"
    # "Redump/Sony%20-%20PlayStation|Sony - PlayStation"
    # Xbox commented out by default - too large for full download
    # "Redump/Microsoft%20-%20Xbox|Microsoft - Xbox"
)

# ---- Functions ----

download_collection() {
    local url_path="$1"
    local local_name="$2"
    local full_url="$BASE_URL/$url_path/"
    local dest="$DEST_DIR/$local_name"
    local log_file="$LOG_DIR/$(echo "$local_name" | tr ' ' '_').log"

    mkdir -p "$dest"

    echo "============================================================"
    echo "  Downloading: $local_name"
    echo "  From: $full_url"
    echo "  To:   $dest"
    echo "  Log:  $log_file"
    echo "============================================================"

    # Use wget to get the file listing, parse out the zip/7z file URLs
    echo "[$(date)] Fetching file list..." | tee -a "$log_file"

    local file_list="$LOG_DIR/$(echo "$local_name" | tr ' ' '_')_files.txt"

    curl -s "$full_url" \
        | grep -oP 'href="[^"]*\.(zip|7z|rar|chd|iso|bin|cue|gz)"' \
        | sed 's/href="//;s/"//' \
        | while read -r filename; do
            echo "$full_url$filename"
        done > "$file_list"

    local total_files
    total_files=$(wc -l < "$file_list")
    echo "[$(date)] Found $total_files files to download" | tee -a "$log_file"

    if [[ "$total_files" -eq 0 ]]; then
        echo "[$(date)] WARNING: No files found! Check the URL." | tee -a "$log_file"
        return 1
    fi

    # Download with wget, parallel using xargs
    # -c = continue/resume, -nv = not verbose but still shows progress
    local count=0
    local failed=0

    cat "$file_list" | xargs -P "$MAX_PARALLEL" -I {} bash -c '
        url="{}"
        filename=$(python3 -c "import urllib.parse; print(urllib.parse.unquote(\"$url\".split(\"/\")[-1]))" 2>/dev/null || basename "$url")
        dest_dir="'"$dest"'"
        log="'"$log_file"'"

        # Skip if already downloaded
        if [[ -f "$dest_dir/$filename" ]]; then
            echo "[SKIP] $filename (already exists)" >> "$log"
        else
            echo "[DL] $filename" >> "$log"
            wget -q -c --tries='"$RETRY_COUNT"' --wait='"$WAIT_BETWEEN"' \
                --directory-prefix="$dest_dir" \
                -O "$dest_dir/$filename.part" \
                "$url" 2>> "$log"
            if [[ $? -eq 0 ]]; then
                mv "$dest_dir/$filename.part" "$dest_dir/$filename"
                echo "[OK] $filename" >> "$log"
            else
                echo "[FAIL] $filename" >> "$log"
                rm -f "$dest_dir/$filename.part"
            fi
        fi
    '

    echo "[$(date)] Collection complete: $local_name" | tee -a "$log_file"

    # Summary
    local downloaded
    downloaded=$(find "$dest" -maxdepth 1 -type f \( -name "*.zip" -o -name "*.7z" -o -name "*.chd" \) | wc -l)
    echo "[$(date)] Files on disk: $downloaded / $total_files" | tee -a "$log_file"
}

show_progress() {
    echo ""
    echo "=== Download Progress ==="
    for entry in "${COLLECTIONS[@]}"; do
        local local_name="${entry#*|}"
        local dest="$DEST_DIR/$local_name"
        local count=0
        if [[ -d "$dest" ]]; then
            count=$(find "$dest" -maxdepth 1 -type f \( -name "*.zip" -o -name "*.7z" -o -name "*.chd" \) 2>/dev/null | wc -l)
        fi
        local size
        size=$(du -sh "$dest" 2>/dev/null | cut -f1 || echo "0")
        printf "  %-35s %6d files  %s\n" "$local_name" "$count" "$size"
    done
    echo ""
    echo "Drive usage:"
    df -h /mnt/g/ | tail -1
    echo "========================="
}

# ---- Main ----

case "${1:-all}" in
    all)
        for entry in "${COLLECTIONS[@]}"; do
            IFS='|' read -r url_path local_name <<< "$entry"
            download_collection "$url_path" "$local_name"
        done
        show_progress
        ;;
    progress)
        show_progress
        ;;
    single)
        # Usage: ./download-myrient.sh single "No-Intro/Nintendo%20-%20Game%20Boy" "Nintendo - Game Boy"
        download_collection "$2" "$3"
        ;;
    *)
        echo "Usage: $0 [all|progress|single <url_path> <local_name>]"
        ;;
esac

echo ""
echo "Done! Check logs in $LOG_DIR"
