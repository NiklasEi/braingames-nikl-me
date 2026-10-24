// Reads the puzzle codes of Brain Games links.
//
// The app writes them, in brain_games_lib/src/puzzle/code.rs, and this follows that file step
// by step. A code is base64url without padding, of: one header byte (format version in the
// high nibble, game in the low one), the puzzle's definition packed into bits, and a checksum
// byte. `fixtures.json` holds codes the app wrote together with what they have to read back
// as; regenerate it with `cargo run --example share_link -p brain_games_lib -- --fixtures`.

export type Game = "three_in_a_row" | "kings" | "aquarium";

export type SharedPuzzle =
  | {
    game: "three_in_a_row";
    edge: number;
    /** 0 for an empty tile, 1 and 2 for the two colours the puzzle starts with */
    hints: number[][];
  }
  | {
    game: "kings";
    edge: number;
    /** Region of each cell, numbered in the order the regions first show up row by row */
    regions: number[][];
  }
  | {
    game: "aquarium";
    edge: number;
    regions: number[][];
    /** How many cells of each row hold water, top to bottom */
    rowClues: number[];
    /** How many cells of each column hold water, left to right */
    columnClues: number[];
  };

/** Why a code could not be read. The messages are the app's, aimed at a player. */
export class CodeError extends Error {
  /** The code was whole, but says something only a newer app understands */
  readonly needsNewerApp: boolean;

  constructor(message: string, needsNewerApp = false) {
    super(message);
    this.needsNewerApp = needsNewerApp;
  }
}

/** Every version the app has ever written. A link is forever, so this only grows. */
const READABLE_VERSIONS = [1];
const THREE_IN_A_ROW_EDGES = [8, 10, 12, 14];
const KINGS_EDGES = [6, 8, 10, 11, 12];
const AQUARIUM_EDGES = [6, 8, 10, 12];
const CLUE_BITS = 4;

const GAME_TAGS: Record<number, Game> = { 1: "three_in_a_row", 2: "kings", 3: "aquarium" };

export function readCode(code: string): SharedPuzzle {
  const bytes = decodeBase64url(code);
  // A header byte, a checksum, and at least the board size between them
  if (bytes.length < 3) {
    throw new CodeError("the puzzle code ends in the middle of the puzzle");
  }
  const body = bytes.subarray(0, bytes.length - 1);
  if (checksum(body) !== bytes[bytes.length - 1]) {
    throw new CodeError("the puzzle code is damaged");
  }

  const version = body[0] >> 4;
  if (!READABLE_VERSIONS.includes(version)) {
    throw new CodeError(`puzzle codes of version ${version} need a newer version of the app`, true);
  }
  const tag = body[0] & 0b1111;
  const game = GAME_TAGS[tag];
  if (game === undefined) {
    throw new CodeError("the game this puzzle belongs to needs a newer version of the app", true);
  }

  const reader = new BitReader(body.subarray(1));
  switch (game) {
    case "three_in_a_row":
      return readThreeInARow(reader);
    case "kings":
      return readKings(reader);
    case "aquarium":
      return readAquarium(reader);
  }
}

function readEdge(reader: BitReader, edges: number[]): number {
  const edge = reader.read(8);
  if (!edges.includes(edge)) {
    throw new CodeError(`boards of ${edge} cells need a newer version of the app`, true);
  }
  return edge;
}

function readThreeInARow(reader: BitReader): SharedPuzzle {
  const edge = readEdge(reader, THREE_IN_A_ROW_EDGES);
  const hints = grid(edge, () => {
    const hint = reader.read(2);
    if (hint > 2) {
      throw new CodeError(`${hint} is not a value a cell can hold`);
    }
    return hint;
  });
  reader.expectEnd();
  return { game: "three_in_a_row", edge, hints };
}

function readKings(reader: BitReader): SharedPuzzle {
  const edge = readEdge(reader, KINGS_EDGES);
  const regions = readRegions(reader, edge);
  reader.expectEnd();
  return { game: "kings", edge, regions };
}

