// The link preview of a shared puzzle. Exported as PNG at 2 pixels per point, which makes the
// 1200x630 image social networks ask for.
//
// Input `card`: { name, tagline, puzzle }, where `puzzle` is what
// netlify/shared/puzzle_code.ts reads out of a code.
#import "@preview/oicana:0.2.0": setup

#let read-project-file(path) = read(path, encoding: none)
#let (input, _, _) = setup(read-project-file)
#let card = input.card
#let puzzle = card.puzzle

// brain_games_lib/src/theme.rs
#let bg = rgb("#1b1715")
#let ink = rgb("#f2e8da")
#let dim = rgb("#a1907f")
#let terra = rgb("#d4834a")
#let sage = rgb("#93a373")
#let line-colour = rgb("#3b3229")

#set page(width: 600pt, height: 315pt, margin: 0pt, fill: bg)
#set text(font: "JetBrains Mono", fill: ink, size: 13pt)

#let board-size = 255pt
#let edge = puzzle.edge
// The aquarium's clues sit above and left of its board
#let clue-room = if puzzle.game == "aquarium" { 22pt } else { 0pt }
// Cells and the grid's corner sit on whole pixels, so every line falls on the pixel grid the
// same way. Otherwise a thin line that happens to land on a pixel's centre is drawn sharper
// and darker than the others.
#let pixel = 0.5pt
#let snap(length) = calc.floor(length / pixel) * pixel
#let cell = snap((board-size - clue-room) / edge)
// The space snapping leaves over, split around the grid
#let margin = snap((board-size - clue-room - edge * cell) / 2)
#let wall = 2.5pt

#let colour(row, column) = {
  if puzzle.game == "three_in_a_row" {
    (line-colour, terra, sage).at(puzzle.hints.at(row).at(column))
  } else if puzzle.game == "aquarium" {
    luma(85%)
  } else {
    // kings.rs spreads the regions evenly around the colour wheel
    let count = calc.max(..puzzle.regions.flatten()) + 1
    color.hsl(puzzle.regions.at(row).at(column) / count * 360deg, 60%, 75%)
  }
}

#let board = box(width: board-size, height: board-size, {
  let at(index) = clue-room + margin + index * cell
  for row in range(edge) {
    for column in range(edge) {
      place(dx: at(column), dy: at(row), rect(width: cell, height: cell, fill: colour(row, column), stroke: none))
    }
  }
  // Thin lines between all cells, walls where regions meet
  for row in range(edge) {
    for column in range(edge) {
      if column + 1 < edge {
        let walled = "regions" in puzzle and puzzle.regions.at(row).at(column) != puzzle.regions.at(row).at(column + 1)
        place(dx: at(column + 1), dy: at(row), line(
          angle: 90deg,
          length: cell,
          stroke: if walled { wall + bg } else { 0.5pt + bg.transparentize(65%) },
        ))
      }
      if row + 1 < edge {
        let walled = "regions" in puzzle and puzzle.regions.at(row).at(column) != puzzle.regions.at(row + 1).at(column)
        place(dx: at(column), dy: at(row + 1), line(
          length: cell,
          stroke: if walled { wall + bg } else { 0.5pt + bg.transparentize(65%) },
        ))
      }
    }
  }
  place(dx: at(0), dy: at(0), rect(width: edge * cell, height: edge * cell, stroke: wall + bg))
  if puzzle.game == "aquarium" {
    set text(font: "Silkscreen", size: 11pt)
    for (column, clue) in puzzle.columnClues.enumerate() {
      place(dx: at(column), dy: 0pt, box(width: cell, height: clue-room, align(center + horizon, str(clue))))
    }
    for (row, clue) in puzzle.rowClues.enumerate() {
      place(dx: 0pt, dy: at(row), box(width: clue-room, height: cell, align(center + horizon, str(clue))))
    }
  }
})

#place(dx: 30pt, dy: 30pt, block(width: 270pt, height: 255pt, {
  set par(leading: 0.6em)
  // The app's icon, ios-src/Assets.xcassets/AppIcon.appiconset/icon_180.png
  grid(
    columns: 2,
    column-gutter: 9pt,
    align: horizon,
    box(clip: true, radius: 5pt, image("icon.png", width: 24pt)),
    text(size: 14pt)[Brain Games],
  )
  v(8pt)
  // "Three in a Row" only fits on one line a size smaller
  text(font: "Silkscreen", weight: "bold", size: if card.name.len() > 10 { 23pt } else { 34pt }, card.name)
  v(2pt)
  text(fill: dim, size: 15pt)[#edge × #edge]
  v(10pt)
  text(fill: dim, card.tagline)
  v(12pt)
  v(1fr)
  // Text, not a button: the image itself can not be pressed, and whether tapping the preview
  // follows the link depends on where it is shown
  stack(
    spacing: 8pt,
    text(fill: terra, size: 14pt)[Solve it in the app →],
    text(fill: dim, size: 11pt)[braingames.nikl.me],
  )
}))

#place(dx: 315pt, dy: 30pt, board)
