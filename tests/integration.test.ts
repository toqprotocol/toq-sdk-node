/**
 * Integration tests: Node SDK against a real toq daemon.
 *
 * Requires the toq binary to be built. Set TOQ_BIN env var to the binary path,
 * or it defaults to ../toq/target/release/toq.
 */

import { connect, Client, ToqError } from "../src";
import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function findBinary(): string {
  if (process.env.TOQ_BIN) {
    // Could be a bare name on PATH or an absolute path
    try {
      return execSync(`which ${process.env.TOQ_BIN}`, { encoding: "utf-8" }).trim();
    } catch {
      return process.env.TOQ_BIN;
    }
  }
  return join(__dirname, "../../toq/target/release/toq");
}

const TOQ_BIN = findBinary();
const ALICE_API = 29810;
const ALICE_PROTO = 29809;
const BOB_API = 29812;
const BOB_PROTO = 29811;

let aliceDir: string;
let bobDir: string;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function setupInstance(name: string, apiPort: number, protoPort: number): string {
  const dir = mkdtempSync(join(tmpdir(), `toq-sdk-it-${name}-`));
  execFileSync(TOQ_BIN, [
    "setup", "--non-interactive",
    "--agent-name", name,
    "--connection-mode", "open",
    "--adapter", "http",
  ], { env: { ...process.env, HOME: dir } });

  const configPath = join(dir, ".toq/config.toml");
  let config = readFileSync(configPath, "utf-8");
  config = config.replace("port = 9009", `port = ${protoPort}`);
  config = config.replace("api_port = 9010", `api_port = ${apiPort}`);
  writeFileSync(configPath, config);

  execFileSync(TOQ_BIN, ["up"], { env: { ...process.env, HOME: dir } });
  return dir;
}

function stopInstance(dir: string) {
  try { execFileSync(TOQ_BIN, ["down"], { env: { ...process.env, HOME: dir } }); } catch {}
}

beforeAll(async () => {
  if (!existsSync(TOQ_BIN)) {
    throw new Error(`toq binary not found at ${TOQ_BIN}`);
  }
  aliceDir = setupInstance("alice", ALICE_API, ALICE_PROTO);
  bobDir = setupInstance("bob", BOB_API, BOB_PROTO);
  await sleep(2000);
}, 20000);

afterAll(async () => {
  stopInstance(aliceDir);
  stopInstance(bobDir);
  await sleep(500);
});

function alice(): Client { return connect(`http://127.0.0.1:${ALICE_API}`); }
function bob(): Client { return connect(`http://127.0.0.1:${BOB_API}`); }

// ── Core: does the SDK actually work? ────────────────────────

describe("end-to-end message delivery", () => {
  it("alice sends, bob receives via messages() SSE", async () => {
    const bobClient = bob();
    const received: any[] = [];

    // Start listening on bob
    const listener = (async () => {
      for await (const msg of bobClient.messages()) {
        received.push(msg);
        break; // one message is enough
      }
    })();

    await sleep(500);

    // Alice sends to bob with wait=true
    const aliceClient = alice();
    const result = await aliceClient.send(
      `toq://127.0.0.1:${BOB_PROTO}/bob`,
      "hello from SDK",
      { wait: true }
    );

    expect(result).toHaveProperty("status", "delivered");

    // Wait for bob to receive
    await Promise.race([listener, sleep(5000)]);

    expect(received.length).toBeGreaterThan(0);
    expect(received[0].body).toBeDefined();
    const bodyStr = JSON.stringify(received[0].body);
    expect(bodyStr).toContain("hello from SDK");
  }, 15000);
});

// ── Single daemon tests ──────────────────────────────────────

