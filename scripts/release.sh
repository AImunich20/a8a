#!/bin/bash
# Build and publish a new a8a release to GitHub. Installed apps pick it up automatically.
#   npm run release -- <app-version> [n8n-version|latest]
#   npm run release -- 1.1.0 latest     # new app version on the newest n8n engine
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="${1:?usage: npm run release -- <app-version> [n8n-version|latest]}"
N8N="${2:-}"
[ "$N8N" = "latest" ] && N8N="$(npm view n8n version)"

if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree is not clean; commit or stash first." >&2
  exit 1
fi

node -e '
const fs = require("fs");
const p = JSON.parse(fs.readFileSync("package.json"));
p.version = process.argv[1];
if (process.argv[2]) p.a8a.n8nVersion = process.argv[2];
fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n");
' "$VERSION" "$N8N"
echo "Releasing a8a $VERSION with n8n $(node -p 'require("./package.json").a8a.n8nVersion')"

npm run dist

git commit -am "Release v$VERSION"
git tag "v$VERSION"
git push origin HEAD "v$VERSION"

gh release create "v$VERSION" \
  "dist/a8a-$VERSION-arm64-mac.dmg" \
  "dist/a8a-$VERSION-arm64-mac.zip" \
  --title "a8a $VERSION" \
  --notes "Workflow engine: n8n $(node -p 'require("./package.json").a8a.n8nVersion')" \
  --generate-notes
