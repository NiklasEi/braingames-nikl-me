mod puzzle_code;

use std::collections::HashMap;
use std::io::Cursor;
use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use lambda_runtime::{Error, LambdaEvent, service_fn};
use oicana::Template;
use oicana::export::png::export_png;
use oicana::files::packed::PackedTemplate;
use oicana::input::{CompilationConfig, JsonInput, TemplateInputs};
use serde::{Deserialize, Serialize};

use crate::puzzle_code::{SharedPuzzle, read_code};

#[cfg(feature = "mimalloc")]
#[global_allocator]
static ALLOCATOR: mimalloc::MiMalloc = mimalloc::MiMalloc;

static TEMPLATE_ZIP: &[u8] = include_bytes!("../../../../og/dist/puzzle_card-0.1.0.zip");

static TEMPLATE: Mutex<Option<Template<PackedTemplate>>> = Mutex::new(None);

fn game(puzzle: &SharedPuzzle) -> (&'static str, &'static str) {
    match puzzle {
        SharedPuzzle::ThreeInARow { .. } => ("Three in a Row", "Two is company, three is a crowd"),
        SharedPuzzle::Kings { .. } => ("Kings", "Crown one king per row, column and region"),
        SharedPuzzle::Aquarium { .. } => ("Aquarium", "Fill tanks until every water count is met"),
    }
}

/// The parts of the API Gateway style event Netlify invokes classic functions with
#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct Request {
    path: String,
    query_string_parameters: Option<HashMap<String, String>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Response {
    status_code: u16,
    headers: HashMap<&'static str, String>,
    body: String,
    is_base64_encoded: bool,
}

/// One render, as the response headers report it for scripts/bench-og.mjs
struct Rendered {
    png: Vec<u8>,
    call: u64,
    template_ms: f64,
    compile_ms: f64,
    export_ms: f64,
    palette_ms: f64,
}

/// Shows in the function log how often Netlify reuses an instance, like the line of `og.mts`
struct Instance {
    id: String,
    loaded_at: Instant,
    calls: Mutex<u64>,
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Error> {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|time| time.subsec_nanos())
        .unwrap_or_default();
    let instance = Instance {
        id: format!("{:08x}", nanos ^ std::process::id().rotate_left(16)),
        loaded_at: Instant::now(),
        calls: Mutex::new(0),
    };
    let instance = &instance;
    lambda_runtime::run(service_fn(move |event: LambdaEvent<Request>| async move {
        Ok::<_, Error>(handle(instance, &event.payload))
    }))
    .await
}

fn handle(instance: &Instance, request: &Request) -> Response {
    let code = request
        .query_string_parameters
        .as_ref()
        .and_then(|query| query.get("code"))
        .map(String::as_str)
        // Called without the rewrite
        .or_else(|| request.path.rsplit('/').next())
        .unwrap_or_default();
    let code = code.strip_suffix(".png").unwrap_or(code);

    let puzzle = match read_code(code) {
        Ok(puzzle) => puzzle,
        Err(_) => return not_found(),
    };
    match render(instance, code, &puzzle) {
        Ok(rendered) => Response {
            status_code: 200,
            headers: HashMap::from([
                ("content-type", "image/png".into()),
                ("cache-control", "public, max-age=31536000, immutable".into()),
                (
                    "netlify-cdn-cache-control",
                    "public, durable, max-age=31536000, immutable".into(),
                ),
                ("x-og-renderer", "rust".into()),
                ("x-og-instance", instance.id.clone()),
                ("x-og-call", rendered.call.to_string()),
                (
                    "server-timing",
                    format!(
                        "template;dur={:.1}, compile;dur={:.1}, export;dur={:.1}, palette;dur={:.1}",
                        rendered.template_ms,
                        rendered.compile_ms,
                        rendered.export_ms,
                        rendered.palette_ms
                    ),
                ),
            ]),
            body: BASE64.encode(rendered.png),
            is_base64_encoded: true,
        },
        Err(error) => {
            eprintln!("og-rust could not render {code}: {error}");
            text(500, "Could not render the puzzle")
        }
    }
}

