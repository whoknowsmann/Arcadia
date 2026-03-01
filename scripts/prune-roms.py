#!/usr/bin/env python3
"""
Prune ROM collections: remove non-English/non-NA duplicates.
Keep foreign-only exclusives (games with no English/USA/Europe release).
"""

import os
import re
import sys
from collections import defaultdict
from pathlib import Path

DRY_RUN = "--dry-run" in sys.argv

# Regions/languages we want to KEEP
KEEP_REGIONS = {"USA", "World", "USA, Europe", "Europe, USA"}

# Regions that are acceptable (English-speaking or include English)
ACCEPTABLE_REGIONS = {
    "USA", "World", "USA, Europe", "Europe, USA",
    "Europe", "Australia", "Canada",
}

# Regions to DELETE if an English version exists
FOREIGN_ONLY_REGIONS = {
    "Japan", "Korea", "China", "Taiwan", "Asia",
    "Germany", "France", "Spain", "Italy", "Netherlands",
    "Sweden", "Denmark", "Norway", "Finland", "Portugal",
    "Brazil", "Russia", "Poland", "Czech Republic", "Hungary",
    "Greece", "Turkey",
}

def get_base_name(filename):
    """Extract the base game name (everything before the first parenthesis)."""
    match = re.match(r'^(.+?)\s*\(', filename)
    if match:
        return match.group(1).strip()
    return filename

def get_region_tags(filename):
    """Extract all parenthetical tags from filename."""
    return re.findall(r'\(([^)]+)\)', filename)

def is_english_compatible(filename):
    """Check if this file is an English/NA/World release."""
    tags = get_region_tags(filename)
    if not tags:
        return True  # no tags = keep it
    
    region = tags[0]  # first tag is usually the region
    
    # Direct match on preferred regions
    if region in ACCEPTABLE_REGIONS:
        return True
    
    # Multi-region that includes USA
    if "USA" in region:
        return True
    
    # Check if it includes English language
    # Tags like "En,Fr,De" or just "En"
    for tag in tags:
        if tag == "En" or tag.startswith("En,") or ", En," in tag or tag.endswith(", En"):
            # But only if the region isn't purely foreign
            if region not in FOREIGN_ONLY_REGIONS:
                return True
    
    # Europe with English in language tags
    if "Europe" in region:
        return True
    
    return False

def is_foreign_only(filename):
    """Check if this is clearly a foreign-language-only release."""
    tags = get_region_tags(filename)
    if not tags:
        return False
    
    region = tags[0]
    
    # Check if region is in our foreign list
    for foreign in FOREIGN_ONLY_REGIONS:
        if foreign in region and "USA" not in region and "Europe" not in region and "World" not in region:
            return True
    
    return False

def rank_file(filename):
    """Rank files by preference. Lower = better."""
    tags = get_region_tags(filename)
    if not tags:
        return 50
    
    region = tags[0]
    tag_str = " ".join(tags)
    
    # Prefer USA, then USA+Europe, then Europe, then World
    score = 30
    if "USA" in region and "Europe" not in region:
        score = 0
    elif "USA" in region:
        score = 5
    elif region == "World":
        score = 10
    elif "Europe" in region:
        score = 15
    
    # Penalize betas, protos, demos
    if "Beta" in tag_str:
        score += 100
    if "Proto" in tag_str:
        score += 80
    if "Demo" in tag_str:
        score += 90
    
    # Penalize revisions slightly (but they might be better versions)
    # Actually prefer higher revisions
    rev_match = re.search(r'Rev (\d+)', tag_str)
    if rev_match:
        score -= int(rev_match.group(1))  # higher rev = slightly better
    
    return score

