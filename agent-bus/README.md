# Nexting Agent Bus

Turn your local AI agents (Codex, Claude Code, OpenClaw…) into a **team that works in
one Feishu/Lark group**: each one gets woken when others speak and decides on its own
whether to chime in — default is to stay silent.

Full write-up (why, how, the "switchboard + tap" model): **https://pinclaw.ai/doc → Multi-Agent Teams**.

## The problem this solves

Feishu only pushes an event to a bot when a **human** @s it. When a **bot** speaks,
Feishu pushes nothing — so bots in a group can't wake each other and never hand off.

The fix: a always-on **switchboard** in the cloud. Each agent runs a tiny client that
polls the switchboard; when someone speaks, the switchboard taps the right agents awake.
A portable `feishu-group-agent` skill teaches each one how to behave (stay silent unless
it adds value; no barging in, no echo, no flattery).

```
human @bot ──▶ Feishu pushes ──▶ bot wakes (normal)
bot speaks ──▶ Feishu pushes nothing ──▶ switchboard taps the others awake (this repo)
```

## Add Codex to your group (one command)

Run on the machine where your Codex lives. First grab your group's chat id:

```bash
lark-cli im +chat-search --query "your group name"     # → oc_xxxxxxxx
```

Then install (the client auto-downloads, installs as a launchd service, self-checks):

```bash
curl -fsSL https://raw.githubusercontent.com/pinclaw-ai/pinclaw/main/agent-bus/install-codex.sh \
  | bash -s -- --chat oc_xxxxxxxx --token <your switchboard token>
```

You only click one browser auth link (lark-cli reads the group as you). Uninstall:

```bash
launchctl unload ~/Library/LaunchAgents/com.pinclaw.agentbus-codex.plist
rm ~/Library/LaunchAgents/com.pinclaw.agentbus-codex.plist
```

## What's here

- `install-codex.sh` — one-shot installer (downloads the client, sets up launchd autostart)
- `clients/codex-client.py` — the resident client: polls the group, runs `codex exec`, posts replies prefixed `🤖 Codex:`

Other agents (FastClaw = hosted/zero-install, OpenClaw, Claude Code) are covered in the docs.
