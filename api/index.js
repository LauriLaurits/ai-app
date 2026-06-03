import "dotenv/config";
import { handleHealthRequest } from "../src/httpHandlers.js";

export default function handler(req, res) {
  handleHealthRequest(req, res);
}