fn not_found() -> Response {
    text(404, "Not a puzzle")
}

fn text(status_code: u16, body: &str) -> Response {
    Response {
        status_code,
        headers: HashMap::from([("content-type", "text/plain".into())]),
        body: body.into(),
        is_base64_encoded: false,
    }
}

fn render(instance: &Instance, code: &str, puzzle: &SharedPuzzle) -> Result<Rendered, String> {
    let calls = {
        let mut calls = instance.calls.lock().unwrap_or_else(|p| p.into_inner());
        *calls += 1;
        *calls
    };
    let mut timer = Stopwatch::new();
    let mut template = TEMPLATE.lock().unwrap_or_else(|p| p.into_inner());
    let cold = template.is_none();
    let template = loaded(&mut template)?;
    let template_ms = timer.lap();

    let drawn = draw(template, puzzle)?;

    let kb = |bytes: usize| bytes as f64 / 1024.;
    println!(
        "og-rust instance={} call={calls} age={}s template={} compile={:.1}ms \
         export={:.1}ms palette={:.1}ms size={:.1}->{:.1}KB code={code}",
        instance.id,
        instance.loaded_at.elapsed().as_secs(),
        if cold {
            format!("created in {template_ms:.1}ms")
        } else {
            "warm".to_owned()
        },
        drawn.compile_ms,
        drawn.export_ms,
        drawn.palette_ms,
        kb(drawn.true_colour_bytes),
        kb(drawn.png.len()),
    );
    Ok(Rendered {
        png: drawn.png,
        call: calls,
        template_ms,
        compile_ms: drawn.compile_ms,
        export_ms: drawn.export_ms,
        palette_ms: drawn.palette_ms,
    })
}

fn loaded(
    template: &mut Option<Template<PackedTemplate>>,
) -> Result<&mut Template<PackedTemplate>, String> {
    if template.is_none() {
        *template =
            Some(Template::init(Cursor::new(TEMPLATE_ZIP)).map_err(|error| format!("{error:?}"))?);
    }
    Ok(template.as_mut().expect("created above"))
}

struct Drawn {
    png: Vec<u8>,
    true_colour_bytes: usize,
    compile_ms: f64,
    export_ms: f64,
    palette_ms: f64,
}

fn draw(template: &mut Template<PackedTemplate>, puzzle: &SharedPuzzle) -> Result<Drawn, String> {
    let mut timer = Stopwatch::new();
    let (name, tagline) = game(puzzle);
    let card = serde_json::json!({ "name": name, "tagline": tagline, "puzzle": puzzle });
    let mut inputs = TemplateInputs::new();
    inputs.with_config(CompilationConfig::production());
    inputs.with_input(JsonInput::new("card".to_owned(), card.to_string()));
    let compiled = template
        .compile(inputs)
        .map_err(|error| format!("{error:?}"))?;
    let compile_ms = timer.lap();

    // 2 pixels per point turn the 600x315pt page into 1200x630
    let rendered = export_png(&compiled.document, 2., None).map_err(|error| error.to_string())?;
    let export_ms = timer.lap();

    let png = palette(&rendered)?;
    let palette_ms = timer.lap();
    Ok(Drawn {
        png,
        true_colour_bytes: rendered.len(),
        compile_ms,
        export_ms,
        palette_ms,
    })
}

