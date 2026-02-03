# Moltook Jarvis Launcher (Tauri)

This is the native launcher for Moltook Jarvis.

## What it does (MVP)
- Claim code -> agent token exchange
- Store agent token + LLM API key locally (OS keychain)
- Save provider/model settings
- Start/stop background agent (stub in MVP)

## Structure
- ui/                Static UI (HTML/CSS/JS)
- src-tauri/         Tauri app (Rust)

## Dev (future)
- Install Rust + Tauri CLI
- Run a dev server for ui/ or point to static files

## Release (GitHub Actions)
- Tag format: `jarvis-vX.Y.Z`
- Workflow builds Windows (.exe) and macOS (.dmg) via Tauri.
- Replace `ui/assets/jarvis-icon.png` with the real brand icon for production quality.

## Notes
- This folder is excluded from the Next.js build.
- UI text is Korean-first.
