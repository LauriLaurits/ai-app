import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import {
  registerWidgetResources,
  widgetToolMeta,
  WIDGET_MIME_TYPE,
  type WidgetDefinition,
} from "../src/widgets/registry.js";
import { makeConfig } from "./helpers.js";
import { productGridWidget } from "../src/widgets/productGridWidget.js";

const sampleWidget: WidgetDefinition = {
  name: "sample-widget",
  uri: "ui://widget/sample.html",
  description: "Sample widget",
  html: "<!doctype html><html><body>hi</body></html>",
};

async function withResourceClient<T>(
  widgets: WidgetDefinition[],
  imageDomains: string[],
  fn: (client: Client) => Promise<T>
): Promise<T> {
  const server = new McpServer({ name: "widget-test", version: "0.0.1" });
  registerWidgetResources(
    server,
    makeConfig({ widgets: { imageDomains } }),
    widgets
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    return await fn(client);
  } finally {
    await client.close();
    await server.close();
  }
}

describe("widget registry", () => {
  it("serves widget resources with the Apps SDK mime type", async () => {
    const contents = await withResourceClient([sampleWidget], [], async (client) => {
      const list = await client.listResources();
      expect(list.resources.map((r) => r.uri)).toContain("ui://widget/sample.html");
      const read = await client.readResource({ uri: "ui://widget/sample.html" });
      return read.contents;
    });

    const first = contents[0] as { mimeType?: string; text?: string };
    expect(first?.mimeType).toBe(WIDGET_MIME_TYPE);
    expect(String(first?.text)).toContain("<!doctype html>");
  });

  it("declares image domains in the widget CSP", async () => {
    const contents = await withResourceClient(
      [sampleWidget],
      ["https://cdn.shop.test"],
      async (client) => (await client.readResource({ uri: "ui://widget/sample.html" })).contents
    );

    const meta = contents[0]?._meta as {
      ui?: { csp?: { resourceDomains?: string[] } };
    };
    expect(meta?.ui?.csp?.resourceDomains).toEqual(["https://cdn.shop.test"]);
  });

  it("builds tool meta with template uri and status texts", () => {
    const meta = widgetToolMeta("ui://widget/sample.html", "Working…", "Done");
    expect(meta["openai/outputTemplate"]).toBe("ui://widget/sample.html");
    expect((meta.ui as { resourceUri: string }).resourceUri).toBe("ui://widget/sample.html");
    expect(meta["openai/toolInvocation/invoking"]).toBe("Working…");
    expect(meta["openai/toolInvocation/invoked"]).toBe("Done");
  });
});

describe("product grid widget template", () => {
  it("is a self-contained document using the openai bridge", () => {
    expect(productGridWidget.uri).toBe("ui://widget/product-grid.html");
    expect(productGridWidget.html).toContain("window.openai");
    expect(productGridWidget.html).toContain("openai:set_globals");
    expect(productGridWidget.html).toContain("add_to_cart");
    expect(productGridWidget.html).not.toMatch(/<script[^>]+src=/i);
    expect(productGridWidget.html).not.toMatch(/<link[^>]/i);
  });

  it("escapes shop-provided text before rendering", () => {
    expect(productGridWidget.html).toContain("function esc(");
  });

  it("handles the empty state", () => {
    expect(productGridWidget.html).toContain("No products found");
  });
});
