#!/usr/bin/env node

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const dist = resolve(import.meta.dirname, "..", "dist");
const port = Number(process.env.PORT ?? 4660);
const types = {
  ".html": "text/html; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

async function resolveFile(pathname) {
  try {
    const relative = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
    const candidate = join(dist, relative);
    if (!candidate.startsWith(dist)) return null;
    let file = candidate;
    const info = await stat(file);
    if (info.isDirectory()) file = join(file, "index.html");
    await stat(file);
    return file;
  } catch {
    return null;
  }
}

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  const file = await resolveFile(url.pathname);
  if (!file) {
    response.writeHead(404, { "content-type": types[".txt"] });
    response.end(`Not found: ${url.pathname}\n`);
    return;
  }
  response.writeHead(200, {
    "content-type": types[extname(file)] ?? "application/octet-stream"
  });
  createReadStream(file).pipe(response);
}).listen(port, () => {
  console.log(`Fathom preview: http://localhost:${port}`);
});
