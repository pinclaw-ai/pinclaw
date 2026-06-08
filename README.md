<h1 align="center">Pinclaw</h1>

<p align="center">
  <strong>A wearable terminal for your own AI agents.</strong><br>
  Talk to your Claude Code, OpenClaw, or Codex anytime, anywhere — hands-free, no phone, no app.
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

You already have powerful agents — Claude Code, OpenClaw, Codex. They're stuck at your desk. Pinclaw is the channel between you and them: a terminal you wear, so you can reach your own agent anytime, anywhere. Tap it, say one sentence, and the task is **dispatched to your own agent**. It runs in the background and the result comes back when it's done. Dispatch, not chat — press, speak, move on.

Two form factors, one capability: the **Clip** ($129, available now) clips to your collar; the **Ring** — our flagship — is in private beta, making "raise your hand and dispatch an agent" as invisible as a ring on your finger. Your whole agent fleet, always on you.

```
You speak → Pinclaw Clip (BLE) → iPhone App (STT) → Cloud → your own agent
                                                            (Claude Code / OpenClaw / Codex)
                                                                 ↓
Result pushed back ← iPhone App ← ── ── agent runs it in the background
```

**3 seconds to dispatch a task** — vs. ~30s pulling out your phone, unlocking, and typing.

## What Makes Pinclaw Different

| | |
|---|---|
| **Dispatch, not chat** | Fire-and-forget: say it once, your agent runs it in the background. Not Q&A. |
| **Your own agent** | Drives the agents you already run — Claude Code, OpenClaw, Codex. Not a locked-in model. |
| **Offline delivery** | Phone locked, on the move? The result is pushed back when ready. |
| **Remote-control Claude Code** | Attach to a Claude Code session running on your Mac and drive it from your pocket. |
| **Deep iPhone integration** | Calendar, Reminders, Contacts, Health, HomeKit — all by voice. |

## Quick Start — OpenClaw Plugin

Pinclaw is the first hardware product built for [OpenClaw](https://github.com/openclaw/openclaw). Install the plugin, link your account, and your clip dispatches tasks to your own AI agent.

### 1. Install

```bash
openclaw plugins install pinclaw --dangerously-force-unsafe-install
```

### 2. Login

```bash
openclaw pinclaw login
```

Enter your pinclaw.ai email and password. The relay is configured and the gateway restarts automatically. You'll see `Relay connected!` when it's done.

### 4. Connect the app

Open the [Pinclaw iOS app](https://apps.apple.com/app/pinclaw/id6760344343), sign in with the same account — done.

### Verify

```
/pinclaw status
```

> See the full plugin documentation in [`plugin/README.md`](plugin/README.md) for configuration, API endpoints, server tools, and architecture details.

## Bring Your Own Agent

Pinclaw is a terminal, not a model. Connect the agent you already run:

| Mode | What It Is | Cost |
|------|-----------|------|
| **Claude Code** | Attach to a [Claude Code](https://claude.com/product/claude-code) session on your Mac and drive it from the Clip. | Free |
| **MyOpenClaw** | Run your own [OpenClaw](https://github.com/openclaw/openclaw) instance. We handle the relay. | Free |
| **MyHermes** | Any OpenAI-compatible backend — Codex CLI, Ollama, or self-hosted. No cloud required. | Free |
| **Pinclaw Pro** | Managed agent in the cloud. Latest models (Claude, GPT-4o, Gemini), zero setup. | $29/mo or $279/yr |

Buy the hardware once. Dispatch to whichever agent is yours.

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
| MCU | Seeed XIAO nRF52840 Sense (ARM Cortex-M4 @ 64MHz) |
| Microphone | PDM MEMS (built into XIAO Sense) |
| Audio | Opus codec over BLE 5.0, I2S speaker (MAX98357A) |
| Feedback | RGB LED + speaker (no screen) |
| Battery | 3.7V LiPo, USB-C charging (onboard BQ25101) |
| Firmware | Zephyr RTOS v2.2.0 ([source + UF2](hardware-opensource/firmware/pinclaw_zephyr/)) |
| Interaction | Single-button push-to-talk |

The [`hardware-opensource/`](hardware-opensource/) directory contains everything you need to build a Pinclaw Clip: firmware source code, 3D-printable enclosure STL files, wiring guides, and a schematic PDF. Flash the UF2 binary via drag-and-drop — no programmer needed.

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
├── hardware-opensource/       # Open-source DIY Kit
│   ├── firmware/              #   Zephyr firmware (source + UF2 binary)
│   ├── enclosure/             #   3D printing files (STL)
│   ├── models/                #   STEP component models
│   ├── wiring/                #   Wiring guides (EN + CN)
│   └── docs/                  #   Schematic PDF, design brief
├── plugin/                    # OpenClaw channel plugin (npm package)
└── public/                    # Product assets
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

Pinclaw's core is open source (MIT) — hardware, firmware, cloud relay, and the OpenClaw plugin. Fork, build, and open a PR.

Join our [Discord](https://discord.gg/628R3FbV) to discuss ideas.

## License

MIT

---

<p align="center">
  <strong>Tap. Speak. Dispatch.</strong><br>
  <a href="https://pinclaw.ai/reserve">Get the Clip →</a>
</p>
