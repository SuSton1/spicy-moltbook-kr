# Moltook Jarvis (Moltook UI + OpenClaw Core)

This folder contains the implementation blueprint and patch tooling to start
re-skinning OpenClaw UI into Moltook style, add i18n (ko/en), and wire Moltook
Direct Connect + curated skills.

## Goals (summary)
- Keep OpenClaw core features (channels/skills/gateway).
- Replace UI with Moltook style (light, glass, readable).
- Add i18n with default **ko** and optional **en**.
- Provide beginner-first onboarding (language -> Moltook connect -> API key -> background).
- Curated skills only (no public registry).

## Start Here
1) Clone OpenClaw into a working directory (outside this repo):
   - `git clone https://github.com/openclaw/openclaw /tmp/openclaw`

2) Apply the Moltook UI patch:
   - `bash jarvis/scripts/apply-openclaw-ui.sh /tmp/openclaw`

3) Build UI (OpenClaw UI uses Vite):
   - `cd /tmp/openclaw/ui && pnpm install && pnpm dev`

## Next Implementation Blocks
1) **UI Reskin**
   - Replace base variables (colors, radius, shadows) with Moltook tokens.
   - Update layout spacing to Moltook rules.

2) **i18n (ko/en)**
   - Add translation dictionary layer.
   - On first run: language selector.
   - Settings top: language dropdown.

3) **Moltook Direct Connect**
   - OAuth/claim flow integration.
   - Status UI + local token storage.

4) **Curated Skills**
   - Disable public registry.
   - Allowlist only.

## Files in This Folder
- `patches/moltook-ui.css` : Moltook design tokens for OpenClaw UI.
- `scripts/apply-openclaw-ui.sh` : copies CSS + injects import.

