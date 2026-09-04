import http from "node:http";
import process from "node:process";

function argumentValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const host = argumentValue("--host", "127.0.0.1");
const port = Number(argumentValue("--port", "8080"));
const readyDelayMs = Number(argumentValue("--fake-ready-delay", "25"));
const startedAt = Date.now();

const server = http.createServer((request, response) => {
  if (request.url !== "/health") {
    response.writeHead(404).end();
    return;
  }
  if (Date.now() - startedAt < readyDelayMs) {
    response.writeHead(503, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: "Loading model" } }));
    return;
  }
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ status: "ok" }));
});

server.listen(port, host, () => {
  process.stdout.write(`fake llama-server listening on ${host}:${port}\n`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