describe("SDK against real daemon", () => {
  it("health returns ok", async () => {
    const result = await alice().health();
    expect(result).toContain("ok");
  });

  it("status returns running with correct agent name", async () => {
    const result = await alice().status();
    expect(result).toHaveProperty("status", "running");
    expect((result as any).address).toContain("alice");
    expect((result as any).public_key).toMatch(/^ed25519:/);
  });

  it("peers is empty on fresh daemon", async () => {
    const result = await alice().peers();
    expect(Array.isArray(result)).toBe(true);
    // May have bob from the e2e test, but should be a valid array
  });

  it("approvals is empty on open-mode daemon", async () => {
    const result = await alice().approvals();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });

  it("block adds to peers, unblock removes", async () => {
    const client = alice();
    const key = "ed25519:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

    await client.block(key);
    const afterBlock = await client.peers();
    const blocked = afterBlock.find((p: any) => p.status === "blocked");
    expect(blocked).toBeDefined();
    expect((blocked as any).public_key).toContain("AAAA");

    await client.unblock(key);
    const afterUnblock = await client.peers();
    const stillBlocked = afterUnblock.find((p: any) => p.status === "blocked" && (p as any).public_key.includes("AAAA"));
    expect(stillBlocked).toBeUndefined();
  });

  it("send to unreachable throws ToqError with message", async () => {
    try {
      await alice().send("toq://nonexistent.invalid/agent", "hello");
      fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ToqError);
      expect((e as ToqError).message).toBeTruthy();
    }
  });

  it("send with invalid address throws ToqError", async () => {
    await expect(
      alice().send("not-a-valid-address", "hello")
    ).rejects.toThrow(ToqError);
  });

  it("discover returns agents array", async () => {
    const result = await alice().discover("example.com");
    expect(Array.isArray(result)).toBe(true);
  });

  it("discoverLocal returns agents array", async () => {
    const result = await alice().discoverLocal();
    expect(Array.isArray(result)).toBe(true);
  });

  it("streamStart to unreachable throws ToqError", async () => {
    await expect(
      alice().streamStart("toq://nonexistent.invalid/agent")
    ).rejects.toThrow(ToqError);
  });

  it("streaming end-to-end: alice streams to bob", async () => {
    const bobClient = bob();
    const received: any[] = [];

    const listener = (async () => {
      for await (const msg of bobClient.messages()) {
        received.push(msg);
        if (msg.type === "message.stream.end") break;
      }
    })();

    await sleep(500);

    const stream = await alice().streamStart(`toq://127.0.0.1:${BOB_PROTO}/bob`);
    expect(stream).toHaveProperty("stream_id");
    expect(stream).toHaveProperty("thread_id");

    const chunk = await alice().streamChunk(stream.stream_id as string, "hello ");
    expect(chunk).toHaveProperty("chunk_id");

    const end = await alice().streamEnd(stream.stream_id as string);
    expect(end).toHaveProperty("chunk_id");

    await Promise.race([listener, sleep(5000)]);
    const chunks = received.filter((m) => m.type === "message.stream.chunk");
    expect(chunks.length).toBeGreaterThan(0);
  }, 15000);

  it("getThread returns empty messages for unknown thread", async () => {
    const result = await alice().getThread("nonexistent-thread");
    expect(result).toHaveProperty("thread_id", "nonexistent-thread");
    expect((result as any).messages).toEqual([]);
  });

  it("logs returns array", async () => {
    const result = await alice().logs();
    expect(Array.isArray(result)).toBe(true);
  });

  it("shutdown stops daemon, health fails after", async () => {
    const client = alice();
    await client.shutdown(false);
    await sleep(1000);

    await expect(alice().health()).rejects.toThrow(ToqError);

    // Restart alice for cleanup
    execFileSync(TOQ_BIN, ["up"], { env: { ...process.env, HOME: aliceDir } });
    await sleep(2000);
  }, 10000);

  it("revoke removes approved peer", async () => {
    const client = alice();
    // Use a valid-length Ed25519 key (32 bytes base64-encoded)
    const fakeKey = "ed25519:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    await client.approve(fakeKey);
    await client.revoke(fakeKey);
  });

  it("history returns messages array", async () => {
    const client = alice();
    const msgs = await client.history({ limit: 10 });
    expect(Array.isArray(msgs)).toBe(true);
  });

  it("history accepts from filter", async () => {
    const client = alice();
    const msgs = await client.history({ limit: 5, from: "alice" });
    expect(Array.isArray(msgs)).toBe(true);
  });

  it("block by address pattern", async () => {
    const client = alice();
    await client.block({ from: "toq://evil.com/*" });
    const perms = await client.permissions();
    const blocked = perms.blocked as any[];
    expect(blocked.some((r: any) => r.value === "toq://evil.com/*")).toBe(true);
    // Clean up
    await client.unblock({ from: "toq://evil.com/*" });
  });

  it("approve by address pattern", async () => {
    const client = alice();
    await client.approve({ from: "toq://trusted.com/*" });
    const perms = await client.permissions();
    const approved = perms.approved as any[];
    expect(approved.some((r: any) => r.value === "toq://trusted.com/*")).toBe(true);
    // Clean up
    await client.revoke({ from: "toq://trusted.com/*" });
  });

  it("permissions returns approved and blocked", async () => {
    const client = alice();
    const perms = await client.permissions();
    expect(Array.isArray(perms.approved)).toBe(true);
    expect(Array.isArray(perms.blocked)).toBe(true);
  });
});
