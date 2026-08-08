# Key Remapper for LG webOS

Configure Magic Remote shortcut keys (Netflix, Prime Video, Disney+, Rakuten TV, LG Channels, Alexa) to launch any installed app or HDMI input on rooted LG webOS TVs.

The app writes a config file and generates a small daemon that watches the foreground app. When a remapped shortcut key briefly opens its vendor app, the daemon launches your chosen target instead.

## Requirements

- LG webOS TV (tested target: webOS 24)
- Root access
- [Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel) with elevated / root `exec` (`luna://org.webosbrew.hbchannel.service/exec`)

Without root exec, the UI will load but **Save & Apply** cannot write system files.

## Install

### Rooted TV over SSH (recommended)

```bash
# Default: rebuild IPK, quiet deploy, close/update, then launch
./deploy.sh                      # uses TV_HOST from .env
./deploy.sh 192.168.1.50         # CLI host overrides .env

# Close + update only (do not start the app)
./deploy.sh --no-launch

# Reuse newest existing IPK (skip ares-package)
./deploy.sh --no-package

# Password auth / verbose (full on-device log) / dry-run
TV_PASS=alpine ./deploy.sh
./deploy.sh --verbose
./deploy.sh --print-only
```

Copy [`.env.example`](.env.example) to `.env` and set your TV address:

```bash
cp .env.example .env
# edit TV_HOST=...
```

**Defaults:** package on, quiet on (no full log dump), launch on. Host from `.env` `TV_HOST` (fallback `192.168.1.222`), user `root`, port `22`.

| Flag | Meaning |
|------|---------|
| *(none)* | Package + deploy + launch |
| `--no-launch` / `--install-only` | Close running app + install/update, skip launch |
| `--no-package` | Skip `ares-package`; use newest IPK in `dist/` |
| `--verbose` | Print full `/tmp/keyreplacer-deploy.log` after install (quiet is default) |
| `--print-only` | Print remote steps only; do not connect |

`deploy.sh` builds into [`dist/`](dist/) (gitignored), uploads the IPK and [`scripts/tv-install.sh`](scripts/tv-install.sh), which closes the app, installs via `applicationinstallerutility` (with Luna / extract fallbacks), rescans, and launches unless `--no-launch` was set. On-device log: `/tmp/keyreplacer-deploy.log`.

### webOS CLI / Homebrew Channel

```bash
# Prefer deploy.sh, or package manually into dist/:
mkdir -p dist
# (deploy.sh uses a clean staging dir; equivalent idea:)
ares-package . -o dist   # if packaging the app root directly
ares-install --device <name> dist/org.webosbrew.keyreplacer_0.9.0_all.ipk
```

You can also sideload the `.ipk` from `dist/` through Homebrew Channel.

App ID: `org.webosbrew.keyreplacer`

## Usage

1. Open **Key Remapper** from the home screen.
2. Confirm the status banner shows Homebrew Channel ready with root.
3. Turn **Enable Remapper** on (or off to restore native key behavior).
4. For each remote key, choose a target:
   - **Keep original function** — do not remap that key
   - **HDMI 1–4** — switch to that input
   - Any installed app returned by `listApps`
5. Press **Save & Apply**.
6. Optionally use **Reload Config** to re-read the config from disk.

A toast confirms when settings were applied. The launcher icon switches between active and inactive artwork based on the enable state (home screen cache may need a moment or a reboot). The footer shows the app version (e.g. `v0.9.0`).

## Paths

| Path | Purpose |
|------|---------|
| `/var/lib/webosbrew/remapper_config.json` | Persistent configuration |
| `/var/lib/webosbrew/key_redirector.sh` | Foreground-app redirector daemon |
| `/var/lib/webosbrew/key_redirector.log` | Daemon log |
| `/var/lib/webosbrew/startup.sh` | Boot startup script (patched with a managed block to start the daemon) |
| `/media/developer/apps/usr/palm/applications/org.webosbrew.keyreplacer/` | App install directory (icon swap on apply) |
| `/tmp/keyreplacer-deploy.log` | Last on-device deploy log |

## Example config

```json
{
  "enabled": true,
  "mappings": {
    "netflix": "youtube.leanback.v4",
    "amazon": "org.litefin.app",
    "disney": "com.webos.app.hdmi1",
    "rakuten": "com.webos.app.hdmi3",
    "lgchannels": "none",
    "alexa": "none"
  }
}
```

- `"none"` or `""` means keep the original TV function for that key (no remap arm is generated for it).
- Any other string is treated as a webOS app ID to launch.

## How Apply works

On **Save & Apply** the app uses Homebrew Channel `exec` to:

1. Write `remapper_config.json`
2. Update launcher icon paths / copy active or inactive artwork and rescan the app list
3. Generate `/var/lib/webosbrew/key_redirector.sh` (polls `getForegroundAppInfo`)
4. Patch `/var/lib/webosbrew/startup.sh` with an idempotent managed block
5. Restart the redirector daemon
6. Show a toast with the new status

After a reboot, `startup.sh` starts the daemon again automatically.

## Project layout

```
appinfo.json
index.html
js/app.js
css/style.css
icon.png
assets/
deploy.sh
scripts/tv-install.sh
README.md
.gitignore
.env.example          # copy to .env (gitignored) for TV_HOST etc.
dist/                 # build output (gitignored) — *.ipk
```

## Notes

- Keys are detected by matching known vendor app IDs (for example Netflix may appear as `netflix`, `com.webos.app.netflix`, or `com.netflix.ninja`).
- Develop and test on device; `PalmServiceBridge` is not available in a desktop browser.
- Uninstalling the app does not automatically remove the startup block or config; clear or edit those paths if you stop using the remapper.
- Built IPKs live under `dist/` and are ignored by git.
- Put the TV IP (and optional SSH settings) in `.env`; never commit `.env`.
