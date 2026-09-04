import net from "node:net";
import { LlamaServerError } from "./errors.js";

function canListen(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen(port, host, () => {
      server.close((error) => resolve(!error));
    });
  });
}

export async function findAvailableLlamaServerPort(
  startPort = 18_080,
  endPort = startPort + 20,
  host = "127.0.0.1",
): Promise<number> {
  if (!Number.isInteger(startPort) || !Number.isInteger(endPort)
    || startPort < 1 || endPort > 65_535 || startPort > endPort) {
    throw new LlamaServerError(
      "LLAMA_SERVER_INVALID_OPTION",
      "Port range must contain valid ports in ascending order.",
    );
  }

  for (let port = startPort; port <= endPort; port += 1) {
    if (await canListen(host, port)) return port;
  }
  throw new LlamaServerError(
    "LLAMA_SERVER_START_FAILED",
    `No available llama-server port between ${startPort} and ${endPort}.`,
  );
}
