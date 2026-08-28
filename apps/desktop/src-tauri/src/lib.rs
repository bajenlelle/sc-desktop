use std::fs::File;
use std::io::{Read, Seek, SeekFrom};

use http_range::HttpRange;
use percent_encoding::percent_decode_str;
use tauri::http::{Response, StatusCode};

// ---------------------------------------------------------------------------
// Export command
// ---------------------------------------------------------------------------

#[derive(serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum ExportSegment {
    Clip {
        video_path: String,
        start: f64,
        end: f64,
    },
    Text {
        text: String,
        duration_seconds: f64,
    },
}

const FONT_BYTES: &[u8] = include_bytes!("../resources/fonts/Roboto-Regular.ttf");

/// The brand wordmark (letterforms + cyan dot) pre-rendered to a 230x36
/// transparent PNG at ~70% opacity with a soft shadow — the same mark the
/// in-app player overlay shows. Regenerate from components/logo.tsx's
/// Wordmark SVG if the brand changes. Burned into exports by the final
/// concat pass when the watermark is enabled.
const WATERMARK_BYTES: &[u8] = include_bytes!("../resources/watermark.png");

fn render_watermark_png(path: &std::path::Path) -> Result<(), String> {
    std::fs::write(path, WATERMARK_BYTES)
        .map_err(|e| format!("Failed to write watermark: {e}"))
}

