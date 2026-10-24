import { puzzlePage } from "../shared/page.ts";

export default (request: Request): Response => {
  const url = new URL(request.url);
  const code = url.pathname.slice("/p/".length).replace(/\/+$/, "");
  const { status, html } = puzzlePage(code, url.origin);
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=0, must-revalidate",
      "netlify-cdn-cache-control": "public, durable, max-age=31536000",
    },
  });
};

export const config = { path: "/p/*", cache: "manual" };
