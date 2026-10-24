//! Reads the puzzle codes of Brain Games links, step for step like `netlify/shared/puzzle_code.ts`
//! and with the same results: the tests hold both to `netlify/shared/fixtures.json`.

use serde::Serialize;

/// A puzzle as the card template reads it, in the JSON shape of the TypeScript `SharedPuzzle`
#[derive(Serialize, Debug, PartialEq)]
#[serde(tag = "game", rename_all = "snake_case")]
pub enum SharedPuzzle {
    ThreeInARow {
        edge: usize,
        /// 0 for an empty tile, 1 and 2 for the two colours the puzzle starts with
        hints: Vec<Vec<u32>>,
    },
    Kings {
        edge: usize,
        /// Region of each cell, numbered in the order the regions first show up row by row
        regions: Vec<Vec<u32>>,
    },
    Aquarium {
        edge: usize,
        regions: Vec<Vec<u32>>,
        #[serde(rename = "rowClues")]
        row_clues: Vec<u32>,
        #[serde(rename = "columnClues")]
        column_clues: Vec<u32>,
    },
}

/// Why a code could not be read. Every such code gets a 404, so the reason is only logged.
#[derive(Debug, PartialEq)]
pub struct CodeError(pub String);

const READABLE_VERSIONS: [u8; 1] = [1];
const THREE_IN_A_ROW_EDGES: [usize; 4] = [8, 10, 12, 14];
const KINGS_EDGES: [usize; 5] = [6, 8, 10, 11, 12];
const AQUARIUM_EDGES: [usize; 4] = [6, 8, 10, 12];
const CLUE_BITS: u32 = 4;

fn error<T>(message: impl Into<String>) -> Result<T, CodeError> {
    Err(CodeError(message.into()))
}

pub fn read_code(code: &str) -> Result<SharedPuzzle, CodeError> {
    let bytes = decode_base64url(code)?;
    // A header byte, a checksum, and at least the board size between them
    if bytes.len() < 3 {
        return error("the puzzle code ends in the middle of the puzzle");
    }
    let (body, sum) = bytes.split_at(bytes.len() - 1);
    if checksum(body) != sum[0] {
        return error("the puzzle code is damaged");
    }

    let version = body[0] >> 4;
    if !READABLE_VERSIONS.contains(&version) {
        return error(format!("puzzle codes of version {version} need a newer version of the app"));
    }
    let mut reader = BitReader::new(&body[1..]);
    match body[0] & 0b1111 {
        1 => read_three_in_a_row(&mut reader),
        2 => read_kings(&mut reader),
        3 => read_aquarium(&mut reader),
        _ => error("the game this puzzle belongs to needs a newer version of the app"),
    }
}

fn read_edge(reader: &mut BitReader, edges: &[usize]) -> Result<usize, CodeError> {
    let edge = reader.read(8)? as usize;
    if !edges.contains(&edge) {
        return error(format!("boards of {edge} cells need a newer version of the app"));
    }
    Ok(edge)
}

fn read_three_in_a_row(reader: &mut BitReader) -> Result<SharedPuzzle, CodeError> {
    let edge = read_edge(reader, &THREE_IN_A_ROW_EDGES)?;
    let hints = grid(edge, || {
        let hint = reader.read(2)?;
        if hint > 2 {
            return error(format!("{hint} is not a value a cell can hold"));
        }
        Ok(hint)
    })?;
    reader.expect_end()?;
    Ok(SharedPuzzle::ThreeInARow { edge, hints })
}

fn read_kings(reader: &mut BitReader) -> Result<SharedPuzzle, CodeError> {
    let edge = read_edge(reader, &KINGS_EDGES)?;
    let regions = read_regions(reader, edge)?;
    reader.expect_end()?;
    Ok(SharedPuzzle::Kings { edge, regions })
}

fn read_aquarium(reader: &mut BitReader) -> Result<SharedPuzzle, CodeError> {
    let edge = read_edge(reader, &AQUARIUM_EDGES)?;
    let regions = read_regions(reader, edge)?;
    let mut clues = || {
        (0..edge)
            .map(|_| {
                let clue = reader.read(CLUE_BITS)?;
                if clue as usize > edge {
                    return error(format!("{clue} is not a value a cell can hold"));
                }
                Ok(clue)
            })
            .collect::<Result<Vec<_>, _>>()
    };
    let row_clues = clues()?;
    let column_clues = clues()?;
    reader.expect_end()?;
    Ok(SharedPuzzle::Aquarium {
        edge,
        regions,
        row_clues,
        column_clues,
    })
}