#[tauri::command]
async fn export_playlist(
    app: tauri::AppHandle,
    segments: Vec<ExportSegment>,
    output_path: String,
    watermark: bool,
) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;

    if segments.is_empty() {
        return Err("No segments to export".into());
    }

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();

    let mut temp_files: Vec<std::path::PathBuf> = Vec::new();

    // Encode each segment to a temp MP4 with fade-in/fade-out.
    for (i, segment) in segments.iter().enumerate() {
        let temp_path = std::env::temp_dir().join(format!("sc_seg_{}_{}.mp4", timestamp, i));

        let status = match segment {
            ExportSegment::Clip { video_path, start, end } => {
                let duration = (end - start).max(0.001);
                let fade_out_start = (duration - 0.25).max(0.0);

                app.shell()
                    .sidecar("ffmpeg")
                    .map_err(|e| e.to_string())?
                    .args([
                        "-y",
                        "-ss", &format!("{start:.3}"),
                        "-to", &format!("{end:.3}"),
                        "-i", video_path,
                        "-vf", &format!(
                            "setpts=PTS-STARTPTS,\
                             scale=1280:720:force_original_aspect_ratio=decrease,\
                             pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black,\
                             fade=t=in:st=0:d=0.25,fade=t=out:st={fade_out_start:.3}:d=0.25"
                        ),
                        "-af", "asetpts=PTS-STARTPTS",
                        "-c:v", "libx264",
                        "-preset", "fast",
                        "-crf", "23",
                        "-c:a", "aac",
                        "-b:a", "128k",
                        temp_path.to_str().unwrap(),
                    ])
                    .output()
                    .await
                    .map_err(|e| e.to_string())?
            }
            ExportSegment::Text { text, duration_seconds } => {
                use ab_glyph::{FontArc, PxScale};
                use image::{ImageBuffer, Rgba};
                use imageproc::drawing::{draw_text_mut, text_size};

                let font = FontArc::try_from_slice(FONT_BYTES)
                    .map_err(|e| format!("Failed to load font: {e}"))?;

                let scale = PxScale::from(72.0);
                let max_w = 1280i32 - 80; // 40px padding each side

                // Word-wrap: greedily fill lines up to max_w
                let mut lines: Vec<String> = Vec::new();
                let mut current = String::new();
                for word in text.split_whitespace() {
                    let candidate = if current.is_empty() {
                        word.to_string()
                    } else {
                        format!("{current} {word}")
                    };
                    let (cw, _) = text_size(scale, &font, &candidate);
                    if cw as i32 > max_w && !current.is_empty() {
                        lines.push(current.clone());
                        current = word.to_string();
                    } else {
                        current = candidate;
                    }
                }
                if !current.is_empty() {
                    lines.push(current);
                }

                let (_, line_h) = text_size(scale, &font, "Ag");
                let line_step = (line_h as f32 * 1.3) as i32;
                let total_h = lines.len() as i32 * line_step;
                let start_y = ((720i32 - total_h) / 2).max(0);

                let mut img: ImageBuffer<Rgba<u8>, Vec<u8>> =
                    ImageBuffer::from_pixel(1280, 720, Rgba([0, 0, 0, 255]));
                for (li, line) in lines.iter().enumerate() {
                    let (lw, _) = text_size(scale, &font, line);
                    let x = ((1280i32 - lw as i32) / 2).max(0);
                    let y = start_y + li as i32 * line_step;
                    draw_text_mut(&mut img, Rgba([255, 255, 255, 255]), x, y, scale, &font, line);
                }

                let png_path = std::env::temp_dir()
                    .join(format!("sc_text_{}_{}.png", timestamp, i));
                img.save(&png_path)
                    .map_err(|e| format!("Failed to save text frame: {e}"))?;

                let fade_out_start = (duration_seconds - 0.25).max(0.0);

                let result = app.shell()
                    .sidecar("ffmpeg")
                    .map_err(|e| e.to_string())?
                    .args([
                        "-y",
                        "-framerate", "30",
                        "-loop", "1",
                        "-i", png_path.to_str().unwrap(),
                        "-f", "lavfi",
                        "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
                        "-vf", &format!(
                            "fade=t=in:st=0:d=0.25,fade=t=out:st={fade_out_start:.3}:d=0.25"
                        ),
                        "-af", "asetpts=PTS-STARTPTS",
                        "-c:v", "libx264",
                        "-preset", "fast",
                        "-crf", "23",
                        "-pix_fmt", "yuv420p",
                        "-c:a", "aac",
                        "-b:a", "128k",
                        "-t", &format!("{duration_seconds:.3}"),
                        temp_path.to_str().unwrap(),
                    ])
                    .output()
                    .await
                    .map_err(|e| e.to_string())?;

                let _ = std::fs::remove_file(&png_path);
                result
            }
        };

        if !status.status.success() {
            // Clean up already-created temp files before returning error
            for f in &temp_files {
                let _ = std::fs::remove_file(f);
            }
            let _ = std::fs::remove_file(&temp_path);
            return Err(String::from_utf8_lossy(&status.stderr).to_string());
        }

        temp_files.push(temp_path);
    }

    // Final concat using the concat filter, which normalises timestamps
    // across all segments and avoids A/V sync drift from input-side seeking.
    let n = temp_files.len();
    let mut concat_args: Vec<String> = vec!["-y".to_string()];
    for p in &temp_files {
        concat_args.push("-i".to_string());
        concat_args.push(p.to_str().unwrap().to_string());
    }
    // Watermark rides as one extra input overlaid after the concat — every
    // segment is already normalized to 1280x720 there, so one steady mark
    // covers the whole timeline (and the poster frame inherits it).
    // Best-effort: a failed raster must never lose a finished render.
    let watermark_png = std::env::temp_dir().join(format!("sc_wm_{timestamp}.png"));
    let with_watermark = watermark && render_watermark_png(&watermark_png).is_ok();
    if with_watermark {
        concat_args.push("-i".to_string());
        concat_args.push(watermark_png.to_str().unwrap().to_string());
    }
    let mut filter = String::new();
    for i in 0..n {
        filter.push_str(&format!("[{i}:v:0][{i}:a:0]"));
    }
    if with_watermark {
        filter.push_str(&format!(
            "concat=n={n}:v=1:a=1[cv][outa];[cv][{n}:v]overlay=W-w-24:H-h-48[outv]"
        ));
    } else {
        filter.push_str(&format!("concat=n={n}:v=1:a=1[outv][outa]"));
    }
    concat_args.extend([
        "-filter_complex".to_string(), filter,
        "-map".to_string(), "[outv]".to_string(),
        "-map".to_string(), "[outa]".to_string(),
        "-c:v".to_string(), "libx264".to_string(),
        "-preset".to_string(), "fast".to_string(),
        "-crf".to_string(), "23".to_string(),
        "-c:a".to_string(), "aac".to_string(),
        "-b:a".to_string(), "128k".to_string(),
        output_path.clone(),
    ]);
    let result = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| e.to_string())?
        .args(&concat_args)
        .output()
        .await
        .map_err(|e| e.to_string())?;

    // Clean up temp files regardless of outcome.
    for f in &temp_files {
        let _ = std::fs::remove_file(f);
    }
    let _ = std::fs::remove_file(&watermark_png);

    if result.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&result.stderr).to_string())
    }
}

