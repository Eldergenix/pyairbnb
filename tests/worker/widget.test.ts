import { describe, expect, it } from "vitest";
import { STAYS_WIDGET_HTML } from "../../worker/src/widget.js";

describe("MCP Apps widget bridge", () => {
  it("completes the lifecycle handshake before relying on tool results", () => {
    expect(STAYS_WIDGET_HTML).toContain('request("ui/initialize"');
    expect(STAYS_WIDGET_HTML).toContain('notify("ui/notifications/initialized"');
    expect(STAYS_WIDGET_HTML).toContain('"ui/notifications/tool-result"');
    expect(STAYS_WIDGET_HTML.indexOf('window.addEventListener("message"')).toBeLessThan(
      STAYS_WIDGET_HTML.indexOf("void connectHost()"),
    );
  });

  it("uses portable host bridges for links and automatic sizing", () => {
    expect(STAYS_WIDGET_HTML).toContain('request("ui/open-link"');
    expect(STAYS_WIDGET_HTML).toContain('notify("ui/notifications/size-changed"');
    expect(STAYS_WIDGET_HTML).toContain("ResizeObserver");
  });
});
