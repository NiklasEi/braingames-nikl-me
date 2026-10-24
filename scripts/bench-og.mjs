#!/usr/bin/env node
// Measures what the preview image function costs, cold and warm: /og/<code>.png.
//
//   node scripts/bench-og.mjs [--site https://braingames.nikl.me] [--burst 8] [--warm 20] [--verbose]
//
// Every image is cached after its first request, so every request asks for a puzzle nobody
// asked for before: the script writes random puzzle codes of its own. A code only has to be
// readable, not solvable.
//
// Cold: a burst of parallel requests. Lambda runs one request per instance at a time, so most
// of a burst lands on fresh instances. Warm: one request after the other, which an instance
// that is already up takes. The function reports its instance and how many requests it has
// served (`x-og-call`), so each request is sorted by what it really met, not by the phase it
// was sent in. Instances stay up for a while, so run the script again after 15 minutes or so
// for more cold starts.

const args = parseArgs(process.argv.slice(2));
const site = (args.site ?? "https://braingames.nikl.me").replace(/\/$/, "");
const burst = Number(args.burst ?? 8);
const warm = Number(args.warm ?? 20);

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, "");
    parsed[key] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
  }
  return parsed;
}

// ---------------------------------------------------------------------------------------------
// Puzzle codes, written like brain_games_lib/src/puzzle/code.rs writes them

const GAMES = [
  { tag: 1, edges: [8, 10, 12, 14], write: writeThreeInARow },
  { tag: 2, edges: [6, 8, 10, 11, 12], write: writeRegions },
  { tag: 3, edges: [6, 8, 10, 12], write: (bits, edge) => (writeRegions(bits, edge), writeClues(bits, edge)) },
];

export function randomCode() {
  const game = GAMES[Math.floor(Math.random() * GAMES.length)];
  const edge = game.edges[Math.floor(Math.random() * game.edges.length)];
  const bits = new BitWriter();
  bits.write(edge, 8);
  game.write(bits, edge);
  const body = [(1 << 4) | game.tag, ...bits.finish()];
  return Buffer.from([...body, checksum(body)]).toString("base64url");
}

function writeThreeInARow(bits, edge) {
  for (let cell = 0; cell < edge * edge; cell++) {
    bits.write(Math.random() < 0.25 ? 1 + Math.floor(Math.random() * 2) : 0, 2);
  }
}

function writeRegions(bits, edge) {
  // Walls between horizontal neighbours, then between vertical ones
  for (let wall = 0; wall < 2 * edge * (edge - 1); wall++) {
    bits.write(Math.random() < 0.3 ? 1 : 0, 1);
  }
}

function writeClues(bits, edge) {
  for (let clue = 0; clue < 2 * edge; clue++) {
    bits.write(Math.floor(Math.random() * (edge + 1)), 4);
  }
}

class BitWriter {
  bytes = [];
  position = 0;

  write(value, width) {
    for (let bit = width - 1; bit >= 0; bit--) {
      if (this.position % 8 === 0) this.bytes.push(0);
      this.bytes[this.bytes.length - 1] |= ((value >> bit) & 1) << (7 - (this.position % 8));
      this.position++;
    }
  }

  finish() {
    return this.bytes;
  }
}

/** FNV-1a folded down to one byte */
function checksum(bytes) {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const folded = (hash ^ (hash >>> 16)) >>> 0;
  return (folded ^ (folded >>> 8)) & 0xff;
}

// ---------------------------------------------------------------------------------------------
// Requests

