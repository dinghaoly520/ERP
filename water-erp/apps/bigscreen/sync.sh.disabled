#!/bin/bash
# Watch bigscreen-v2.html changes and auto-deploy to localhost:3010
SRC="/Users/qihao/Desktop/ERP/.superpowers/brainstorm/44992-1782266711/content/bigscreen-v2.html"
DST="/Users/qihao/Desktop/ERP/water-erp/apps/bigscreen/src/app/page.html"
LAST=$(md5 -q "$SRC" 2>/dev/null)
echo "Watching $SRC → $DST"
while true; do
  sleep 2
  NEW=$(md5 -q "$SRC" 2>/dev/null)
  if [ "$NEW" != "$LAST" ] && [ -n "$NEW" ]; then
    sed 's|/files/logo.png|/logo.png|g; s|/files/map-bg.png|/map-bg.png|g' "$SRC" > "$DST"
    LAST="$NEW"
    echo "$(date '+%H:%M:%S') Synced → localhost:3010"
  fi
done
