# a8a

A macOS desktop app for workflow automation: the full **n8n** engine (every node, credential, trigger,
AI agent, code node, webhook and community-node support) packaged as an installable `.dmg`, with a mint
theme, its own logo, and automatic updates.

## Installing (สำหรับผู้ใช้)

1. Download `a8a-<version>-arm64-mac.dmg` from [Releases](https://github.com/AImunich20/a8a/releases/latest).
2. Open it and drag **a8a** into **Applications**.
3. On first launch macOS blocks apps not notarized by Apple: open **System Settings → Privacy & Security**,
   click **Open Anyway** next to "a8a", then confirm.
   (Or in Terminal: `xattr -dr com.apple.quarantine /Applications/a8a.app`)
4. Create the owner account on the first screen. Done.

Data (workflows, credentials, executions, encryption key) lives in `~/Library/Application Support/a8a`
and survives updates and reinstalls. Closing the window keeps the engine running, so schedules and
webhooks keep firing; quit with ⌘Q to stop it.

## Updates

a8a checks GitHub Releases at launch and every 6 hours, or on demand via **a8a → Check for Updates…**.
Choosing **Install and Restart** downloads the new version, swaps the app bundle and relaunches.
Database migrations for new n8n versions run automatically on the next start.

## Development

```bash
npm install
npm run runtime     # downloads Node + installs/brands/prunes the n8n engine into runtime/<arch>
npm start           # run the app from source
npm run dist        # build dist/a8a-<version>-arm64-mac.dmg and .zip
```

Releasing a new version (builds, tags, pushes and publishes a GitHub Release that installed apps update to):

```bash
npm run release -- 1.1.0            # same engine, new app version
npm run release -- 1.1.0 latest     # also upgrade to the newest n8n
npm run release -- 1.1.0 2.45.0     # pin a specific n8n version
```

| Path | Purpose |
| --- | --- |
| `src/main.js` | Windows, menus, branding injection, app lifecycle |
| `src/engine.js` | Starts/stops the bundled n8n engine, port selection, logs, orphan cleanup |
| `src/updater.js` | GitHub Releases self-updater |
| `src/ui/theme.css` | Mint palette and logo overrides applied to the editor |
| `scripts/fetch-runtime.mjs` | Builds the bundled Node + n8n runtime |
| `scripts/brand-engine.mjs` | Recolours/rebrands the n8n editor build and prunes unused files |
| `scripts/make-icons.mjs` | Renders `assets/logo.svg` into the app icon and DMG background |

See [LICENSE.md](LICENSE.md) for the n8n licence terms that apply to the bundled engine.