def prune_directory(dirpath):
    """Prune a single ROM directory."""
    dirpath = Path(dirpath)
    if not dirpath.exists():
        print(f"  Directory not found: {dirpath}")
        return 0, 0, 0
    
    files = sorted([f for f in os.listdir(dirpath) if f.endswith(('.zip', '.7z', '.chd'))])
    
    # Group by base game name
    groups = defaultdict(list)
    for f in files:
        base = get_base_name(f)
        groups[base].append(f)
    
    total_files = len(files)
    to_delete = []
    kept_foreign = []
    
    for base_name, versions in groups.items():
        if len(versions) == 1:
            # Only one version exists
            if is_foreign_only(versions[0]):
                # It's foreign-only but it's the ONLY version - keep it
                kept_foreign.append(versions[0])
            continue
        
        # Multiple versions exist - find English ones
        english_versions = [f for f in versions if is_english_compatible(f)]
        foreign_versions = [f for f in versions if is_foreign_only(f)]
        
        if english_versions:
            # We have English versions - delete foreign duplicates
            for f in foreign_versions:
                to_delete.append(f)
            
            # Among English versions, keep the best one (prefer USA)
            # Sort by rank - lowest score = best
            english_versions.sort(key=lambda f: rank_file(f))
            best = english_versions[0]
            for f in english_versions[1:]:
                # Don't delete if it's a meaningfully different version
                # (e.g. different Rev, or one is a Demo/Beta/Proto)
                best_tags = set(get_region_tags(best))
                f_tags = set(get_region_tags(f))
                best_is_special = any(t in " ".join(best_tags) for t in ["Beta", "Proto", "Demo", "Sample"])
                f_is_special = any(t in " ".join(f_tags) for t in ["Beta", "Proto", "Demo", "Sample"])
                # Keep both if one is special and other isn't (different content)
                if best_is_special != f_is_special:
                    continue
                # Keep different revisions only if the best is also a revision
                # Actually just keep the best and drop the rest
                to_delete.append(f)
        else:
            # No English version at all - keep the best foreign one
            if foreign_versions:
                kept_foreign.append(foreign_versions[0])
    
    # Report
    print(f"  Total files: {total_files}")
    print(f"  Files to delete: {len(to_delete)}")
    print(f"  Foreign exclusives kept: {len(kept_foreign)}")
    
    # Show some examples
    if to_delete[:5]:
        print(f"  Example deletions:")
        for f in to_delete[:5]:
            print(f"    ❌ {f}")
    
    if kept_foreign[:5]:
        print(f"  Example foreign exclusives kept:")
        for f in kept_foreign[:5]:
            print(f"    ✅ {f}")
    
    # Calculate space savings
    total_size = 0
    for f in to_delete:
        fpath = dirpath / f
        if fpath.exists():
            total_size += fpath.stat().st_size
    
    print(f"  Space saved: {total_size / (1024*1024):.1f} MB")
    
    # Actually delete
    if not DRY_RUN:
        for f in to_delete:
            fpath = dirpath / f
            if fpath.exists():
                os.remove(fpath)
                # print(f"    Deleted: {f}")
        print(f"  ✅ Deleted {len(to_delete)} files")
    else:
        print(f"  (DRY RUN - nothing deleted)")
    
    return total_files, len(to_delete), total_size

DIRS = [
    "/mnt/g/Myrient/Nintendo - Game Boy",
    "/mnt/g/Myrient/Nintendo - Game Boy Color",
    "/mnt/g/Myrient/Nintendo - Game Boy Advance",
]

print("=" * 60)
print(f"ROM Pruning - {'DRY RUN' if DRY_RUN else 'LIVE RUN'}")
print("=" * 60)

grand_total = 0
grand_deleted = 0
grand_size = 0

for d in DIRS:
    print(f"\n📁 {os.path.basename(d)}")
    total, deleted, size = prune_directory(d)
    grand_total += total
    grand_deleted += deleted
    grand_size += size

print(f"\n{'=' * 60}")
print(f"Grand total: {grand_deleted} / {grand_total} files to remove")
print(f"Total space saved: {grand_size / (1024*1024):.1f} MB")
print(f"{'=' * 60}")
