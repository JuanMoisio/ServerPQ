# scripts/fetch-ventoy.sh
#!/usr/bin/env bash
set -euo pipefail
VER=${VENTOY_WIN_VERSION:-1.0.99}
SHA=${VENTOY_WIN_SHA256:-}
mkdir -p vendor/ventoy/win
cd vendor/ventoy/win
URL="https://downloads.sourceforge.net/project/ventoy/Ventoy-${VER}/ventoy-${VER}-windows.zip"
FILE="ventoy-${VER}-windows.zip"
curl -L -o "$FILE" "$URL"
if [[ -n "$SHA" ]]; then echo "$SHA $FILE" | shasum -a 256 -c -; fi
unzip -o "$FILE"
[ -d altexe ] && cp -f altexe/* ./
echo "Ventoy $VER listo en vendor/ventoy/win"