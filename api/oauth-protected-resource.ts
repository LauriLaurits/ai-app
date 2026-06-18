import "dotenv/config";
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleProtectedResourceMetadataRequest } from "../src/httpHandlers.js";

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  handleProtectedResourceMetadataRequest(req, res);
}
