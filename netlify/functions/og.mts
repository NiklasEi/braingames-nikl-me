// Serves /og/<code>.png, the link preview image of a shared puzzle.
//
// The image is rendered from the Typst template in og/puzzle_card with Oicana on the first
// request for a code. A code always reads the same, so Netlify's durable cache keeps the
// image for every request after that, across all of its edge locations, until a deploy.
import { CompilationMode, Template } from "@oicana/node";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { CodeError, readCode } from "../shared/puzzle_code.ts";
import { GAMES } from "../shared/render.ts";

/** Packed by `oicana pack og/puzzle_card -o og/dist`, shipped through `included_files` */
const TEMPLATE = "og/dist/puzzle_card-0.1.0.zip";

let template: Template | undefined;

function puzzleCard(): Template {
  template ??= new Template(readFileSync(join(process.cwd(), TEMPLATE)));
  return template;
}

// Shows in the function log how often Netlify reuses an instance: every line of one instance
// carries its id, and a call count above 1 means the module, and with it the template, stayed warm
const instance = crypto.randomUUID().slice(0, 8);
const loadedAt = Date.now();
// Time from the process starting until this module was ready, the native addons included
const bootMs = process.uptime() * 1000;
let calls = 0;

/** Each lap returns the milliseconds since the previous one */
function stopwatch(): { lap(): number } {
  let last = performance.now();
  return {
    lap() {
      const now = performance.now();
      const elapsed = now - last;
      last = now;
      return elapsed;
    },
  };
}

function kb(bytes: number): string {
  return (bytes / 1024).toFixed(1);
}

function serverTiming(steps: Record<string, number>): string {
  return Object.entries(steps).map(([step, ms]) => `${step};dur=${ms.toFixed(1)}`).join(", ");
}

export default async (request: Request): Promise<Response> => {
  const code = new URL(request.url).pathname.match(/^\/og\/([A-Za-z0-9_-]+)\.png$/)?.[1];
  let puzzle;
  try {
    puzzle = readCode(code ?? "");
  } catch (error) {
    if (error instanceof CodeError) {
      return new Response("Not a puzzle", { status: 404 });
    }
    throw error;
  }

  calls++;
  const cold = template === undefined;
  const timer = stopwatch();
  const loaded = puzzleCard();
  const templateMs = timer.lap();

  const card = JSON.stringify({ ...GAMES[puzzle.game], puzzle });
  const document = await loaded.compileAsync(
    new Map([["card", card]]),
    new Map(),
    CompilationMode.Production,
  );
  const compileMs = timer.lap();
  let rendered;
  try {
    // 2 pixels per point turn the 600x315pt page into 1200x630
    rendered = await document.exportPngAsync(2);
  } finally {
    document.dispose();
  }
  const exportMs = timer.lap();
  // Typst writes true colour PNGs. The card is flat colours and some smoothed edges, which
  // fit a palette, and that takes the image from about 30 to about 12 KB at no visible cost.
  // Worth it, because the image is rendered once and then served from the cache many times.
  // Flat colours need no dithering, and sharp's dithering smears streaks across some cards.
  const png = await sharp(rendered).png({ palette: true, quality: 90, effort: 4, dither: 0 }).toBuffer();
  const paletteMs = timer.lap();

  console.log(
    `og instance=${instance} call=${calls} age=${Math.round((Date.now() - loadedAt) / 1000)}s ` +
      `template=${cold ? `created in ${templateMs.toFixed(1)}ms` : "warm"} ` +
      `compile=${compileMs.toFixed(1)}ms export=${exportMs.toFixed(1)}ms ` +
      `palette=${paletteMs.toFixed(1)}ms size=${kb(rendered.length)}->${kb(png.length)}KB code=${code}`,
  );
  return new Response(png, {
    headers: {
      "content-type": "image/png",
      "cache-control": "public, max-age=31536000, immutable",
      "netlify-cdn-cache-control": "public, durable, max-age=31536000, immutable",
      // For scripts/bench-og.mjs
      "x-og-renderer": "node",
      "x-og-instance": instance,
      "x-og-call": String(calls),
      "x-og-boot": bootMs.toFixed(1),
      "server-timing": serverTiming({ template: templateMs, compile: compileMs, export: exportMs, palette: paletteMs }),
    },
  });
};

export const config = { path: "/og/*" };
