<p align="center">
  <img src="public/nexting-logo.png" alt="Nexting" width="96">
</p>

<h1 align="center">Nexting</h1>

<p align="center">
  <strong>A wearable agent dispatcher for your own AI agents.</strong><br>
  Talk to your Claude Code, Codex, or OpenClaw anywhere, anytime — wear it, speak, dispatch. No phone, no app.
</p>

<p align="center">
  <a href="https://pinclaw.ai">Website</a> ·
  <a href="https://apps.apple.com/app/pinclaw/id6760344343">App Store</a> ·
  <a href="https://pinclaw.ai/doc">Docs</a> ·
  <a href="https://discord.gg/628R3FbV">Discord</a> ·
  <a href="https://x.com/EricShang98">Twitter</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/pinclaw"><img src="https://img.shields.io/npm/v/pinclaw.svg" alt="npm" /></a>
</p>

---

<p align="center">
  <img src="public/nexting-hero.png" alt="Nexting PIN — white, black, and champagne gold" width="720">
</p>

You already have powerful agents — Claude Code, Codex, OpenClaw. They're locked to your desk. **Nexting is the channel between you and them**: a terminal you wear, so you can reach your own agent without pulling out your phone or opening an app. Tap it, say one sentence, and the task is **dispatched to your own agent**. It runs in the background and the result comes back when it's done.

**Dispatch, not chat — press, speak, move on.**

Nexting comes in two form factors, one capability. The **PIN** ($129, shipping now) pins to your collar — the one you can get today. The **Ring** — our flagship, in private beta — makes "raise your hand and dispatch an agent" as invisible as a ring on your finger. Same capabilities, two shapes. Your whole agent team, always on you.

```
You speak → Nexting PIN (BLE) → iPhone App (STT) → Cloud → your own agent
                                                          (Claude Code / Codex / OpenClaw)
                                                               ↓
 Result pushed back ← iPhone App ← ── ── agent runs it in the background
```

**3 seconds to dispatch a task** — vs. ~30s pulling out your phone, unlocking, and typing.

## What Makes Nexting Different

| | |
|---|---|
| **Dispatch, not chat** | Fire-and-forget: say it once, your agent runs it in the background. Not Q&A. |
| **Your own agent** | Drives the agents you already run — Claude Code, Codex, OpenClaw. Not a locked-in model. |
| **Private by default** | BYOA modes (Claude Code, Codex, MyOpenClaw) are end-to-end encrypted — Nexting relays ciphertext, not your session. |
| **Delivers while you're offline** | Phone locked, on the move? The agent still finishes the job and pushes the result back. |
| **Remote-control your agent** | Attach to a Claude Code or Codex session on your Mac and drive it from your pocket — live. |
| **Deep iPhone integration** | Calendar, Reminders, Contacts, Health, HomeKit — all by voice. |

Nexting isn't another voice assistant — it's the pocket control surface for your agent team.

## Get Started