/// A region layout travels as its walls: first one bit for every pair of horizontal
/// neighbours, then one for every pair of vertical ones, set where a border runs between them.
/// The regions are numbered in the order their first cell shows up reading row by row.
fn read_regions(reader: &mut BitReader, edge: usize) -> Result<Vec<Vec<u32>>, CodeError> {
    let mut wall_right = vec![vec![false; edge - 1]; edge];
    for row in &mut wall_right {
        for wall in row {
            *wall = reader.read(1)? == 1;
        }
    }
    let mut wall_below = vec![vec![false; edge]; edge - 1];
    for row in &mut wall_below {
        for wall in row {
            *wall = reader.read(1)? == 1;
        }
    }

    let mut regions = vec![vec![None; edge]; edge];
    let mut next_id = 0;
    for row in 0..edge {
        for column in 0..edge {
            if regions[row][column].is_some() {
                continue;
            }
            regions[row][column] = Some(next_id);
            let mut open = vec![(row, column)];
            while let Some((r, c)) = open.pop() {
                let mut neighbours = Vec::with_capacity(4);
                if c + 1 < edge && !wall_right[r][c] {
                    neighbours.push((r, c + 1));
                }
                if c > 0 && !wall_right[r][c - 1] {
                    neighbours.push((r, c - 1));
                }
                if r + 1 < edge && !wall_below[r][c] {
                    neighbours.push((r + 1, c));
                }
                if r > 0 && !wall_below[r - 1][c] {
                    neighbours.push((r - 1, c));
                }
                for (nr, nc) in neighbours {
                    if regions[nr][nc].is_none() {
                        regions[nr][nc] = Some(next_id);
                        open.push((nr, nc));
                    }
                }
            }
            next_id += 1;
        }
    }
    Ok(regions
        .into_iter()
        .map(|row| row.into_iter().map(|region| region.unwrap_or_default()).collect())
        .collect())
}

fn grid(
    edge: usize,
    mut cell: impl FnMut() -> Result<u32, CodeError>,
) -> Result<Vec<Vec<u32>>, CodeError> {
    (0..edge)
        .map(|_| (0..edge).map(|_| cell()).collect())
        .collect()
}

/// FNV-1a folded down to one byte, against links cut short in transit
fn checksum(bytes: &[u8]) -> u8 {
    let mut hash: u32 = 0x811c9dc5;
    for byte in bytes {
        hash ^= u32::from(*byte);
        hash = hash.wrapping_mul(0x01000193);
    }
    let folded = hash ^ (hash >> 16);
    (folded ^ (folded >> 8)) as u8
}

const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

fn decode_base64url(code: &str) -> Result<Vec<u8>, CodeError> {
    let mut bytes = Vec::with_capacity(code.len() * 3 / 4);
    let mut accumulator: u32 = 0;
    let mut bits = 0;
    for character in code.chars() {
        let Some(value) = ALPHABET.iter().position(|&c| char::from(c) == character) else {
            return error(format!("'{character}' does not belong in a puzzle code"));
        };
        // Only the bits still waiting for a byte matter, the rest has been read already
        accumulator = ((accumulator << 6) | value as u32) & 0xffff;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            bytes.push((accumulator >> bits) as u8);
        }
    }
    if accumulator & ((1 << bits) - 1) != 0 {
        return error("the puzzle code ends in bits that are not part of it");
    }
    Ok(bytes)
}

/// Reads values of any width packed back to back, most significant bit first
struct BitReader<'a> {
    bytes: &'a [u8],
    position: usize,
}

impl<'a> BitReader<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, position: 0 }
    }

    fn read(&mut self, bits: u32) -> Result<u32, CodeError> {
        let mut value = 0;
        for _ in 0..bits {
            let Some(byte) = self.bytes.get(self.position >> 3) else {
                return error("the puzzle code ends in the middle of the puzzle");
            };
            value = (value << 1) | u32::from((byte >> (7 - (self.position & 7))) & 1);
            self.position += 1;
        }
        Ok(value)
    }

    fn expect_end(&self) -> Result<(), CodeError> {
        let left_over = self.bytes.len() - self.position.div_ceil(8);
        if left_over != 0 {
            return error(format!(
                "the puzzle code carries {left_over} bytes the puzzle has no use for"
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Codes the app wrote, with what they read back as
    const FIXTURES: &str = include_str!("../../../shared/fixtures.json");

    #[test]
    fn every_fixture_reads_like_the_app_wrote_it() {
        let fixtures: Vec<serde_json::Value> = serde_json::from_str(FIXTURES).unwrap();
        assert!(!fixtures.is_empty());
        for mut fixture in fixtures {
            let code = fixture["code"].as_str().unwrap().to_owned();
            fixture.as_object_mut().unwrap().remove("code");
            let puzzle = read_code(&code).unwrap_or_else(|error| panic!("{code}: {error:?}"));
            assert_eq!(serde_json::to_value(&puzzle).unwrap(), fixture, "{code}");
        }
    }

    #[test]
    fn a_damaged_code_is_no_puzzle() {
        let fixtures: Vec<serde_json::Value> = serde_json::from_str(FIXTURES).unwrap();
        let code = fixtures[0]["code"].as_str().unwrap();
        let mut damaged: Vec<char> = code.chars().collect();
        damaged[3] = if damaged[3] == 'A' { 'B' } else { 'A' };
        let damaged: String = damaged.into_iter().collect();
        assert!(read_code(&damaged).is_err());
        assert!(read_code(&code[..code.len() - 2]).is_err());
        assert!(read_code("not a code!").is_err());
    }
}
