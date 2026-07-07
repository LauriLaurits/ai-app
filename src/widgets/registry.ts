import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppConfig } from "../types.js";

export interface WidgetDefinition {
  name: string;
  uri: string;
  description: string;
  html: string;
}

export const WIDGET_MIME_TYPE = "text/html;profile=mcp-app";

export function widgetToolMeta(
  uri: string,
  invoking: string,
  invoked: string
): Record<string, unknown> {
  return {
    ui: { resourceUri: uri },
    "openai/outputTemplate": uri,
    "openai/toolInvocation/invoking": invoking,
    "openai/toolInvocation/invoked": invoked,
  };
}

function resourceMeta(config: AppConfig, widget: WidgetDefinition): Record<string, unknown> {
  return {
    "openai/widgetDescription": widget.description,
    ui: {
      prefersBorder: true,
      csp: {
        connectDomains: [],
        resourceDomains: config.widgets.imageDomains,
      },
    },
  };
}

export function registerWidgetResources(
  server: McpServer,
  config: AppConfig,
  widgets: WidgetDefinition[]
): void {
  for (const widget of widgets) {
    const meta = resourceMeta(config, widget);
    server.registerResource(
      widget.name,
      widget.uri,
      { mimeType: WIDGET_MIME_TYPE, _meta: meta },
      async () => ({
        contents: [
          { uri: widget.uri, mimeType: WIDGET_MIME_TYPE, text: widget.html, _meta: meta },
        ],
      })
    );
  }
}
