import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";

test("the preview server serves both canonical logos as SVG images", { timeout: 10000 }, async t => {
  const server = spawn(process.execPath, ["scripts/serve.mjs"], {
    cwd: new URL("../", import.meta.url),
    env: { ...process.env, PORT: "0" },
    stdio: ["ignore", "pipe", "inherit"]
  });
  t.after(async () => {
    if (server.exitCode !== null) return;
    const exited = once(server, "exit");
    server.kill();
    await exited;
  });
  const [output] = await once(server.stdout, "data");
  const origin = output.toString().match(/http:\/\/localhost:\d+/)?.[0];
  assert.ok(origin, "preview server announces its actual listening port");
  for (const variant of ["light", "dark"]) {
    const response = await fetch(`${origin}/ks-design-art-on-${variant}.svg`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/svg+xml");
    assert.match(await response.text(), /<title[^>]*>ks design\.art<\/title>/);
  }
});
