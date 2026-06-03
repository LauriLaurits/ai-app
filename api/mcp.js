import "dotenv/config";
import { handleMcpRequest } from "../src/httpHandlers.js";

export default async function handler(req, res) {
  await handleMcpRequest(req, res);
}
