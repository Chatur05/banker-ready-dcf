import assert from "node:assert/strict";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the valuation workbench", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Banker Ready DCF<\/title>/i);
  assert.match(html, /Every number has[\s\S]*somewhere to go back to/i);
  assert.match(html, /Build valuation/i);
  assert.match(html, /Missing facts stop the model by design/i);
  assert.doesNotMatch(html, /Your site is taking shape|Building your site/i);
});

test("invalid tickers are rejected before a source request", async () => {
  const response = await render("/api/model?ticker=%24BAD");
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.error, /valid U\.S\. public-equity ticker/i);
});
