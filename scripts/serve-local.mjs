// scripts/serve-local.mjs — local static server mirroring vercel.json routing,
// for the layout test (Vercel previews are SSO-walled, so test locally
// against the exact same files). Usage: node scripts/serve-local.mjs [port]
// Rewrites: /services/ and /book/ -> /index.html (URL stays); /faq[/] -> 301 /questions/.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = Number(process.argv[2] || 8123);
const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".txt": "text/plain; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".mp4": "video/mp4", ".webm": "video/webm", ".woff2": "font/woff2",
};

http.createServer((req, res) => {
  const u = new URL(req.url, "http://localhost");
  let p = decodeURIComponent(u.pathname);
  if (p === "/faq" || p === "/faq/") {
    res.writeHead(301, { Location: "/questions/" });
    return res.end();
  }
  if (p === "/services" || p === "/services/" || p === "/book" || p === "/book/") p = "/index.html";
  let file = path.join(ROOT, p);
  if (p.endsWith("/")) file = path.join(file, "index.html");
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("404 " + p); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
}).listen(PORT, () => console.log(`serving ${ROOT} on http://localhost:${PORT}`));
