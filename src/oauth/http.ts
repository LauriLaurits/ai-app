import type { IncomingMessage, ServerResponse } from "node:http";

export async function readBody(
  req: IncomingMessage,
  maxBytes = 64 * 1024
): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) {
      throw new Error("Request body is too large");
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString("utf8");
}

export async function readForm(req: IncomingMessage): Promise<Record<string, string>> {
  const body = await readBody(req);
  return Object.fromEntries(new URLSearchParams(body));
}

export function sendJson(
  res: ServerResponse,
  statusCode: number,
  body: unknown,
  headers: Record<string, string> = {}
): void {
  res.writeHead(statusCode, {
    "content-type": "application/json",
    ...headers,
  });
  res.end(JSON.stringify(body));
}

export function sendHtml(res: ServerResponse, statusCode: number, html: string): void {
  res.writeHead(statusCode, {
    "content-type": "text/html; charset=utf-8",
  });
  res.end(html);
}

export function redirect(res: ServerResponse, location: string): void {
  res.writeHead(302, { Location: location });
  res.end();
}
