import "dotenv/config";
import { handleProtectedResourceMetadataRequest } from "../src/httpHandlers.js";

export default function handler(req, res) {
  handleProtectedResourceMetadataRequest(req, res);
}
