import type { IncomingMessage, ServerResponse } from "node:http";
import type { Logger } from "./utils.js";
import { readJsonBody } from "./utils.js";
import type { GatewayRpc } from "./gateway-rpc.js";

export class CronProxy {
  private log: Logger;
  private gatewayRpc: GatewayRpc;

  constructor(log: Logger, gatewayRpc: GatewayRpc) {
    this.log = log;
    this.gatewayRpc = gatewayRpc;
  }

  async handleList(res: ServerResponse): Promise<void> {
    try {
      const result = await this.gatewayRpc.rpc("cron.list", {});
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify(result ?? []));
    } catch (err: any) {
      this.log.error("cron list failed:", err.message);
      res.writeHead(500, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify({ error: err.message }));
    }
  }

  async handleCreate(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let body: any;
    try {
      body = await readJsonBody(req);
    } catch {
      res.writeHead(400, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }

    const {
      name,
      message,
      at,
      every,
      cron,
      announce,
      deleteAfterRun,
      channel,
      to,
      session,
      bestEffortDeliver,
      deliveryType,
    } = body;
    if (!message) {
      res.writeHead(400, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify({ error: "Missing 'message' field" }));
      return;
    }

    // Validate and apply delivery type tag
    const validDeliveryTypes = ["notify", "silent", "result"] as const;
    if (deliveryType && !validDeliveryTypes.includes(deliveryType)) {
      res.writeHead(400, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(
        JSON.stringify({
          error: `Invalid deliveryType: ${deliveryType}. Must be one of: ${validDeliveryTypes.join(", ")}`,
        }),
      );
      return;
    }
    const taggedMessage = deliveryType
      ? `[DELIVERY:${deliveryType.toUpperCase()}] ${message}`
      : message;

    const jobName = name || `pinclaw-${Date.now()}`;

    try {
      const result = await this.gatewayRpc.rpc("cron.add", {
        name: jobName,
        message: taggedMessage,
        at,
        every,
        cron,
        announce: announce !== false,
        deleteAfterRun: !!deleteAfterRun,
        channel,
        to,
        session,
        bestEffortDeliver: !!bestEffortDeliver,
      });
      this.log.info(
        `Cron job created: ${JSON.stringify(result).slice(0, 100)}`,
      );
      res.writeHead(201, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify(result ?? { ok: true }));
    } catch (err: any) {
      this.log.error("cron add failed:", err.message);
      res.writeHead(500, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify({ error: err.message }));
    }
  }

  async handleDelete(jobId: string, res: ServerResponse): Promise<void> {
    try {
      await this.gatewayRpc.rpc("cron.remove", { id: jobId });
      this.log.info(`Cron job deleted: ${jobId}`);
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify({ ok: true, id: jobId }));
    } catch (err: any) {
      this.log.error(`cron rm ${jobId} failed:`, err.message);
      res.writeHead(500, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify({ error: err.message }));
    }
  }

  async handleToggle(
    jobId: string,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    let body: any = {};
    try {
      body = await readJsonBody(req);
    } catch {}

    const enabled = body.enabled ?? true;

    try {
      await this.gatewayRpc.rpc("cron.update", {
        id: jobId,
        patch: { enabled },
      });
      this.log.info(`Cron job ${enabled ? "enabled" : "disabled"}: ${jobId}`);
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify({ ok: true, id: jobId, enabled }));
    } catch (err: any) {
      this.log.error(`cron toggle ${jobId} failed:`, err.message);
      res.writeHead(500, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify({ error: err.message }));
    }
  }
}
