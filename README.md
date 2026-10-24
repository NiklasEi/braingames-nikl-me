# braingames.nikl.me

The website of Brain Games, deployed by Netlify.

## Puzzle links

The app shares puzzles as `https://braingames.nikl.me/p/<code>`. A phone with the app opens
the link in the app. Everyone else lands on a page that shows the puzzle and where to get the
app.

| Path | Served by | What it is |
|---|---|---|
| `/p/<code>` | `netlify/edge-functions/puzzle.ts` | Page with the puzzle, store links and link preview tags |
| `/og/<code>.png` | `netlify/functions/og` (Rust) | Link preview image, rendered from `og/puzzle_card` with Oicana |
| `/.well-known/assetlinks.json` | static | Lets the Android app open `/p/` links |
| `/.well-known/apple-app-site-association` | static | Lets the iOS app open `/p/` links |

A code always reads the same, so both functions answer with Netlify's durable cache: the
first request for a code renders the page or image, every later one is served from the cache
until the next deploy.

The codes are read twice: by `netlify/shared/puzzle_code.ts` for the page and by
`netlify/functions/og/src/puzzle_code.rs` for the image. The app writes them, in
`brain_games_lib/src/puzzle/code.rs`, and all three have to agree for as long as links are out
there. `netlify/shared/fixtures.json` holds codes the app wrote and what they read back as, and
the tests of both readers check against it. After a change to the format on the app's side,
regenerate it from the app's repository:

```sh
cargo run --example share_link -p brain_games_lib -- --fixtures > ../braingames-nikl-me/netlify/shared/fixtures.json
```

## Working on it

```sh
npm test                                   # deno test netlify/shared
(cd netlify/functions/og && cargo test)    # decodes every fixture and renders it
```

The preview image is an Oicana template. Compile it on its own with
`oicana compile og/puzzle_card -f png`, and pack it after a change with `npm run pack-og`. The
packed zip in `og/dist` is compiled into the function, so pack before a deploy that changes
the template.

## The preview image function

`netlify/functions/og` is a Rust function: Oicana's Rust crate renders the card, libimagequant
turns it into a palette PNG of about 10 KB. It started out next to a Node function doing the
same with `@oicana/node` and sharp. Both rendered warm in about the same time, the work being
the same native code either way, but the Rust function started about 0.8 s faster cold, and
most renders are cold: each image is rendered once and then cached.

Netlify builds Rust functions only with `NETLIFY_EXPERIMENTAL_BUILD_RUST_SOURCE=true` set in
the site's environment variables (Site configuration > Environment variables). Setting it in
`netlify.toml` does not work: the bundler reads it before that file applies, and quietly
leaves the function out, which leaves `/og/` without an image. Netlify compiles the function
for `x86_64-unknown-linux-musl` on every deploy, which adds a minute or two. A classic
function like this one only answers under `/.netlify/functions/`, so a rewrite in
`netlify.toml` hands it the code from `/og/<code>.png`.

`.cargo/config.toml` builds the little C in it (mimalloc, and some assembly in `psm`) with the
system gcc, so the build image needs no musl cross compiler. mimalloc replaces musl's
allocator, which is slow under the many small allocations Typst makes.

```sh
# Builds what Netlify would deploy into .netlify/functions/
NETLIFY_EXPERIMENTAL_BUILD_RUST_SOURCE=true npx netlify build --offline
```

To measure the function as deployed:

```sh
npm run bench-og                          # 8 parallel requests, then 20 in a row
npm run bench-og -- --burst 16 --warm 40 --verbose
```

It asks for random puzzles nobody asked for before, so the cache never answers. A burst
lands mostly on new instances, requests one after the other on warm ones. The function says
which instance answered and how many requests it has served (`x-og-instance`, `x-og-call`) and
how long each step took (`server-timing`), so the script sorts every answer into cold or warm
by what it met. Instances stay up for a while after a run, so give it 15 minutes or more
before the next one for fresh cold starts.

libimagequant is GPL-3.0. That is fine for a function only Netlify runs, but keep it in mind
before shipping that code anywhere else.

## Before the first deploy

`public/.well-known/assetlinks.json` lists the SHA-256 fingerprints of the certificates the
Android app is signed with. The one that matters is Play's app signing key: copy it from the
Play Console (Test and release > Setup > App signing) over the placeholder. The second
fingerprint is the local debug key, so debug builds can be checked too.
