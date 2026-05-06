<h1 align="center">Pinclaw</h1>

<p align="center">
  <strong>A tiny clip-on AI that listens, thinks, and acts.</strong><br>
  Not another assistant on your phone — a full agent you wear.
</p>

<p align="center">
  <a href="https://pinclaw.ai">Website</a> ·
  <a href="https://apps.apple.com/app/pinclaw/id6760344343">App Store</a> ·
  <a href="https://pinclaw.ai/doc">Docs</a> ·
  <a href="https://discord.gg/628R3FbV">Discord</a> ·
  <a href="https://x.com/EricShang98">Twitter</a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" /></a>
  <a href="https://www.npmjs.com/package/pinclaw"><img src="https://img.shields.io/npm/v/pinclaw.svg" alt="npm" /></a>
  <a href="https://discord.gg/628R3FbV"><img src="https://img.shields.io/discord/1234567890?color=5865F2&label=discord" alt="Discord" /></a>
</p>

---

<p align="center">
  <img src="public/pinclaw-hero.png" alt="Pinclaw" width="720">
</p>

Clip it on, press the button, speak naturally. Your AI agent schedules meetings, drafts emails, sets reminders, books reservations — all in the background. You move on with your life.

```
You speak → Pinclaw Clip (BLE) → iPhone App (STT) → Cloud → AI Agent
                                                                 ↓
You hear  ← Pinclaw Clip (TTS) ← iPhone App ← ── ── AI Response
```

**3 seconds to assign a task. 5x faster than pulling out your phone.**

## What Makes Pinclaw Different

| | |
|---|---|
| **Acts, not answers** | Schedules, drafts, books — autonomously. Not just Q&A. |
| **Hears you cleanly** | 99.2% recognition accuracy in noisy environments. |
| **Holds your context** | Remembers people, conversations, and threads for weeks. |
| **Deep iPhone integration** | Calendar, Reminders, Contacts, Health, HomeKit — all by voice. |
| **Open ecosystem** | Use our managed cloud, or bring your own AI. |

## Quick Start — OpenClaw Plugin

Pinclaw is the first hardware product built for [OpenClaw](https://github.com/BasedHardware/omi). Install the plugin, link your account, and your clip talks to your own AI agent.

### 1. Install

```bash
openclaw plugins install pinclaw
```

### 2. Start the gateway

```bash
openclaw gateway
```

### 3. Link your account

In the OpenClaw chat:

```
/pinclaw login
```

This opens a browser to sign in at [pinclaw.ai](https://pinclaw.ai). Once authenticated, the relay is auto-configured — your iPhone reaches your local OpenClaw from anywhere.

### 4. Connect the app

Open the [Pinclaw iOS app](https://apps.apple.com/app/pinclaw/id6760344343), sign in with the same account — done.

### Verify

```
/pinclaw status
```

> See the full plugin documentation in [`plugin/README.md`](plugin/README.md) for configuration, API endpoints, server tools, and architecture details.

## Three Ways to Use It

| Mode | What It Is | Cost |
|------|-----------|------|
| **Pinclaw Pro** | Managed AI agent in the cloud. Latest models (Claude, GPT-4o, Gemini), zero setup. | $29/mo or $279/yr |
| **MyOpenClaw** | Run your own [OpenClaw](https://github.com/BasedHardware/omi) instance. We handle the relay. | Free |
| **MyHermes** | Local AI via Hermes, Ollama, or any OpenAI-compatible backend. No cloud required. | Free |

Buy the hardware once. Choose your AI.

### Hermes / Local AI Setup

```bash
# install pinclaw-bridge
npm install -g pinclaw-bridge

# connect to your local AI
pinclaw-bridge login \
    --endpoint http://localhost:8642 \
    --model hermes-agent

# start
pinclaw-bridge start
```

## Hardware

Purpose-built for voice-first interaction. No screen — by design.

| Spec | Detail |
|------|--------|
| Microphone | Beamforming array, noise suppression |
| Audio | Opus codec over BLE 5.0 |
| Feedback | Haptic + LED (no screen) |
| Battery | ~12 hours typical use |
| Charging | USB-C, ~45 min to full |
| Water resistance | IPX4 splash-resistant |
| Interaction | Single-button push-to-talk |

The `hardware/` directory contains 3D-printable enclosure files (OpenSCAD + STL) if you want to build or modify the clip.

## iPhone Integration

Your phone isn't just a pipe — it's the bridge between you and your AI. The Pinclaw app registers native iOS capabilities as skills your agent can call:

- **Calendar** — Read and create events
- **Reminders** — Manage tasks and to-do lists
- **Contacts** — Look up people
- **Health** — Access HealthKit data
- **HomeKit** — Control smart home devices
- **Location** — Context-aware responses
- **Timer** — Set and manage timers

Say "schedule a meeting tomorrow at 3pm" — the agent calls your iPhone's calendar directly.

All data stays on your iPhone. You control every permission.

## Repository Structure

```
pinclaw/
├── plugin/              # OpenClaw channel plugin (npm package)
├── firmware/            # Device firmware (BLE audio, mic, LED)
├── hardware/            # 3D-printable enclosure (v1–v4, OpenSCAD + STL)
└── public/              # Product assets
```

## Privacy

- Raw audio is discarded immediately after transcription — never stored
- Voice streams over encrypted WebSocket (WSS)
- Self-hosted modes keep all data on your own infrastructure
- No always-on listening — recording only while button is held

## Links

| | |
|---|---|
| Website | [pinclaw.ai](https://pinclaw.ai) |
| iOS App | [App Store](https://apps.apple.com/app/pinclaw/id6760344343) |
| Docs | [pinclaw.ai/doc](https://pinclaw.ai/doc) |
| Discord | [Join community](https://discord.gg/628R3FbV) |
| Twitter | [@EricShang98](https://x.com/EricShang98) |
| Buy Pinclaw | [pinclaw.ai/reserve](https://pinclaw.ai/reserve) |

## Contributing

Pinclaw is fully open source. Fork, build, and open a PR.

Join our [Discord](https://discord.gg/628R3FbV) to discuss ideas.

## License

MIT

---

<p align="center">
  <strong>Talk. Act. Move on.</strong><br>
  <a href="https://pinclaw.ai/reserve">Get yours →</a>
</p>