async function request(code) {
  const start = performance.now();
  const response = await fetch(`${site}/og/${code}.png`, { headers: { "cache-control": "no-cache" } });
  const firstByte = performance.now() - start;
  const body = await response.arrayBuffer();
  const total = performance.now() - start;
  const steps = Object.fromEntries(
    (response.headers.get("server-timing") ?? "")
      .split(",")
      .map((entry) => entry.trim().match(/^(\w+);dur=([\d.]+)$/))
      .filter(Boolean)
      .map(([, step, ms]) => [step, Number(ms)]),
  );
  const result = {
    code,
    status: response.status,
    bytes: body.byteLength,
    total,
    firstByte,
    instance: response.headers.get("x-og-instance"),
    call: Number(response.headers.get("x-og-call") ?? NaN),
    cache: response.headers.get("cache-status") ?? "",
    steps,
    render: Object.values(steps).length ? Object.values(steps).reduce((sum, ms) => sum + ms, 0) : NaN,
  };
  if (args.verbose) {
    console.log(
      `${result.status} call=${String(result.call).padEnd(3)} instance=${result.instance} ` +
        `total=${total.toFixed(0)}ms render=${ms1(result.render)} ` +
        `${Object.entries(steps).map(([s, ms]) => `${s}=${ms}`).join(" ")} ${result.cache}`,
    );
  }
  return result;
}

async function baseline() {
  // A static file from the CDN: what the network alone costs from here
  const times = [];
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    await (await fetch(`${site}/.well-known/assetlinks.json`)).arrayBuffer();
    times.push(performance.now() - start);
  }
  return median(times);
}

// ---------------------------------------------------------------------------------------------
// Report

function median(values) {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const ms = (value) => (Number.isFinite(value) ? `${value.toFixed(0)} ms` : "-");
const ms1 = (value) => (Number.isFinite(value) ? `${value.toFixed(1)} ms` : "-");

function summarise(results) {
  const failed = results.filter((result) => result.status !== 200);
  const ok = results.filter((result) => result.status === 200);
  const cached = ok.filter((result) => /hit/i.test(result.cache) && !/fwd=miss/i.test(result.cache));
  const fresh = ok.filter((result) => !cached.includes(result));
  const cold = fresh.filter((result) => result.call === 1);
  const warmed = fresh.filter((result) => result.call > 1);
  const unknown = fresh.filter((result) => !Number.isFinite(result.call));

  if (failed.length) {
    console.log(`${failed.length} requests failed (${[...new Set(failed.map((r) => r.status))].join(", ")})`);
  }
  if (cached.length) {
    console.log(`${cached.length} answers came from the cache and are left out`);
  }
  if (unknown.length) {
    console.log(`${unknown.length} answers without x-og-call, is the latest deploy live?`);
  }

  const step = (group, name) => median(group.map((result) => result.steps[name]).filter(Number.isFinite));
  const rows = [];
  for (const [kind, group] of [["cold", cold], ["warm", warmed], ["unknown", unknown]]) {
    if (group.length === 0) continue;
    rows.push({
      kind,
      n: group.length,
      "total (median)": ms(median(group.map((result) => result.total))),
      "first byte": ms(median(group.map((result) => result.firstByte))),
      render: ms1(median(group.map((result) => result.render).filter(Number.isFinite))),
      template: ms1(step(group, "template")),
      compile: ms1(step(group, "compile")),
      export: ms1(step(group, "export")),
      palette: ms1(step(group, "palette")),
    });
  }
  console.table(rows);

  const coldTotal = median(cold.map((result) => result.total));
  const warmTotal = median(warmed.map((result) => result.total));
  const instances = new Set(fresh.map((result) => result.instance).filter(Boolean)).size;
  console.log(`\nCold start cost (median total cold minus median total warm): ${ms(coldTotal - warmTotal)}`);
  console.log(`${instances} instances seen`);
}

// ---------------------------------------------------------------------------------------------

async function main() {
  console.log(`Measuring ${site}/og/: a burst of ${burst} parallel requests, then ${warm} in a row\n`);
  const network = await baseline();
  console.log(`Network round trip for a static file: ${ms(network)}\n`);

  const results = await Promise.all(Array.from({ length: burst }, () => request(randomCode())));
  for (let i = 0; i < warm; i++) {
    results.push(await request(randomCode()));
  }
  summarise(results);
}

// Imported for its codes, it only hands them out
if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
