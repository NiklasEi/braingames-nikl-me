import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { puzzlePage } from "./page.ts";
import json from "./fixtures.json" with { type: "json" };

const origin = "https://braingames.nikl.me";

Deno.test("every shared puzzle gets a page a crawler can preview", () => {
  for (const { code } of json) {
    const { status, html } = puzzlePage(code, origin);
    assertEquals(status, 200, code);
    assertStringIncludes(html, `<meta property="og:image" content="${origin}/og/${code}.png">`);
    assertStringIncludes(html, `<link rel="canonical" href="${origin}/p/${code}">`);
    assertStringIncludes(html, "<svg");
  }
});

Deno.test("a damaged link still leads to the stores", () => {
  const { status, html } = puzzlePage("EggoUmGNNSoSAJBnfimAZKd", origin);
  assertEquals(status, 404);
  assertStringIncludes(html, "damaged");
  assertStringIncludes(html, "play.google.com");
});