#[tauri::command]
async fn export_clip_for_ship(
    app: tauri::AppHandle,
    video_path: String,
    start: f64,
    end: f64,
    output_path: String,
) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;
    let duration = (end - start).max(0.001);
    let fade_out_start = (duration - 0.25).max(0.0);
    let result = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| e.to_string())?
        .args([
            "-y",
            "-ss", &format!("{start:.3}"),
            "-to", &format!("{end:.3}"),
            "-i", &video_path,
            "-vf", &format!(
                "setpts=PTS-STARTPTS,\
                 scale=960:540:force_original_aspect_ratio=decrease,\
                 pad=960:540:(ow-iw)/2:(oh-ih)/2:color=black,\
                 fade=t=in:st=0:d=0.25,fade=t=out:st={fade_out_start:.3}:d=0.25"
            ),
            "-af", "asetpts=PTS-STARTPTS",
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "28",
            "-c:a", "aac",
            "-b:a", "96k",
            &output_path,
        ])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if result.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&result.stderr).to_string())
    }
}

/// Extract a single poster frame (JPEG) from a rendered highlight video.
/// Seeks past the 0.25s fade-in first; retries at t=0 for videos shorter
/// than the seek offset. Both paths are confined to the temp dir — the
/// input is the MP4 the app just rendered there, the output sits beside it.
#[tauri::command]
async fn extract_poster_frame(
    app: tauri::AppHandle,
    video_path: String,
    output_path: String,
) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;
    let video = resolve_within(&video_path, &std::env::temp_dir())
        .map_err(|e| format!("extract_poster_frame: {e}"))?;
    // The output file doesn't exist yet, so canonicalize its parent instead.
    let out = std::path::Path::new(&output_path);
    let file_name = out
        .file_name()
        .ok_or("extract_poster_frame: output has no file name")?
        .to_owned();
    let parent = out
        .parent()
        .ok_or("extract_poster_frame: output has no parent")?
        .to_string_lossy()
        .to_string();
    let output = resolve_within(&parent, &std::env::temp_dir())
        .map_err(|e| format!("extract_poster_frame: {e}"))?
        .join(file_name);

    let video_arg = video.to_string_lossy().to_string();
    let output_arg = output.to_string_lossy().to_string();
    let mut last_err = String::from("no frame extracted");
    for seek in ["0.6", "0"] {
        let result = app
            .shell()
            .sidecar("ffmpeg")
            .map_err(|e| e.to_string())?
            .args([
                "-y",
                "-ss", seek,
                "-i", &video_arg,
                "-frames:v", "1",
                "-q:v", "3",
                &output_arg,
            ])
            .output()
            .await
            .map_err(|e| e.to_string())?;
        // ffmpeg can exit 0 without producing a frame when -ss is past EOF,
        // so an empty or missing output means "try again", not success.
        let produced = std::fs::metadata(&output).map(|m| m.len() > 0).unwrap_or(false);
        if result.status.success() && produced {
            return Ok(());
        }
        last_err = String::from_utf8_lossy(&result.stderr).to_string();
    }
    Err(format!("extract_poster_frame: {last_err}"))
}

