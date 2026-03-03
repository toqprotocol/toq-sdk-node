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