/// Typst writes true colour PNGs. The card is flat colours and some smoothed edges, which fit
/// a palette, and that takes the image from about 30 to about 12 KB at no visible cost. Done
/// with libimagequant and the settings `og.mts` hands sharp, which uses the same library: up to
/// quality 90, speed 4, no dithering.
fn palette(true_colour: &[u8]) -> Result<Vec<u8>, String> {
    let mut decoder = png::Decoder::new(Cursor::new(true_colour));
    decoder.set_transformations(png::Transformations::EXPAND);
    let mut reader = decoder.read_info().map_err(|error| error.to_string())?;
    let mut pixels = vec![0; reader.output_buffer_size().ok_or("image too large")?];
    let frame = reader
        .next_frame(&mut pixels)
        .map_err(|error| error.to_string())?;
    if frame.color_type != png::ColorType::Rgba || frame.bit_depth != png::BitDepth::Eight {
        return Err(format!(
            "expected 8 bit RGBA, Typst wrote {:?} {:?}",
            frame.color_type, frame.bit_depth
        ));
    }
    let (width, height) = (frame.width as usize, frame.height as usize);
    let pixels: Vec<imagequant::RGBA> = pixels[..frame.buffer_size()]
        .chunks_exact(4)
        .map(|p| imagequant::RGBA::new(p[0], p[1], p[2], p[3]))
        .collect();

    let quantize = || -> Result<(Vec<imagequant::RGBA>, Vec<u8>), imagequant::Error> {
        let mut attributes = imagequant::new();
        attributes.set_speed(4)?;
        attributes.set_quality(0, 90)?;
        let mut image = attributes.new_image(&pixels[..], width, height, 0.)?;
        let mut result = attributes.quantize(&mut image)?;
        result.set_dithering_level(0.)?;
        result.remapped(&mut image)
    };
    let (colours, indices) = quantize().map_err(|error| error.to_string())?;

    let mut out = Vec::new();
    let mut encoder = png::Encoder::new(&mut out, frame.width, frame.height);
    encoder.set_color(png::ColorType::Indexed);
    encoder.set_depth(png::BitDepth::Eight);
    encoder.set_palette(
        colours
            .iter()
            .flat_map(|c| [c.r, c.g, c.b])
            .collect::<Vec<_>>(),
    );
    if colours.iter().any(|c| c.a != 255) {
        encoder.set_trns(colours.iter().map(|c| c.a).collect::<Vec<_>>());
    }
    encoder.set_compression(png::Compression::High);
    let mut writer = encoder.write_header().map_err(|error| error.to_string())?;
    writer
        .write_image_data(&indices)
        .map_err(|error| error.to_string())?;
    writer.finish().map_err(|error| error.to_string())?;
    Ok(out)
}

/// Each lap returns the milliseconds since the previous one
struct Stopwatch(Instant);

impl Stopwatch {
    fn new() -> Self {
        Self(Instant::now())
    }

    fn lap(&mut self) -> f64 {
        let now = Instant::now();
        let elapsed = now.duration_since(self.0).as_secs_f64() * 1000.;
        self.0 = now;
        elapsed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn instance() -> Instance {
        Instance {
            id: "test".into(),
            loaded_at: Instant::now(),
            calls: Mutex::new(0),
        }
    }

    fn request(code: &str) -> Request {
        Request {
            path: "/.netlify/functions/og-rust".into(),
            query_string_parameters: Some(HashMap::from([("code".into(), format!("{code}.png"))])),
        }
    }

    #[test]
    fn every_fixture_renders_to_a_card() {
        let fixtures: Vec<serde_json::Value> =
            serde_json::from_str(include_str!("../../../shared/fixtures.json")).unwrap();
        let instance = instance();
        for fixture in fixtures {
            let code = fixture["code"].as_str().unwrap();
            let response = handle(&instance, &request(code));
            assert_eq!(response.status_code, 200, "{code}: {}", response.body);
            let png = BASE64.decode(&response.body).unwrap();
            let info = png::Decoder::new(Cursor::new(&png)).read_info().unwrap();
            assert_eq!(
                (info.info().width, info.info().height),
                (1200, 630),
                "{code}"
            );
            assert_eq!(info.info().color_type, png::ColorType::Indexed, "{code}");
        }
    }

    #[test]
    fn a_broken_code_is_not_found() {
        assert_eq!(handle(&instance(), &request("broken")).status_code, 404);
    }
}
