<p align="center">
  <img src="ios/Pinclaw/Assets.xcassets/pinclaw-product.imageset/pinclaw-product.png" alt="Pinclaw" width="280">
</p>

<h1 align="center">Pinclaw</h1>

<p align="center">
  <strong>A tiny clip-on AI that listens, thinks, and acts.</strong><br>
  Hands-free. Screen-free. One tap to dispatch.
</p>

<p align="center">
  <a href="https://pinclaw.ai">Website</a> &nbsp;·&nbsp;
  <a href="https://pinclaw.ai/reserve">Pre-order ($99)</a> &nbsp;·&nbsp;
  <a href="https://pinclaw.ai/doc/specs">Specs</a>
</p>

---

## Why Pinclaw

Phone assistants answer questions. Pinclaw **acts**.

Clip it on, press the button, speak naturally — your AI agent schedules meetings, drafts emails, sets reminders, and books reservations in the background. You move on with your life.

- **3 seconds** to assign a task (vs. ~30s on phone)
- **Autonomous execution** — it works while you don't
- **Context memory** — remembers people, conversations, and threads for weeks
- **Deep iPhone integration** — Calendar, Reminders, Contacts, Health, HomeKit, all by voice
- **99.2% recognition accuracy** in noisy environments
- **Open ecosystem** — use our managed cloud, or bring your own AI

## How It Works

```
┌─────────────┐       BLE 5.0       ┌─────────────┐       WSS        ┌─────────────────┐
│  Pinclaw    │  ─── Opus audio ──> │  iPhone App │  ────────────>   │  Pinclaw Cloud  │
│  (clip-on)  │  <── TTS playback── │  (STT/TTS)  │  <────────────   │  (AI agent)     │
└─────────────┘                     └─────────────┘                  └─────────────────┘
  button + mic                       iOS 17.0+                         Claude / GPT-4o
  haptic feedback                    Swift/UIKit                        or your own model
```

One tap starts recording. Release to send. The agent responds by voice — no screen needed.

## Hardware

Purpose-built for voice-first AI interaction:

| Spec             | Detail                               |
| ---------------- | ------------------------------------ |
| Form factor      | Clip-on, wearable                    |
| Microphone       | Beamforming array, noise suppression |
| Audio codec      | Opus over BLE 5.0                    |
| Feedback         | Haptic + LED (no screen)             |
| Battery          | ~12 hours typical use                |
| Charging         | USB-C, ~45 min to full               |
| Water resistance | IPX4 splash-resistant                |
| Interaction      | Single-button push-to-talk           |

## Three Ways to Use It

| Mode            | What It Is                                                                 | Cost              |
| --------------- | -------------------------------------------------------------------------- | ----------------- |
| **Pinclaw Pro** | Managed AI agent in the cloud. Latest models, zero setup.                  | $29/mo or $279/yr |
| **MyOpenClaw**  | Connect your own [OpenClaw](https://github.com/BasedHardware/omi) instance | Free              |
| **MyHermes**    | Local AI via any OpenAI-compatible backend (Ollama, etc.)                  | Free              |

Buy the hardware once ($99). Choose your AI.

## Software Stack

| Layer        | Technology                                        |
| ------------ | ------------------------------------------------- |
| Firmware     | JieLi AC6956 (custom BLE audio profile)           |
| Mobile       | iOS (Swift/UIKit), Android (Kotlin/Compose)       |
| Cloud        | Node.js + TypeScript, Fastify, PostgreSQL, Redis  |
| AI           | Claude Sonnet 4, GPT-4o, or bring your own        |
| Website      | Next.js + Tailwind CSS, Cloudflare Pages          |
| Local bridge | `pinclaw-bridge` (npm package for self-hosted AI) |

## Repository Structure

```
pinclaw/
├── firmware/          # Device firmware (JieLi AC6956)
├── ios/               # iPhone app (Swift/UIKit)
├── android/           # Android app (Kotlin/Jetpack Compose)
├── cloud/             # Cloud control plane (Fastify + WebSocket)
│   └── api/           #   REST API + real-time WS gateway
├── bridge/            # Local AI bridge (pinclaw-bridge)
├── website/           # pinclaw.ai (Next.js)
├── hardware/          # 3D printing files, schematics
└── docs/              # Architecture docs
```

## Development

```bash
# Cloud API
cd cloud/api && npm install && npm run dev

# Website
cd website && npm install && npm run dev

# iOS app
open ios/Pinclaw.xcodeproj

# Android app
# Open android/ in Android Studio
```

## Privacy

- Raw audio is never stored — discarded immediately after transcription
- Voice data streams over encrypted WebSocket (WSS)
- Self-hosted modes keep all data on your own infrastructure
- No always-on listening — recording only while button is held

## License

MIT

---

<p align="center">
  <strong>Talk. Act. Move on.</strong><br>
  <a href="https://pinclaw.ai/reserve">Reserve yours →</a>
</p>
