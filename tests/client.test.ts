import { connect, Client, ToqError } from "../src";

describe("connect", () => {
  it("returns a Client with default URL", () => {
    const client = connect();
    expect(client).toBeInstanceOf(Client);
  });

  it("accepts a custom URL", () => {
    const client = connect("http://localhost:8080");
    expect(client).toBeInstanceOf(Client);
  });

  it("reads from env var", () => {
    process.env.TOQ_API_URL = "http://custom:1234";
    const client = connect();
    expect(client).toBeInstanceOf(Client);
    delete process.env.TOQ_API_URL;
  });

  it("explicit URL overrides env var", () => {
    process.env.TOQ_API_URL = "http://from-env:1234";
    const client = connect("http://explicit:5678");
    expect(client).toBeInstanceOf(Client);
    delete process.env.TOQ_API_URL;
  });
});

describe("Client", () => {
  it("throws ToqError when daemon is not running", async () => {
    const client = connect("http://127.0.0.1:19999");
    await expect(client.status()).rejects.toThrow(ToqError);
    await expect(client.status()).rejects.toThrow("not running");
  });
});


describe("Client methods with mocked fetch", () => {
  let client: Client;

  beforeEach(() => {
    client = connect("http://localhost:9010");
  });

  function mockFetch(body: unknown, status = 200) {
    global.fetch = jest.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
      body: null,
    }) as any;
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("send calls POST /v1/messages", async () => {
    mockFetch({ id: "m1", status: "delivered", thread_id: "t1", timestamp: "now" });
    const result = await client.send("toq://host/agent", "hello");
    expect(result).toHaveProperty("status", "delivered");
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/v1/messages"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("peers calls GET /v1/peers", async () => {
    mockFetch({ peers: [{ public_key: "k1", address: "a1", status: "connected", last_seen: "now" }] });
    const result = await client.peers();
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveProperty("public_key", "k1");
  });

  it("block calls POST /v1/block", async () => {
    mockFetch(null);
    await client.block("ed25519:abc");
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/v1/block"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("unblock calls DELETE /v1/block", async () => {
    mockFetch(null);
    await client.unblock("ed25519:abc");
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/v1/block"),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("approvals calls GET /v1/approvals", async () => {
    mockFetch({ approvals: [{ id: "k1", public_key: "k1", address: "a1", requested_at: "now" }] });
    const result = await client.approvals();
    expect(result).toHaveLength(1);
  });

  it("approve calls POST /v1/approvals/{id}", async () => {
    mockFetch(null);
    await client.approve("k1");
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/v1/approvals/"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("deny calls POST /v1/approvals/{id}", async () => {
    mockFetch(null);
    await client.deny("k1");
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/v1/approvals/"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("health calls GET /v1/health", async () => {
    mockFetch("ok");
    const result = await client.health();
    expect(result).toBe("ok");
  });

  it("status calls GET /v1/status", async () => {
    mockFetch({ status: "running", address: "toq://localhost/agent" });
    const result = await client.status();
    expect(result).toHaveProperty("status", "running");
  });

  it("shutdown calls POST /v1/daemon/shutdown", async () => {
    mockFetch(null);
    await client.shutdown();
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/v1/daemon/shutdown"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("send throws ToqError on non-200", async () => {
    mockFetch({ error: { code: "invalid", message: "bad" } }, 400);
    await expect(client.send("toq://host/agent", "hi")).rejects.toThrow(ToqError);
  });
});
