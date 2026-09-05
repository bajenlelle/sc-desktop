use std::fs::File;
use std::io::{Read, Seek, SeekFrom};

use http_range::HttpRange;
use percent_encoding::percent_decode_str;
use tauri::http::{Response, StatusCode};

mod menu;

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
        /// Vertical-export pan path: segment-relative times (seconds from the
        /// clip's start) + normalized crop-window centers (0..1 of source
        /// width). Sorted and non-empty when present (TS toSegmentKeyframes
        /// guarantees both). Ignored for 16:9 exports.
        #[serde(default)]
        crop_keyframes: Option<Vec<CropKf>>,
    },
    Text {
        text: String,
        duration_seconds: f64,
    },
}

#[derive(serde::Deserialize, Clone, Copy)]
struct CropKf {
    t: f64,
    cx: f64,
}

/// Build the ffmpeg `crop` x-expression for a moving 9:16 window.
///
/// The crop filter re-evaluates `x` every output frame, so a piecewise-linear
/// `lerp` chain over `t` renders the whole pan in a single filter. The chain
/// produces the normalized window CENTER cx(t); the surrounding arithmetic
/// converts to a left-edge pixel offset, clamps the window inside the frame,
/// and forces an even offset (`2*trunc(../2)`) so yuv420p chroma alignment
/// can't add a one-pixel wobble as the parity flips mid-pan.
fn build_crop_x_expr(keyframes: &[CropKf]) -> String {
    let mut kfs: Vec<CropKf> = keyframes.to_vec();
    kfs.sort_by(|a, b| a.t.total_cmp(&b.t));
    // Collapse near-duplicate times (would divide by ~zero in lerp).
    kfs.dedup_by(|b, a| (b.t - a.t).abs() < 0.001);

    let cx_chain = match kfs.len() {
        0 => "0.5".to_string(),
        1 => format!("{:.4}", kfs[0].cx),
        _ => {
            // Innermost value = last keyframe's cx (held after the pan ends);
            // wrap backwards in if(lt(t,ti), lerp(...), rest).
            let mut expr = format!("{:.4}", kfs[kfs.len() - 1].cx);
            for i in (1..kfs.len()).rev() {
                let a = kfs[i - 1];
                let b = kfs[i];
                expr = format!(
                    "if(lt(t\\,{t1:.3})\\,lerp({c0:.4}\\,{c1:.4}\\,(t-{t0:.3})/{span:.3})\\,{rest})",
                    t1 = b.t,
                    c0 = a.cx,
                    c1 = b.cx,
                    t0 = a.t,
                    span = b.t - a.t,
                    rest = expr,
                );
            }
            expr
        }
    };
    format!("2*trunc(clip({cx_chain}*iw-ow/2\\,0\\,iw-ow)/2)")
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

/// ffmpeg exits 0 even when `-ss` seeks past the source's end: it reads zero
/// packets and the MP4 muxer silently drops the empty tracks, leaving a valid
/// container with no streams that only blows up later — the concat pass dies
/// with a cryptic "matches no streams", or a shipped clip uploads unplayable.
/// A track-less MP4 is a few hundred bytes; any real segment (even a short
/// black text card) is tens of KB, so a size floor is a reliable stream check
/// without ffprobe (not in the sidecar build).
const MIN_RENDERED_OUTPUT_BYTES: u64 = 4096;

fn assert_rendered_output(path: &std::path::Path, what: &str) -> Result<(), String> {
    let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    if size < MIN_RENDERED_OUTPUT_BYTES {
        return Err(format!(
            "{what} rendered empty — its time range is probably outside the source video. \
             The video linked to this game may be the wrong file (open it in the Library \
             and locate the right one), or its sync point may be off."
        ));
    }
    Ok(())
}

#[tauri::command]
async fn export_playlist(
    app: tauri::AppHandle,
    segments: Vec<ExportSegment>,
    output_path: String,
    watermark: bool,
    vertical: Option<bool>,
) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;

    if segments.is_empty() {
        return Err("No segments to export".into());
    }
    // 9:16 social export: crop a (possibly moving) window at source
    // resolution, then scale to 1080x1920. The concat filter requires every
    // segment to share one WxH, so the whole export is either 16:9 or 9:16.
    let vertical = vertical.unwrap_or(false);

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();

    let mut temp_files: Vec<std::path::PathBuf> = Vec::new();

    // Encode each segment to a temp MP4 with fade-in/fade-out.
    for (i, segment) in segments.iter().enumerate() {
        let temp_path = std::env::temp_dir().join(format!("sc_seg_{}_{}.mp4", timestamp, i));

        let status = match segment {
            ExportSegment::Clip { video_path, start, end, crop_keyframes } => {
                let duration = (end - start).max(0.001);
                let fade_out_start = (duration - 0.25).max(0.0);

                let vf = if vertical {
                    // Crop first (at native resolution), scale second. Window
                    // width comes from expression vars (2*trunc(ih*9/32) =
                    // even-rounded ih*9/16), so no probing is needed; min(iw,..)
                    // keeps narrow sources valid. x is re-evaluated per frame —
                    // the whole pan is this one filter.
                    let x_expr = build_crop_x_expr(
                        crop_keyframes.as_deref().unwrap_or(&[]),
                    );
                    format!(
                        "setpts=PTS-STARTPTS,\
                         crop=w=min(iw\\,2*trunc(ih*9/32)):h=ih:x={x_expr}:y=0,\
                         scale=1080:1920:flags=lanczos,setsar=1,\
                         fade=t=in:st=0:d=0.25,fade=t=out:st={fade_out_start:.3}:d=0.25"
                    )
                } else {
                    format!(
                        "setpts=PTS-STARTPTS,\
                         scale=1280:720:force_original_aspect_ratio=decrease,\
                         pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black,\
                         fade=t=in:st=0:d=0.25,fade=t=out:st={fade_out_start:.3}:d=0.25"
                    )
                };

                let mut args: Vec<String> = vec![
                    "-y".into(),
                    "-ss".into(), format!("{start:.3}"),
                    "-to".into(), format!("{end:.3}"),
                    "-i".into(), video_path.clone(),
                    "-vf".into(), vf,
                    "-af".into(), "asetpts=PTS-STARTPTS".into(),
                    "-c:v".into(), "libx264".into(),
                    "-preset".into(), "fast".into(),
                    "-crf".into(), "23".into(),
                ];
                if vertical {
                    // Upscaled crop must stay 4:2:0 — social platforms reject
                    // exotic pixel formats. (16:9 path left byte-identical.)
                    args.extend(["-pix_fmt".into(), "yuv420p".into()]);
                }
                args.extend([
                    "-c:a".into(), "aac".into(),
                    "-b:a".into(), "128k".into(),
                    temp_path.to_str().unwrap().to_string(),
                ]);

                app.shell()
                    .sidecar("ffmpeg")
                    .map_err(|e| e.to_string())?
                    .args(&args)
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

                // Raster dims must match the clip segments' output exactly or
                // the concat filter fails (same-WxH invariant).
                let (card_w, card_h) = if vertical { (1080i32, 1920i32) } else { (1280i32, 720i32) };
                let scale = PxScale::from(72.0);
                let max_w = card_w - if vertical { 120 } else { 80 }; // side padding

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
                let start_y = ((card_h - total_h) / 2).max(0);

                let mut img: ImageBuffer<Rgba<u8>, Vec<u8>> =
                    ImageBuffer::from_pixel(card_w as u32, card_h as u32, Rgba([0, 0, 0, 255]));
                for (li, line) in lines.iter().enumerate() {
                    let (lw, _) = text_size(scale, &font, line);
                    let x = ((card_w - lw as i32) / 2).max(0);
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

        let segment_error = if !status.status.success() {
            Some(String::from_utf8_lossy(&status.stderr).to_string())
        } else {
            assert_rendered_output(&temp_path, &format!("Segment {} of {}", i + 1, segments.len()))
                .err()
        };
        if let Some(message) = segment_error {
            // Clean up already-created temp files before returning error
            for f in &temp_files {
                let _ = std::fs::remove_file(f);
            }
            let _ = std::fs::remove_file(&temp_path);
            return Err(message);
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
        // Vertical: bottom-center, lifted 700px — TikTok/Reels UI covers the
        // bottom ~35% and the right edge, where the 16:9 position would hide.
        let overlay_pos = if vertical { "(W-w)/2:H-h-700" } else { "W-w-24:H-h-48" };
        filter.push_str(&format!(
            "concat=n={n}:v=1:a=1[cv][outa];[cv][{n}:v]overlay={overlay_pos}[outv]"
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
        assert_rendered_output(std::path::Path::new(&output_path), "This clip")
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

#[derive(serde::Serialize)]
struct VideoFileEntry {
    path: String,
    file_name: String,
    size: u64,
}

const VIDEO_EXTENSIONS: [&str; 6] = ["mp4", "mov", "avi", "mkv", "webm", "m4v"];
const VIDEO_SCAN_MAX_DEPTH: usize = 5;
const VIDEO_SCAN_MAX_ENTRIES: usize = 5000;

fn collect_video_files(
    dir: &std::path::Path,
    depth: usize,
    out: &mut Vec<VideoFileEntry>,
) {
    if depth > VIDEO_SCAN_MAX_DEPTH || out.len() >= VIDEO_SCAN_MAX_ENTRIES {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        if out.len() >= VIDEO_SCAN_MAX_ENTRIES {
            return;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue; // hidden files and dirs
        }
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else { continue };
        if file_type.is_dir() {
            collect_video_files(&path, depth + 1, out);
        } else if file_type.is_file() {
            let ext_matches = path
                .extension()
                .map(|e| {
                    let e = e.to_string_lossy().to_lowercase();
                    VIDEO_EXTENSIONS.contains(&e.as_str())
                })
                .unwrap_or(false);
            if ext_matches {
                let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                out.push(VideoFileEntry {
                    path: path.to_string_lossy().to_string(),
                    file_name: name,
                    size,
                });
            }
        }
        // Symlinks are skipped: following them risks cycles and scanning
        // outside the folder the user actually pointed at.
    }
}

/// Recursively list video files under a user-picked folder — feeds the
/// "Find missing videos" bulk-relink flow. Bounded (depth 5, 5000 entries,
/// hidden dirs skipped) so pointing at ~/ by accident stays cheap.
#[tauri::command]
async fn list_video_files(dir: String) -> Result<Vec<VideoFileEntry>, String> {
    let root = std::path::PathBuf::from(&dir);
    if !root.is_dir() {
        return Err("Not a folder".into());
    }
    let mut out = Vec::new();
    collect_video_files(&root, 0, &mut out);
    Ok(out)
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
        // Native menu bar (macOS only). Built before the webview loads so the
        // default menu never flashes; custom items reach the webview via a
        // single "menu" event (see menu.rs / components/menu-handler.tsx).
        .setup(|app| {
            #[cfg(target_os = "macos")]
            menu::init(app.handle())?;
            #[cfg(not(target_os = "macos"))]
            let _ = app;
            Ok(())
        })
        .on_menu_event(menu::on_menu_event)
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
        .invoke_handler(tauri::generate_handler![
            export_playlist,
            get_temp_dir,
            list_video_files,
            delete_file,
            read_file,
            export_clip_for_ship,
            extract_poster_frame,
            menu::menu_set_enabled,
            menu::menu_sync_theme
        ])
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

    // ── build_crop_x_expr goldens ────────────────────────────────────────────
    // The expression grammar is load-bearing: `\,` protects commas at the
    // filtergraph level, and the 2*trunc(../2) wrapper keeps x even for
    // yuv420p. Golden strings pin both.

    #[test]
    fn crop_expr_no_keyframes_is_static_center() {
        assert_eq!(
            build_crop_x_expr(&[]),
            "2*trunc(clip(0.5*iw-ow/2\\,0\\,iw-ow)/2)"
        );
    }

    #[test]
    fn crop_expr_single_keyframe_is_constant() {
        assert_eq!(
            build_crop_x_expr(&[CropKf { t: 3.0, cx: 0.25 }]),
            "2*trunc(clip(0.2500*iw-ow/2\\,0\\,iw-ow)/2)"
        );
    }

    #[test]
    fn crop_expr_two_keyframes_lerp() {
        assert_eq!(
            build_crop_x_expr(&[CropKf { t: 0.0, cx: 0.3 }, CropKf { t: 5.0, cx: 0.7 }]),
            "2*trunc(clip(if(lt(t\\,5.000)\\,lerp(0.3000\\,0.7000\\,(t-0.000)/5.000)\\,0.7000)*iw-ow/2\\,0\\,iw-ow)/2)"
        );
    }

    #[test]
    fn crop_expr_three_keyframes_nest_and_hold_last() {
        assert_eq!(
            build_crop_x_expr(&[
                CropKf { t: 0.0, cx: 0.5 },
                CropKf { t: 2.0, cx: 0.2 },
                CropKf { t: 6.0, cx: 0.8 },
            ]),
            "2*trunc(clip(if(lt(t\\,2.000)\\,lerp(0.5000\\,0.2000\\,(t-0.000)/2.000)\\,if(lt(t\\,6.000)\\,lerp(0.2000\\,0.8000\\,(t-2.000)/4.000)\\,0.8000))*iw-ow/2\\,0\\,iw-ow)/2)"
        );
    }

    #[test]
    fn crop_expr_sorts_and_dedupes_near_duplicate_times() {
        // Unsorted input + a duplicate time within 1ms: must not emit a
        // zero-span lerp (division by ~zero in the ffmpeg evaluator).
        let expr = build_crop_x_expr(&[
            CropKf { t: 4.0, cx: 0.9 },
            CropKf { t: 0.0, cx: 0.1 },
            CropKf { t: 4.0005, cx: 0.6 },
        ]);
        assert_eq!(
            expr,
            "2*trunc(clip(if(lt(t\\,4.000)\\,lerp(0.1000\\,0.9000\\,(t-0.000)/4.000)\\,0.9000)*iw-ow/2\\,0\\,iw-ow)/2)"
        );
    }

    #[test]
    fn collect_video_files_filters_extensions_hidden_and_depth() {
        let base = scratch("videoscan");
        let root = base.join("sandbox");
        std::fs::create_dir_all(root.join("sub/.hidden")).unwrap();
        std::fs::create_dir_all(root.join("a/b/c/d/e/f/g")).unwrap(); // beyond depth 5
        std::fs::write(root.join("game one.MP4"), b"x").unwrap();
        std::fs::write(root.join("sub/practice.mov"), b"xy").unwrap();
        std::fs::write(root.join("sub/notes.txt"), b"x").unwrap();
        std::fs::write(root.join("sub/.hidden/secret.mp4"), b"x").unwrap();
        std::fs::write(root.join(".DS_Store"), b"x").unwrap();
        std::fs::write(root.join("a/b/c/d/e/f/g/deep.mp4"), b"x").unwrap();

        let mut out = Vec::new();
        collect_video_files(&root, 0, &mut out);
        let mut names: Vec<&str> = out.iter().map(|e| e.file_name.as_str()).collect();
        names.sort();
        // Uppercase extension matches; txt, hidden dir, and beyond-depth files don't.
        assert_eq!(names, vec!["game one.MP4", "practice.mov"]);
        let practice = out.iter().find(|e| e.file_name == "practice.mov").unwrap();
        assert_eq!(practice.size, 2);
        let _ = std::fs::remove_dir_all(&base);
    }

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
