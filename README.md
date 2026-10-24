# braingames.nikl.me

The website of Brain Games, deployed by Netlify.

## Puzzle links

The app shares puzzles as `https://braingames.nikl.me/p/<code>`. A phone with the app opens
the link in the app. Everyone else lands on a page that shows the puzzle and where to get the
app.

| Path | Served by | What it is |
|---|---|---|
| `/p/<code>` | `netlify/edge-functions/puzzle.ts` | Page with the puzzle, store links and link preview tags |
| `/og/<code>.png` | `netlify/functions/og.mts` | Link preview image, rendered from `og/puzzle_card` with Oicana |
| `/og-rust/<code>.png` | `netlify/functions/og-rust` | The same image from a Rust function, to compare the two |
| `/.well-known/assetlinks.json` | static | Lets the Android app open `/p/` links |
| `/.well-known/apple-app-site-association` | static | Lets the iOS app open `/p/` links |

A code always reads the same, so both functions answer with Netlify's durable cache: the
first request for a code renders the page or image, every later one is served from the cache
until the next deploy.

`netlify/shared/puzzle_code.ts` reads the codes. The app writes them, in
`brain_games_lib/src/puzzle/code.rs`, and the two have to agree for as long as links are out
there. `netlify/shared/fixtures.json` holds codes the app wrote and what they read back as.
After a change to the format on the app's side, regenerate it from the app's repository:

```sh
cargo run --example share_link -p brain_games_lib -- --fixtures > ../braingames-nikl-me/netlify/shared/fixtures.json
```

## Working on it

```sh
npm install
npm test            # deno test netlify/shared
```

The preview image is an Oicana template. Compile it on its own with
`oicana compile og/puzzle_card -f png`, and pack it after a change with `npm run pack-og`. The
packed zip in `og/dist` is what the function loads.

## Node or Rust

The link previews point at the Node function. `netlify/functions/og-rust` renders the same
cards with Oicana's Rust crate, step for step like `og.mts`: same template, same palette
compression (libimagequant, which sharp uses too), same cache headers and the same log line,
prefixed `og-rust` instead of `og`. To compare them:

```sh
npm run bench-og                      # 8 parallel requests per function, then 20 in a row
npm run bench-og -- --burst 16 --warm 40 --verbose
```

It asks for random puzzles nobody asked for before, so the cache never answers. A burst
lands mostly on new instances, requests one after the other on warm ones. Both functions say
which instance answered and how many requests it has served (`x-og-instance`, `x-og-call`)
and how long each step took (`server-timing`), so the script sorts every answer into cold or
warm by what it met and prints the medians side by side. Instances stay up for a while after
a run, so give it 15 minutes or more before the next one for fresh cold starts.

Netlify builds Rust functions only with `NETLIFY_EXPERIMENTAL_BUILD_RUST_SOURCE=true` set in
the site's environment variables (Site configuration > Environment variables). Setting it in
`netlify.toml` does not work: the bundler reads it before that file applies, and quietly
leaves the function out. It compiles the function for `x86_64-unknown-linux-musl` on every
deploy, which takes a few minutes. The template is compiled into
the binary, so run `npm run pack-og` before a deploy that changes it, as for Node.

```sh
(cd netlify/functions/og-rust && cargo test)   # decodes every fixture and renders it
# Builds what Netlify would deploy into .netlify/functions/, Rust function included
NETLIFY_EXPERIMENTAL_BUILD_RUST_SOURCE=true npx netlify build --offline
```

libimagequant is GPL-3.0. That is fine for a function only Netlify runs, but keep it in mind
before shipping that code anywhere else.

## Before the first deploy

`public/.well-known/assetlinks.json` lists the SHA-256 fingerprints of the certificates the
Android app is signed with. The one that matters is Play's app signing key: copy it from the
Play Console (Test and release > Setup > App signing) over the placeholder. The second
fingerprint is the local debug key, so debug builds can be checked too.
