// The page a puzzle link lands on when the app does not take it: a phone without the app,
// a desktop, or a crawler building a link preview. Everything a crawler needs is in the HTML,
// none of them run scripts.
import { CodeError, readCode } from "./puzzle_code.ts";
import { GAMES, PALETTE, puzzleSvg } from "./render.ts";

export const PLAY_STORE = "https://play.google.com/store/apps/details?id=me.nikl.braingames";
export const APP_STORE = "https://apps.apple.com/app/brain-games-logic-puzzles/id6452756305";
const APP_STORE_ID = "6452756305";

export interface Page {
  status: number;
  html: string;
}

export function puzzlePage(code: string, origin: string): Page {
  const link = `${origin}/p/${code}`;
  try {
    const puzzle = readCode(code);
    const game = GAMES[puzzle.game];
    const title = `${game.name} ${puzzle.edge}×${puzzle.edge} · Brain Games`;
    const description = `${game.tagline}. Someone shared this puzzle with you, solve it in Brain Games.`;
    // Android hands this to the app when it is installed, and to the Play Store otherwise
    const intent = `intent://p/${code}#Intent;scheme=braingames;package=me.nikl.braingames;S.browser_fallback_url=${
      encodeURIComponent(PLAY_STORE)
    };end`;
    return {
      status: 200,
      html: layout({
        title,
        description,
        link,
        image: `${origin}/og/${code}.png`,
        // Safari offers to open the link in the app, or to get it
        head: `<meta name="apple-itunes-app" content="app-id=${APP_STORE_ID}, app-argument=${link}">`,
        body: `
<p class="eyebrow">A shared puzzle</p>
<h1>${game.name} <span>${puzzle.edge} × ${puzzle.edge}</span></h1>
<p class="tagline">${game.tagline}</p>
<figure>${puzzleSvg(puzzle)}</figure>
<a class="button primary android" href="${intent}">Open in the app</a>
${stores()}`,
      }),
    };
  } catch (error) {
    if (!(error instanceof CodeError)) throw error;
    const message = error.needsNewerApp
      ? "This puzzle is from a newer version of Brain Games. Update the app to play it."
      : "This puzzle link is damaged. Maybe it was cut short on its way to you?";
    return {
      status: error.needsNewerApp ? 200 : 404,
      html: layout({
        title: "Brain Games",
        description: "Endless logic puzzles, solvable by deduction.",
        link,
        head: "",
        body: `
<h1>Brain Games</h1>
<p class="tagline">${message}</p>
${stores()}`,
      }),
    };
  }
}

function stores(): string {
  return `
<p class="get">Get Brain Games</p>
<div class="stores">
  <a class="button" href="${APP_STORE}">App Store</a>
  <a class="button" href="${PLAY_STORE}">Google Play</a>
</div>`;
}

function layout(page: {
  title: string;
  description: string;
  link: string;
  /** Without one, the preview is a plain text card */
  image?: string;
  head: string;
  body: string;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${page.title}</title>
<meta name="description" content="${page.description}">
<link rel="canonical" href="${page.link}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Brain Games">
<meta property="og:title" content="${page.title}">
<meta property="og:description" content="${page.description}">
<meta property="og:url" content="${page.link}">
${
    page.image
      ? `<meta property="og:image" content="${page.image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">`
      : `<meta name="twitter:card" content="summary">`
  }
${page.head}
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; justify-content: center;
    background: ${PALETTE.bg}; color: ${PALETTE.ink};
    font: 16px/1.5 "JetBrains Mono", ui-monospace, monospace;
  }
  main { width: 100%; max-width: 30rem; padding: 2.5rem 1rem; text-align: center; }
  .eyebrow, .get { color: ${PALETTE.dim}; text-transform: uppercase; letter-spacing: .12em; font-size: .75rem; margin: 0; }
  h1 { margin: .4rem 0 0; font-size: 2rem; letter-spacing: .04em; }
  h1 span { color: ${PALETTE.dim}; font-size: 1rem; font-weight: normal; }
  .tagline { color: ${PALETTE.dim}; margin: .3rem 0 1.5rem; }
  figure { margin: 0 0 1.5rem; }
  figure svg { width: 100%; height: auto; border-radius: 6px; }
  .button {
    display: block; padding: .8rem 1rem; border-radius: 6px; text-decoration: none;
    border: 2px solid ${PALETTE.line}; color: ${PALETTE.ink}; background: ${PALETTE.surface};
  }
  .button.primary { background: ${PALETTE.terra}; border-color: ${PALETTE.terra}; color: ${PALETTE.bg}; font-weight: bold; margin-bottom: 2rem; }
  /* Only Android can hand a link to an app that may or may not be installed */
  .android { display: none; }
  .is-android .android { display: block; }
  .stores { display: flex; gap: .75rem; margin-top: .6rem; }
  .stores .button { flex: 1; }
</style>
</head>
<body>
<main>${page.body}
</main>
<script>if (/android/i.test(navigator.userAgent)) document.body.classList.add("is-android");</script>
</body>
</html>`;
}