1. **Get a PIN** ($129, shipping now) — or join the [Ring private beta](https://pinclaw.ai/reserve).
2. **Install the [Nexting iOS app](https://apps.apple.com/app/pinclaw/id6760344343)** and sign in.
3. **Pair your PIN** over Bluetooth.
4. **Connect your agent** — Claude Code, Codex, OpenClaw, a local model, or managed Nexting Pro (see below).
5. **Press, speak, dispatch.**

## Bring Your Own Agent

Nexting is a terminal, not a model. Connect the agent you already run:

| Mode | What It Is | Cost |
|------|-----------|------|
| **Claude Code** | Attach to a [Claude Code](https://claude.com/product/claude-code) session on your Mac and drive it from your PIN — live. | Free |
| **Codex** | Attach to an OpenAI Codex CLI session on your Mac and drive it from your PIN — live. | Free |
| **MyOpenClaw** | Run your own [OpenClaw](https://github.com/openclaw/openclaw) instance. We handle the relay. | Free |
| **MyHermes** | Any OpenAI-compatible local AI — Hermes Agent, Ollama, vLLM, LM Studio. | Free |
| **Nexting Pro** | Managed agent in the cloud. Latest Claude, GPT, and Gemini models, zero setup. | $29/mo or $279/yr |

Buy the hardware once. Dispatch to whichever agent is yours.

### Connect Claude Code or Codex

Run the Nexting Mac bridge — your Claude Code / Codex sessions show up on your phone, live and two-way:

```bash
npm install -g nexting-cc-bridge
nexting-cc-bridge start
```

Full pairing and remote-control walkthrough: [pinclaw.ai/doc](https://pinclaw.ai/doc).

### Connect via OpenClaw

Nexting is also the first hardware product built for [OpenClaw](https://github.com/openclaw/openclaw). Install the plugin and link your account:

```bash
openclaw plugins install pinclaw --dangerously-force-unsafe-install
openclaw pinclaw login
```

> The npm package and CLI commands use the internal codename `pinclaw` — that's by design, not a leftover. Full plugin docs: [`plugin/README.md`](plugin/README.md).

### Connect a local model (MyHermes)

Point Nexting at any OpenAI-compatible local AI with the `nexting-hermes-bridge` CLI:

```bash
npm install -g nexting-hermes-bridge
nexting-hermes-bridge login
nexting-hermes-bridge start --endpoint http://localhost:8642 --model hermes-agent
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

The [`hardware-opensource/`](hardware-opensource/) directory is a complete **Co-Builder Edition**: firmware source, 3D-printable enclosure files, and a schematic PDF — everything you need to build a Nexting PIN yourself. Flash the UF2 binary via drag-and-drop — no programmer needed.

## iPhone Integration

Your phone isn't just a pipe — it's the bridge between you and your AI. The Nexting app registers native iOS capabilities as skills your agent can call:

- **Calendar** — Read and create events
- **Reminders** — Manage tasks and to-do lists
- **Contacts** — Look up people
- **Health** — Access HealthKit data
- **HomeKit** — Control smart home devices
- **Location** — Context-aware responses
- **Timer** — Set and manage timers

Say "schedule a meeting tomorrow at 3pm" — the agent calls your iPhone's calendar directly.

All data stays on your iPhone. You control every permission.

## Privacy

- BYOA modes (Claude Code, Codex, MyOpenClaw) are **end-to-end encrypted by default** — Nexting relays ciphertext, not readable session content
- Raw audio is discarded immediately after transcription — never stored
- Voice streams over encrypted WebSocket (WSS)
- Self-hosted modes keep all data on your own infrastructure
- No always-on listening — recording only while the button is held
- We never train on your data, never sell it, never share it — and you can delete it anytime

## Repository Structure

```
nexting/
├── hardware-opensource/       # DIY Co-Builder Kit
│   ├── firmware/              #   Zephyr firmware (source + UF2 binary)
│   ├── enclosure/             #   3D printing files (STL + OpenSCAD)
│   └── docs/                  #   Schematic PDF
├── plugin/                    # OpenClaw channel plugin (npm package)
└── public/                    # Product assets
```

> The codename `pinclaw` persists in package names, file paths, and identifiers — it's the permanent internal handle. **Nexting** is the brand. Both coexisting is intentional.

## Links

| | |
|---|---|
| Website | [pinclaw.ai](https://pinclaw.ai) |
| iOS App | [App Store](https://apps.apple.com/app/pinclaw/id6760344343) |
| Docs | [pinclaw.ai/doc](https://pinclaw.ai/doc) |
| Discord | [Join community](https://discord.gg/628R3FbV) |
| Twitter | [@EricShang98](https://x.com/EricShang98) |
| Get a PIN | [pinclaw.ai/reserve](https://pinclaw.ai/reserve) |

## Contributing

Issues and pull requests welcome. Join our [Discord](https://discord.gg/628R3FbV) to discuss ideas.

## License

MIT

---

<p align="center">
  <strong>Tap. Speak. Dispatch.</strong><br>
  <a href="https://pinclaw.ai/reserve">Get the PIN →</a>
</p>
