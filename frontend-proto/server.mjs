// Локальний сервер без залежностей: віддає сторінку й /api/assistant.
// Для закритого контуру: працює без інтернету разом з Ollama.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import handler from "./api/assistant.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || "127.0.0.1";

function shim(res) {
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.setHeader("content-type", "application/json; charset=utf-8"); res.end(JSON.stringify(b)); return res; };
  return res;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/api/assistant") {
    let raw = "";
    for await (const chunk of req) { raw += chunk; if (raw.length > 100000) return shim(res).status(413).json({ error: "too_large" }); }
    try { req.body = raw ? JSON.parse(raw) : {}; } catch { return shim(res).status(400).json({ error: "bad_json" }); }
    return handler(req, shim(res));
  }
  if (url.pathname === "/" || url.pathname === "/index.html") {
    const html = await fs.readFile(path.join(root, "index.html"));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(html);
  }
  res.writeHead(404).end("Not found");
}).listen(port, host, () => {
  console.log(`Integrity Index: http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);
  console.log(`Модель: ${process.env.LLM_MODEL} через ${process.env.LLM_BASE_URL}`);
});
