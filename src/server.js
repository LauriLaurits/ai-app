import "dotenv/config";
import { createServer } from "node:http";
import { config } from "./config.js";
import { createAppLogger } from "./logging/logger.js";
import {
  handleHealthRequest,
  handleMcpRequest,
  handleProtectedResourceMetadataRequest,
  isMcpPath,
} from "./httpHandlers.js";

const logger = createAppLogger(config);

const httpServer = createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400).end("Missing URL");
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "GET" && url.pathname === "/") {
    handleHealthRequest(req, res);
    return;
  }

  if (
    req.method === "GET" &&
    url.pathname === "/.well-known/oauth-protected-resource"
  ) {
    handleProtectedResourceMetadataRequest(req, res);
    return;
  }

  if (isMcpPath(url.pathname)) {
    await handleMcpRequest(req, res);
    return;
  }

  res.writeHead(404).end("Not Found");
});

httpServer.listen(config.port, () => {
  logger.info("server_started", {
    port: config.port,
    mcpUrl: `${config.publicBaseUrl}${config.mcpPath}`,
    authMode: config.auth.mode,
    shopAdapter: config.shop.adapter,
  });
});
