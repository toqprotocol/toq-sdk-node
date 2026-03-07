const DEFAULT_URL = "http://127.0.0.1:9010";
const URL_ENV = "TOQ_API_URL";
const DAEMON_NOT_RUNNING = "toq daemon is not running. Run 'toq up' first.";

export class ToqError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToqError";
  }
}

export interface Message {
  id: string;
  type: string;
  from: string;
  body?: unknown;
  thread_id?: string;
  reply_to?: string;
  content_type?: string;
  timestamp: string;
  reply: (text: string) => Promise<Record<string, unknown>>;
}

export function connect(url?: string): Client {
  const resolved = url || process.env[URL_ENV] || DEFAULT_URL;
  return new Client(resolved);
}

export class Client {
  private readonly url: string;

  constructor(baseUrl: string) {
    this.url = baseUrl.replace(/\/$/, "");
  }

  private async request(
    method: string,
    path: string,
    options?: { json?: unknown; params?: Record<string, string | number> }
  ): Promise<Response> {
    let fullPath = `${this.url}${path}`;
    if (options?.params) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(options.params)) {
        qs.set(k, String(v));
      }
      fullPath += `?${qs}`;
    }
    const init: RequestInit = { method };
    if (options?.json !== undefined) {
      init.headers = { "Content-Type": "application/json" };
      init.body = JSON.stringify(options.json);
    }
    let resp: Response;
    try {
      resp = await fetch(fullPath, init);
    } catch (err) {
      throw new ToqError(DAEMON_NOT_RUNNING);
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new ToqError(`HTTP ${resp.status}: ${text}`);
    }
    return resp;
  }

  private async json(
    method: string,
    path: string,
    options?: { json?: unknown; params?: Record<string, string | number> }
  ): Promise<Record<string, unknown>> {
    const resp = await this.request(method, path, options);
    return resp.json() as Promise<Record<string, unknown>>;
  }

  // ── Messages ─────────────────────────────────────────

  async send(
    to: string | string[],
    text: string,
    options?: {
      thread_id?: string;
      reply_to?: string;
      close_thread?: boolean;
      wait?: boolean;
      timeout?: number;
    }
  ): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = { to, body: { text } };
    if (options?.thread_id) body.thread_id = options.thread_id;
    if (options?.reply_to) body.reply_to = options.reply_to;
    if (options?.close_thread) body.close_thread = true;
    return this.json("POST", "/v1/messages", {
      json: body,
      params: {
        wait: String(options?.wait ?? true),
        timeout: options?.timeout ?? 30,
      },
    });
  }

  async *messages(): AsyncGenerator<Message> {
    const resp = await this.request("GET", "/v1/messages");
    const reader = resp.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = JSON.parse(line.slice(6));
        const client = this;
        yield {
          id: data.id,
          type: data.type,
          from: data.from,
          body: data.body,
          thread_id: data.thread_id,
          reply_to: data.reply_to,
          content_type: data.content_type,
          timestamp: data.timestamp,
          async reply(text: string) {
            return client.send(data.from, text, {
              thread_id: data.thread_id,
              reply_to: data.id,
            });
          },
        };
      }
    }
  }

  async streamStart(
    to: string,
    options?: { thread_id?: string }
  ): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = { to };
    if (options?.thread_id) body.thread_id = options.thread_id;
    return this.json("POST", "/v1/stream/start", { json: body });
  }

  async streamChunk(
    streamId: string,
    text: string
  ): Promise<Record<string, unknown>> {
    return this.json("POST", "/v1/stream/chunk", {
      json: { stream_id: streamId, text },
    });
  }

  async streamEnd(
    streamId: string,
    options?: { close_thread?: boolean }
  ): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = { stream_id: streamId };
    if (options?.close_thread) body.close_thread = true;
    return this.json("POST", "/v1/stream/end", { json: body });
  }

  // ── Threads ──────────────────────────────────────────

  async getThread(threadId: string): Promise<Record<string, unknown>> {
    return this.json("GET", `/v1/threads/${threadId}`);
  }

  // ── Peers ────────────────────────────────────────────

  async peers(): Promise<unknown[]> {
    return ((await this.json("GET", "/v1/peers")) as any).peers;
  }

  async block(publicKey: string): Promise<void> {
    await this.request("POST", `/v1/peers/${encodeURIComponent(publicKey)}/block`);
  }

  async unblock(publicKey: string): Promise<void> {
    await this.request("DELETE", `/v1/peers/${encodeURIComponent(publicKey)}/block`);
  }

  // ── Approvals ────────────────────────────────────────

  async approvals(): Promise<unknown[]> {
    return ((await this.json("GET", "/v1/approvals")) as any).approvals;
  }

  async approve(id: string): Promise<void> {
    await this.request("POST", `/v1/approvals/${encodeURIComponent(id)}`, {
      json: { decision: "approve" },
    });
  }

  async deny(id: string): Promise<void> {
    await this.request("POST", `/v1/approvals/${encodeURIComponent(id)}`, {
      json: { decision: "deny" },
    });
  }

  // ── Discovery ────────────────────────────────────────

  async discover(host: string): Promise<unknown[]> {
    return ((await this.json("GET", "/v1/discover", {
      params: { host },
    })) as any).agents;
  }

  async discoverLocal(): Promise<unknown[]> {
    return ((await this.json("GET", "/v1/discover/local")) as any).agents;
  }

  // ── Daemon ───────────────────────────────────────────

  async health(): Promise<string> {
    const resp = await this.request("GET", "/v1/health");
    return resp.text();
  }

  async status(): Promise<Record<string, unknown>> {
    return this.json("GET", "/v1/status");
  }

  async shutdown(graceful = true): Promise<void> {
    await this.request("POST", "/v1/daemon/shutdown", {
      json: { graceful },
    });
  }

  async logs(follow = false): Promise<unknown[] | AsyncGenerator<unknown>> {
    if (follow) {
      return this.followLogs();
    }
    return ((await this.json("GET", "/v1/logs")) as any).entries;
  }

  private async *followLogs(): AsyncGenerator<unknown> {
    const resp = await this.request("GET", "/v1/logs", {
      params: { follow: "true" },
    });
    const reader = resp.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        yield JSON.parse(line.slice(6));
      }
    }
  }

  async clearLogs(): Promise<void> {
    await this.request("DELETE", "/v1/logs");
  }

  async diagnostics(): Promise<Record<string, unknown>> {
    return this.json("GET", "/v1/diagnostics");
  }

  async checkUpgrade(): Promise<Record<string, unknown>> {
    return this.json("GET", "/v1/upgrade/check");
  }

  // ── Connections ──────────────────────────────────────

  async connections(): Promise<unknown[]> {
    return ((await this.json("GET", "/v1/connections")) as any).connections;
  }

  // ── Keys ─────────────────────────────────────────────

  async rotateKeys(): Promise<Record<string, unknown>> {
    return this.json("POST", "/v1/keys/rotate");
  }

  // ── Backup ───────────────────────────────────────────

  async exportBackup(passphrase: string): Promise<string> {
    return ((await this.json("POST", "/v1/backup/export", {
      json: { passphrase },
    })) as any).data;
  }

  async importBackup(passphrase: string, data: string): Promise<void> {
    await this.request("POST", "/v1/backup/import", {
      json: { passphrase, data },
    });
  }

  // ── Config ───────────────────────────────────────────

  async config(): Promise<Record<string, unknown>> {
    return ((await this.json("GET", "/v1/config")) as any).config;
  }

  async updateConfig(
    updates: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return ((await this.json("PATCH", "/v1/config", {
      json: updates,
    })) as any).config;
  }

  // ── Agent Card ───────────────────────────────────────

  async card(): Promise<Record<string, unknown>> {
    return this.json("GET", "/v1/card");
  }
}
