// Draws the starting position of a shared puzzle as SVG, in the colours the app uses.
import type { SharedPuzzle } from "./puzzle_code.ts";

/** brain_games_lib/src/theme.rs */
export const PALETTE = {
  bg: "#1b1715",
  surface: "#26201b",
  sunken: "#221d19",
  line: "#3b3229",
  ink: "#f2e8da",
  dim: "#a1907f",
  terra: "#d4834a",
  sage: "#93a373",
  water: "#5b93a3",
  cream: "#e8dcc8",
  shadedBox: "#332b24",
};

/** How each game is introduced in the app's menu */
export const GAMES = {
  three_in_a_row: { name: "Three in a Row", tagline: "Two is company, three is a crowd" },
  kings: { name: "Kings", tagline: "Crown one king per row, column and region" },
  aquarium: { name: "Aquarium", tagline: "Fill tanks until every water count is met" },
  sudoku: { name: "Sudoku", tagline: "Every digit once per row, column and box" },
};

const CELL = 40;
const WALL = 4;
/** Room for the aquarium's clues above and left of the board */
const CLUES = 34;

export function puzzleSvg(puzzle: SharedPuzzle): string {
  const offset = puzzle.game === "aquarium" ? CLUES : 0;
  const board = puzzle.edge * CELL;
  const size = board + offset + WALL;
  const parts: string[] = [];
  const at = (index: number) => offset + WALL / 2 + index * CELL;

  for (let row = 0; row < puzzle.edge; row++) {
    for (let column = 0; column < puzzle.edge; column++) {
      parts.push(
        `<rect x="${at(column)}" y="${at(row)}" width="${CELL}" height="${CELL}" fill="${
          cellColour(puzzle, row, column)
        }"/>`,
      );
    }
  }

  // Thin lines between all cells, thick ones where regions meet
  const thin: string[] = [];
  const thick: string[] = [];
  const regions = "regions" in puzzle
    ? puzzle.regions
    : puzzle.game === "sudoku"
    ? sudokuBoxes(puzzle.edge)
    : undefined;
  for (let row = 0; row < puzzle.edge; row++) {
    for (let column = 0; column < puzzle.edge; column++) {
      if (column + 1 < puzzle.edge) {
        const line = `M${at(column + 1)} ${at(row)}v${CELL}`;
        (regions && regions[row][column] !== regions[row][column + 1] ? thick : thin).push(line);
      }
      if (row + 1 < puzzle.edge) {
        const line = `M${at(column)} ${at(row + 1)}h${CELL}`;
        (regions && regions[row][column] !== regions[row + 1][column] ? thick : thin).push(line);
      }
    }
  }
  parts.push(`<path d="${thin.join("")}" stroke="${PALETTE.bg}" stroke-opacity="0.35" stroke-width="1"/>`);
  parts.push(`<path d="${thick.join("")}" stroke="${PALETTE.bg}" stroke-width="${WALL}" stroke-linecap="square"/>`);
  parts.push(
    `<rect x="${at(0)}" y="${at(0)}" width="${board}" height="${board}" fill="none" stroke="${PALETTE.bg}" stroke-width="${WALL}"/>`,
  );

  if (puzzle.game === "aquarium") {
    const clue = (x: number, y: number, value: number) =>
      `<text x="${x}" y="${y}" fill="${PALETTE.ink}" font-family="Silkscreen, monospace" font-size="22" text-anchor="middle" dominant-baseline="central">${value}</text>`;
    puzzle.columnClues.forEach((value, column) =>
      parts.push(clue(at(column) + CELL / 2, CLUES / 2, value))
    );
    puzzle.rowClues.forEach((value, row) => parts.push(clue(CLUES / 2, at(row) + CELL / 2, value)));
  }

  if (puzzle.game === "sudoku") {
    puzzle.givens.forEach((digits, row) =>
      digits.forEach((digit, column) => {
        if (digit !== 0) {
          parts.push(
            `<text x="${at(column) + CELL / 2}" y="${
              at(row) + CELL / 2
            }" fill="${PALETTE.ink}" font-family="Silkscreen, monospace" font-size="22" text-anchor="middle" dominant-baseline="central">${digit}</text>`,
          );
        }
      })
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="The puzzle's starting position">${
    parts.join("")
  }</svg>`;
}

function cellColour(puzzle: SharedPuzzle, row: number, column: number): string {
  switch (puzzle.game) {
    case "three_in_a_row":
      return [PALETTE.line, PALETTE.terra, PALETTE.sage][puzzle.hints[row][column]];
    case "aquarium":
      return "#d9d9d9";
    case "kings": {
      // kings.rs spreads the regions evenly around the colour wheel
      const count = Math.max(...puzzle.regions.flat()) + 1;
      return `hsl(${(puzzle.regions[row][column] / count) * 360} 60% 75%)`;
    }
    case "sudoku": {
      const box = Math.sqrt(puzzle.edge);
      const shaded = (Math.floor(row / box) + Math.floor(column / box)) % 2 === 0;
      return shaded ? PALETTE.shadedBox : PALETTE.surface;
    }
  }
}

function sudokuBoxes(edge: number): number[][] {
  const box = Math.sqrt(edge);
  return Array.from({ length: edge }, (_, row) =>
    Array.from({ length: edge }, (_, column) =>
      Math.floor(row / box) * box + Math.floor(column / box)));
}
