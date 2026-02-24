use std::fs::File;
use std::io::{Read, Seek, SeekFrom};

use http_range::HttpRange;
use percent_encoding::percent_decode_str;
use tauri::http::{Response, StatusCode};

// ---------------------------------------------------------------------------
// Export command
// ---------------------------------------------------------------------------

#[derive(serde::Deserialize)]
struct ClipSegment {
    start: f64,
    end: f64,
}

#[tauri::command]
async fn export_playlist(
    app: tauri::AppHandle,
    video_path: String,
    clips: Vec<ClipSegment>,
    output_path: String,
) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;

    if clips.is_empty() {
        return Err("No clips to export".into());
    }

    // Build FFmpeg concat demuxer file
    let mut concat_content = String::new();
    for clip in &clips {
        concat_content.push_str(&format!("file '{}'\n", video_path.replace('\'', "'\\''")));
        concat_content.push_str(&format!("inpoint {:.3}\n", clip.start));
        concat_content.push_str(&format!("outpoint {:.3}\n", clip.end));
    }

    // Write to temp file
    let concat_path = std::env::temp_dir().join(format!(
        "sc_export_{}.txt",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    ));
    std::fs::write(&concat_path, &concat_content).map_err(|e| e.to_string())?;

    let output = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| e.to_string())?
        .args([
            "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", concat_path.to_str().unwrap(),
            "-c", "copy",
            &output_path,
        ])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    let _ = std::fs::remove_file(&concat_path);

    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

/// Maximum bytes returned per request via the stream:// protocol.
/// Keeps memory usage bounded regardless of file size.
const CHUNK_SIZE: u64 = 4 * 1024 * 1024; // 4 MiB

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
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
        .invoke_handler(tauri::generate_handler![export_playlist])
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
