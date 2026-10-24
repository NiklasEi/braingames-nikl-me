// deno test netlify/shared
import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { CodeError, readCode, type SharedPuzzle } from "./puzzle_code.ts";
import json from "./fixtures.json" with { type: "json" };

const fixtures = json as unknown as (SharedPuzzle & { code: string })[];

Deno.test("every code the app wrote reads back as the app's puzzle", () => {
  for (const { code, ...puzzle } of fixtures) {
    assertEquals(readCode(code), puzzle, code);
  }
});

Deno.test("a damaged code is told apart from one that needs a newer app", () => {
  const code = fixtures.find((fixture) => fixture.game === "kings")!.code;
  // The same letter changed to another one breaks the checksum
  const damaged = code.slice(0, 5) + (code[5] === "A" ? "B" : "A") + code.slice(6);
  const error = assertThrows(() => readCode(damaged), CodeError);
  assertEquals(error.needsNewerApp, false);

  assertThrows(() => readCode(""), CodeError, "ends in the middle");
  assertThrows(() => readCode("AAAA"), CodeError, "damaged");
  assertThrows(() => readCode(code + "!"), CodeError, "does not belong");
});

Deno.test("a version the app has not written yet asks for an update", () => {
  // Version 15 of game 2, an edge of 8, and the checksum that makes it look whole
  const bytes = [0xf2, 8];
  const error = assertThrows(() => readCode(encode([...bytes, checksum(bytes)])), CodeError);
  assertEquals(error.needsNewerApp, true);
});

function checksum(bytes: number[]): number {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const folded = (hash ^ (hash >>> 16)) >>> 0;
  return (folded ^ (folded >>> 8)) & 0xff;
}

function encode(bytes: number[]): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let code = "";
  let accumulator = 0;
  let bits = 0;
  for (const byte of bytes) {
    accumulator = ((accumulator << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      code += alphabet[(accumulator >> bits) & 0b111111];
    }
  }
  if (bits > 0) code += alphabet[(accumulator << (6 - bits)) & 0b111111];
  return code;
}
