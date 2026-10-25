import test from "node:test";
import assert from "node:assert/strict";
import { createScribeTokenHandler } from "../server/scribe-token.mjs";

function request(handler, { method = "POST", origin = "http://localhost:5173", site = "same-origin" } = {}) {
  const headers = {};
  let body;
  const res = { statusCode: 200, setHeader(k, v) { headers[k] = v; }, end(value) { body = JSON.parse(value); } };
  const req = { url: "/api/scribe-token", method, headers: { origin, host: "localhost:5173", "sec-fetch-site": site }, socket: { remoteAddress: "127.0.0.1" } };
  return Promise.resolve(handler(req, res, () => {})).then(() => ({ status: res.statusCode, body, headers }));
}

test("token route returns only a short-lived token and never caches it", async () => {
  let type;
  const handler = createScribeTokenHandler({ client: { tokens: { singleUse: { create: async kind => {
    type = kind; return { token: "temporary-token", privateField: "not-for-browser" };
  } } } } });
  const result = await request(handler);
  assert.equal(type, "realtime_scribe");
  assert.deepEqual(result.body, { token: "temporary-token" });
  assert.equal(result.headers["Cache-Control"], "no-store");
});

test("token route rejects cross-site requests and rate limits retries without provider calls", async () => {
  let calls = 0;
  const handler = createScribeTokenHandler({ client: { tokens: { singleUse: { create: async () => {
    calls++; return { token: "temporary-token" };
  } } } }, now: () => 1000 });
  assert.equal((await request(handler, { origin: "https://other.example" })).status, 403);
  assert.equal((await request(handler, { site: "cross-site" })).status, 403);
  assert.equal((await request(handler, { method: "GET" })).status, 405);
  assert.equal(calls, 0);
  for (let i = 0; i < 12; i++) assert.equal((await request(handler)).status, 200);
  assert.equal((await request(handler)).status, 429);
  assert.equal(calls, 12);
});

test("provider errors do not expose credentials or provider details", async () => {
  const handler = createScribeTokenHandler({ client: { tokens: { singleUse: { create: async () => {
    throw new Error("sensitive upstream detail");
  } } } } });
  const result = await request(handler);
  assert.equal(result.status, 503);
  assert.doesNotMatch(JSON.stringify(result.body), /sensitive upstream detail/);
});