#[tauri::command]
async fn get_temp_dir() -> String {
    std::env::temp_dir().to_string_lossy().to_string()
}

/// Canonicalize `path` and require it to live inside `dir` (also
/// canonicalized — on macOS temp_dir() sits behind the /var -> /private/var
/// symlink). Rejects `..` traversal and symlink escapes, which a plain
/// Path::starts_with on the raw string does not.
fn resolve_within(path: &str, dir: &std::path::Path) -> Result<std::path::PathBuf, String> {
    let dir = dir
        .canonicalize()
        .map_err(|e| format!("cannot resolve base dir: {e}"))?;
    let p = std::path::Path::new(path)
        .canonicalize()
        .map_err(|e| format!("cannot resolve path: {e}"))?;
    if p.starts_with(&dir) {
        Ok(p)
    } else {
        Err("path is outside temp directory".into())
    }
}

#[tauri::command]
async fn delete_file(path: String) -> Result<(), String> {
    let p = resolve_within(&path, &std::env::temp_dir())
        .map_err(|e| format!("delete_file: {e}"))?;
    std::fs::remove_file(p).map_err(|e| e.to_string())
}

/// Read a whole file and return raw bytes over IPC. Used for R2 uploads —
/// fetch() against stream:// caps at CHUNK_SIZE per response and its
/// headers aren't reliably readable cross-origin, which once caused
/// silently truncated uploads. std::fs::read returns everything or errors.
/// Confined to the temp dir: every caller uploads files this app just
/// wrote there (clip-and-ship, highlight shares); library video files go
/// through stream:// instead.
#[tauri::command]
async fn read_file(path: String) -> Result<tauri::ipc::Response, String> {
    let p = resolve_within(&path, &std::env::temp_dir())
        .map_err(|e| format!("read_file: {e}"))?;
    let bytes = std::fs::read(p).map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Maximum bytes returned per request via the stream:// protocol.
/// Keeps memory usage bounded regardless of file size.
const CHUNK_SIZE: u64 = 4 * 1024 * 1024; // 4 MiB

/// Sentry DSN for the scoutable-desktop project. DSNs are public identifiers,
/// not secrets. Debug builds stay offline unless SENTRY_DSN_DESKTOP is
/// exported at compile time (for testing the reporting pipeline locally).
const SENTRY_DSN: &str =
    "https://537f3ffb87f438f92d805c43e47acab1@o4511984392994816.ingest.de.sentry.io/4511984462397520";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let dsn = option_env!("SENTRY_DSN_DESKTOP")
        .unwrap_or(if cfg!(debug_assertions) { "" } else { SENTRY_DSN });
    // ClientOptions is #[non_exhaustive]; fields must be set on a default().
    let mut sentry_options = sentry::ClientOptions::default();
    sentry_options.release = sentry::release_name!();
    sentry_options.environment = Some(
        option_env!("SCOUTABLE_ENV")
            .unwrap_or(if cfg!(debug_assertions) { "development" } else { "production" })
            .into(),
    );
    let sentry_client = sentry::init((dsn, sentry_options));

    tauri::Builder::default()
        // Rust panics + webview JS errors both flow through this client; the
        // webview runs its own @sentry/react init (src/lib/sentry.ts), so use
        // the no-injection variant to avoid a second injected SDK.
        .plugin(tauri_plugin_sentry::init_with_no_injection(&sentry_client))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_deep_link::init())
        // Custom streaming protocol that handles large video files (>4 GB) correctly.
        // Tauri's built-in asset:// handler buffers the entire file for non-Range GET
        // requests, which causes OOM errors for 7–8 GB files. This protocol caps every
        // response at CHUNK_SIZE and always returns 206 with a Content-Range header so
        // WKWebView knows the total file size and makes proper range requests.
        .register_asynchronous_uri_scheme_protocol("stream", |_ctx, request, responder| {
            // Decode the path from the URI (e.g. stream://localhost/Users/foo/bar.mp4)
            let path = percent_decode_str(request.uri().path())
                .decode_utf8_lossy()
                .to_string();

            // Capture Range header before moving request into the thread
            let range_header = request
                .headers()
                .get("range")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string());

            std::thread::spawn(move || {
                let mut file = match File::open(&path) {
                    Ok(f) => f,
                    Err(e) => {
                        let status = if e.kind() == std::io::ErrorKind::NotFound {
                            StatusCode::NOT_FOUND
                        } else {
                            StatusCode::FORBIDDEN
                        };
                        responder.respond(
                            Response::builder()
                                .status(status)
                                .header("Access-Control-Allow-Origin", "*")
                                .body(vec![])
                                .unwrap(),
                        );
                        return;
                    }
                };

                let file_size = match file.seek(SeekFrom::End(0)) {
                    Ok(s) => s,
                    Err(_) => {
                        responder.respond(
                            Response::builder()
                                .status(StatusCode::INTERNAL_SERVER_ERROR)
                                .header("Access-Control-Allow-Origin", "*")
                                .body(vec![])
                                .unwrap(),
                        );
                        return;
                    }
                };

                if file_size == 0 {
                    responder.respond(
                        Response::builder()
                            .status(StatusCode::NO_CONTENT)
                            .header("Access-Control-Allow-Origin", "*")
                            .body(vec![])
                            .unwrap(),
                    );
                    return;
                }

                let mime = mime_for_path(&path);

                // Determine the byte range to serve.
                // If no Range header, serve the first CHUNK_SIZE bytes and return 206
                // with the correct total length — WKWebView will then make proper range
                // requests for the remainder rather than stalling on an incomplete body.
                let (start, end) = match range_header.as_deref() {
                    Some(hdr) => {
                        match HttpRange::parse(hdr, file_size) {
                            Ok(ranges) if !ranges.is_empty() => {
                                let r = &ranges[0];
                                let s = r.start;
                                // Cap at CHUNK_SIZE to bound memory usage
                                let e = (s + r.length - 1)
                                    .min(s + CHUNK_SIZE - 1)
                                    .min(file_size - 1);
                                (s, e)
                            }
                            _ => {
                                // Malformed or unsatisfiable range
                                responder.respond(
                                    Response::builder()
                                        .status(StatusCode::RANGE_NOT_SATISFIABLE)
                                        .header(
                                            "Content-Range",
                                            format!("bytes */{file_size}"),
                                        )
                                        .header("Access-Control-Allow-Origin", "*")
                                        .body(vec![])
                                        .unwrap(),
                                );
                                return;
                            }
                        }
                    }
                    None => {
                        // No Range header: serve first chunk; 206 tells the browser the
                        // real total size so it can request the rest via Range.
                        let end = CHUNK_SIZE.saturating_sub(1).min(file_size - 1);
                        (0u64, end)
                    }
                };

                let chunk_len = (end - start + 1) as usize;
                let mut buf = vec![0u8; chunk_len];

                if file.seek(SeekFrom::Start(start)).is_err()
                    || file.read_exact(&mut buf).is_err()
                {
                    responder.respond(
                        Response::builder()
                            .status(StatusCode::INTERNAL_SERVER_ERROR)
                            .header("Access-Control-Allow-Origin", "*")
                            .body(vec![])
                            .unwrap(),
                    );
                    return;
                }

                let response = Response::builder()
                    .status(StatusCode::PARTIAL_CONTENT)
                    .header("Content-Type", mime)
                    .header("Content-Length", chunk_len.to_string())
                    .header(
                        "Content-Range",
                        format!("bytes {start}-{end}/{file_size}"),
                    )
                    .header("Accept-Ranges", "bytes")
                    .header("Access-Control-Allow-Origin", "*")
                    .body(buf)
                    .unwrap();

                responder.respond(response);
            });
        })
        .invoke_handler(tauri::generate_handler![export_playlist, get_temp_dir, delete_file, read_file, export_clip_for_ship, extract_poster_frame])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn mime_for_path(path: &str) -> &'static str {
    let lower = path.to_lowercase();
    if lower.ends_with(".mp4") || lower.ends_with(".m4v") {
        "video/mp4"
    } else if lower.ends_with(".mov") {
        "video/quicktime"
    } else if lower.ends_with(".avi") {
        "video/x-msvideo"
    } else if lower.ends_with(".mkv") {
        "video/x-matroska"
    } else if lower.ends_with(".webm") {
        "video/webm"
    } else {
        "application/octet-stream"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn render_watermark_png_writes_a_transparent_mark() {
        let path = std::env::temp_dir().join("sc_wm_test.png");
        let _ = std::fs::remove_file(&path);
        render_watermark_png(&path).expect("watermark raster should succeed");
        let img = image::open(&path).expect("png should be readable").to_rgba8();
        assert!(img.width() > 100, "mark should be wide enough to read");
        assert!(img.height() > 15);
        // Transparent background, non-transparent mark.
        assert_eq!(img.get_pixel(0, 0).0[3], 0, "corner should be transparent");
        assert!(
            img.pixels().any(|p| p.0[3] > 0),
            "mark should have visible pixels"
        );
    }

    /// Fresh scratch dir per test — resolve_within takes the base dir as a
    /// parameter precisely so tests never touch the real system temp policy.
    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("sc_test_{}_{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("sandbox")).unwrap();
        dir
    }

    #[test]
    fn resolve_within_accepts_contained_path() {
        let base = scratch("contained");
        let sandbox = base.join("sandbox");
        let file = sandbox.join("file.txt");
        std::fs::write(&file, b"x").unwrap();
        assert!(resolve_within(file.to_str().unwrap(), &sandbox).is_ok());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn resolve_within_rejects_dotdot_traversal() {
        let base = scratch("dotdot");
        let sandbox = base.join("sandbox");
        let outside = base.join("outside.txt");
        std::fs::write(&outside, b"x").unwrap();
        // The raw string is prefixed by the sandbox path, so a plain
        // starts_with check accepted it — this is the exact bug being pinned.
        let sneaky = format!("{}/../outside.txt", sandbox.to_str().unwrap());
        assert!(resolve_within(&sneaky, &sandbox).is_err());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[cfg(unix)]
    #[test]
    fn resolve_within_rejects_symlink_escape() {
        let base = scratch("symlink");
        let sandbox = base.join("sandbox");
        let outside = base.join("outside.txt");
        std::fs::write(&outside, b"x").unwrap();
        let link = sandbox.join("link.txt");
        std::os::unix::fs::symlink(&outside, &link).unwrap();
        assert!(resolve_within(link.to_str().unwrap(), &sandbox).is_err());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn resolve_within_rejects_nonexistent_path() {
        let base = scratch("missing");
        let sandbox = base.join("sandbox");
        let missing = sandbox.join("nope.txt");
        assert!(resolve_within(missing.to_str().unwrap(), &sandbox).is_err());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn mime_for_path_maps_video_extensions() {
        assert_eq!(mime_for_path("/tmp/a.mp4"), "video/mp4");
        assert_eq!(mime_for_path("/tmp/A.M4V"), "video/mp4");
        assert_eq!(mime_for_path("/tmp/a.mov"), "video/quicktime");
        assert_eq!(mime_for_path("/tmp/a.avi"), "video/x-msvideo");
        assert_eq!(mime_for_path("/tmp/a.mkv"), "video/x-matroska");
        assert_eq!(mime_for_path("/tmp/a.webm"), "video/webm");
        assert_eq!(mime_for_path("/tmp/a.txt"), "application/octet-stream");
        assert_eq!(mime_for_path("/tmp/noext"), "application/octet-stream");
    }
}
