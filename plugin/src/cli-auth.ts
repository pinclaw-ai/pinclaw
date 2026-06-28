import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const BOOTSTRAP_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes (matches pairing code expiry)
const API_URL = process.env.PINCLAW_RELAY_URL || "https://api.pinclaw.ai";

let loginInProgress = false;

/**
 * /pinclaw login — bootstrap a relay instance and show pairing code.
 *
 * Flow:
 * 1. Call /api/v1/relay/bootstrap to create a pending relay instance + pairing code
 * 2. Display QR code + 6-digit code in terminal
 * 3. User goes to pinclaw.ai/account and enters the code (or scans QR)
 * 4. Cloud binds instance to user, sends pairing_claimed via relay WS
 * 5. Plugin writes relay config to ~/.openclaw/openclaw.json
 * 6. User restarts gateway to connect
 */
export async function handlePinclawLogin(_api: any): Promise<{ text: string }> {
  if (loginInProgress) {
    return { text: "Login already in progress." };
  }

  // Check if already configured
  const configPath = join(homedir(), ".openclaw", "openclaw.json");
  try {
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    if (config.channels?.pinclaw?.relay?.token) {
      return {
        text: "Already connected. Run /pinclaw logout first to reconfigure.",
      };
    }
  } catch {}

  loginInProgress = true;

  try {
    // 1. Bootstrap: create pending relay instance + pairing code
    const resp = await fetch(`${API_URL}/api/v1/relay/bootstrap`, {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
    });

    if (!resp.ok) {
      loginInProgress = false;
      const body = await resp.text().catch(() => "");
      return {
        text: `Failed to create relay instance: ${resp.status} ${body}`,
      };
    }

    const data = (await resp.json()) as {
      code: string;
      relayToken: string;
      subdomain: string;
      expiresIn: number;
    };

    // 2. Show QR code + pairing code in terminal
    const pairUrl = `https://pinclaw.ai/account/pair?code=${data.code}`;
    const lines: string[] = [];

    lines.push("");
    lines.push("========================================");

    // Try to show QR code
    try {
      const qr = await import("qrcode-terminal");
      lines.push("  Scan this QR code to link your OpenClaw:");
      lines.push("");
      const qrPromise = new Promise<string>((resolve) => {
        qr.default.generate(pairUrl, { small: true }, resolve);
      });
      const qrText = await qrPromise;
      for (const line of qrText.split("\n")) {
        lines.push(`  ${line}`);
      }
    } catch {
      // qrcode-terminal not available
    }

    lines.push("");
    lines.push(`  Link URL: ${pairUrl}`);
    lines.push("");
    lines.push(`  Or enter code manually: ${data.code}`);
    lines.push(`  Expires in ${Math.floor(data.expiresIn / 60)} minutes`);
    lines.push("");
    lines.push("  Go to pinclaw.ai/account and enter the code above.");
    lines.push("========================================");
    lines.push("");

    // 3. Write relay config immediately (so gateway can connect on restart)
    // The relay instance is already created, just not yet bound to a user account
    try {
      writeRelayConfig({
        relayToken: data.relayToken,
        pinclawToken: "", // Will be set when pairing completes
        subdomain: data.subdomain,
      });
    } catch (err: any) {
      loginInProgress = false;
      return { text: `Failed to write config: ${err.message}` };
    }

    lines.push("Relay config saved. After entering the code on pinclaw.ai,");
    lines.push("restart the gateway: openclaw gateway run");

    loginInProgress = false;
    return { text: lines.join("\n") };
  } catch (err: any) {
    loginInProgress = false;
    return { text: `Login failed: ${err.message}` };
  }
}

export function writeRelayConfig(data: {
  relayToken: string;
  pinclawToken: string;
  subdomain: string;
}): void {
  const configDir = join(homedir(), ".openclaw");
  const configPath = join(configDir, "openclaw.json");

  // Ensure ~/.openclaw/ directory exists
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  let config: any = {};

  try {
    config = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    // File missing or invalid — start fresh
  }

  // Ensure plugins.allow includes pinclaw
  if (!config.plugins) config.plugins = {};
  if (!config.plugins.allow) config.plugins.allow = [];
  if (!config.plugins.allow.includes("pinclaw")) {
    config.plugins.allow.push("pinclaw");
  }

  // Write channels.pinclaw with relay config
  if (!config.channels) config.channels = {};
  config.channels.pinclaw = {
    ...config.channels.pinclaw,
    enabled: true,
    ...(data.pinclawToken ? { authToken: data.pinclawToken } : {}),
    relay: {
      enabled: true,
      token: data.relayToken,
    },
  };

  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}

export async function handlePinclawStatus(
  _api: any,
): Promise<{ text: string }> {
  const configPath = join(homedir(), ".openclaw", "openclaw.json");
  try {
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    const relay = config.channels?.pinclaw?.relay;
    if (relay?.enabled && relay?.token) {
      return {
        text: `Nexting relay: configured (token=${relay.token.substring(0, 8)}...)`,
      };
    }
    return { text: "Nexting relay: not configured. Run /pinclaw login" };
  } catch {
    return { text: "Nexting relay: not configured. Run /pinclaw login" };
  }
}

export async function handlePinclawLogout(
  _api: any,
): Promise<{ text: string }> {
  const configPath = join(homedir(), ".openclaw", "openclaw.json");
  try {
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    if (config.channels?.pinclaw) {
      delete config.channels.pinclaw.relay;
      delete config.channels.pinclaw.authToken;
      writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
    }
    return { text: "Nexting relay config removed." };
  } catch {
    return { text: "Nothing to remove." };
  }
}