function readAquarium(reader: BitReader): SharedPuzzle {
  const edge = readEdge(reader, AQUARIUM_EDGES);
  const regions = readRegions(reader, edge);
  const clues = () =>
    Array.from({ length: edge }, () => {
      const clue = reader.read(CLUE_BITS);
      if (clue > edge) {
        throw new CodeError(`${clue} is not a value a cell can hold`);
      }
      return clue;
    });
  const rowClues = clues();
  const columnClues = clues();
  reader.expectEnd();
  return { game: "aquarium", edge, regions, rowClues, columnClues };
}

/**
 * A region layout travels as its walls: first one bit for every pair of horizontal
 * neighbours, then one for every pair of vertical ones, set where a border runs between them.
 * The regions are numbered in the order their first cell shows up reading row by row.
 */
function readRegions(reader: BitReader, edge: number): number[][] {
  const wallRight = Array.from({ length: edge }, () =>
    Array.from({ length: edge - 1 }, () => reader.read(1) === 1));
  const wallBelow = Array.from({ length: edge - 1 }, () =>
    Array.from({ length: edge }, () => reader.read(1) === 1));

  const regions = grid(edge, () => -1);
  let nextId = 0;
  for (let row = 0; row < edge; row++) {
    for (let column = 0; column < edge; column++) {
      if (regions[row][column] !== -1) {
        continue;
      }
      regions[row][column] = nextId;
      const open: [number, number][] = [[row, column]];
      while (open.length > 0) {
        const [r, c] = open.pop()!;
        const neighbours: [number, number][] = [];
        if (c + 1 < edge && !wallRight[r][c]) neighbours.push([r, c + 1]);
        if (c > 0 && !wallRight[r][c - 1]) neighbours.push([r, c - 1]);
        if (r + 1 < edge && !wallBelow[r][c]) neighbours.push([r + 1, c]);
        if (r > 0 && !wallBelow[r - 1][c]) neighbours.push([r - 1, c]);
        for (const [nr, nc] of neighbours) {
          if (regions[nr][nc] === -1) {
            regions[nr][nc] = nextId;
            open.push([nr, nc]);
          }
        }
      }
      nextId++;
    }
  }
  return regions;
}

function grid(edge: number, cell: () => number): number[][] {
  return Array.from({ length: edge }, () => Array.from({ length: edge }, cell));
}

/** FNV-1a folded down to one byte, against links cut short in transit */
function checksum(bytes: Uint8Array): number {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const folded = (hash ^ (hash >>> 16)) >>> 0;
  return (folded ^ (folded >>> 8)) & 0xff;
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function decodeBase64url(code: string): Uint8Array {
  const bytes: number[] = [];
  let accumulator = 0;
  let bits = 0;
  for (const character of code) {
    const value = ALPHABET.indexOf(character);
    if (value === -1) {
      throw new CodeError(`'${character}' does not belong in a puzzle code`);
    }
    // Only the bits still waiting for a byte matter, the rest has been read already
    accumulator = ((accumulator << 6) | value) & 0xffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >> bits) & 0xff);
    }
  }
  if ((accumulator & ((1 << bits) - 1)) !== 0) {
    throw new CodeError("the puzzle code ends in bits that are not part of it");
  }
  return Uint8Array.from(bytes);
}

/** Reads values of any width packed back to back, most significant bit first */
class BitReader {
  private position = 0;
  // A plain field rather than a parameter property, which Node can not strip from TypeScript
  private readonly bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  read(bits: number): number {
    let value = 0;
    for (let i = 0; i < bits; i++) {
      const byte = this.bytes[this.position >> 3];
      if (byte === undefined) {
        throw new CodeError("the puzzle code ends in the middle of the puzzle");
      }
      value = (value << 1) | ((byte >> (7 - (this.position & 7))) & 1);
      this.position++;
    }
    return value;
  }

  expectEnd(): void {
    const leftOver = this.bytes.length - Math.ceil(this.position / 8);
    if (leftOver !== 0) {
      throw new CodeError(`the puzzle code carries ${leftOver} bytes the puzzle has no use for`);
    }
  }
}
