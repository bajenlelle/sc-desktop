//! Cloud copies of games: the 720p transcode and the part uploads behind
//! "Keep a copy in the cloud".
//!
//! The webview orchestrates (it talks to the `game-video` function, asks for
//! presigned part URLs, decides what to resume); Rust does what the webview
//! can't: runs ffmpeg with progress, keeps the finished copy in the app's
//! cache until it is uploaded, and PUTs 32 MiB byte ranges of it to the
//! presigned URLs without the bytes crossing IPC (the HTTP plugin would
//! serialise each part as a JSON array of numbers). Both the encode and the
//! uploads register with the export registry, so Cancel reaches them.

use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use tauri::Manager;

use crate::export_jobs::{partial_output_path, ExportJobs, JobHandle, Killable, EXPORT_CANCELLED};
use crate::video_frames::{checked_video_path, parse_ffmpeg_probe};

/// The copy must not drift from the source by more than this, or the encode
/// is treated as broken (a crash leaves no file at all, see the rename below).
const DURATION_TOLERANCE_MS: u64 = 2_000;
/// A part is at most this long; the plan uses 32 MiB.
const MAX_PART_BYTES: u64 = 64 * 1024 * 1024;

/// Where finished copies wait for their upload: the app's cache, never the
/// OS temp dir, which macOS may clear under the app. Created on demand.
pub(crate) fn cache_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("cache dir: {e}"))?
        .join("game-videos");
    std::fs::create_dir_all(&dir).map_err(|e| format!("cache dir: {e}"))?;
    Ok(dir)
}

/// A path inside the cache dir (canonicalised, so `..` and symlinks can't escape it).
fn checked_cache_path(app: &tauri::AppHandle, path: &str) -> Result<PathBuf, String> {
    crate::resolve_within(path, &cache_dir(app)?)
}

fn valid_match_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// Where a game's copy lives in the cache, finished or not yet made.
#[tauri::command]
pub async fn game_video_cache_path(app: tauri::AppHandle, match_id: String) -> Result<String, String> {
    if !valid_match_id(&match_id) {
        return Err("game_video_cache_path: invalid match id".into());
    }
    Ok(cache_dir(&app)?.join(format!("{match_id}.mp4")).to_string_lossy().into_owned())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    pub size_bytes: u64,
    pub modified_ms: u64,
}

/// Size and age of a file in the cache; None when there is none.
#[tauri::command]
pub async fn game_video_file_info(app: tauri::AppHandle, path: String) -> Result<Option<FileInfo>, String> {
    // A missing file can't be canonicalised: that is "none", not an error.
    let Ok(p) = checked_cache_path(&app, &path) else { return Ok(None) };
    let Ok(meta) = std::fs::metadata(&p) else { return Ok(None) };
    if !meta.is_file() {
        return Ok(None);
    }
    let modified_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Ok(Some(FileInfo { size_bytes: meta.len(), modified_ms }))
}

/// Deletes a copy from the cache (uploaded, or given up on).
#[tauri::command]
pub async fn game_video_delete_cached(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let p = checked_cache_path(&app, &path)?;
    std::fs::remove_file(p).map_err(|e| e.to_string())
}

/// Deletes copies older than `max_age_days`: an upload that never finished.
/// R2 drops its multipart upload after seven days anyway, so the copy would
/// have to be made again. Returns how many files went.
#[tauri::command]
pub async fn game_video_prune_cache(app: tauri::AppHandle, max_age_days: u64) -> Result<usize, String> {
    let dir = cache_dir(&app)?;
    let cutoff = std::time::SystemTime::now()
        .checked_sub(Duration::from_secs(max_age_days.saturating_mul(86_400)))
        .unwrap_or(std::time::UNIX_EPOCH);
    let mut removed = 0;
    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        let old = meta.modified().map(|t| t < cutoff).unwrap_or(false);
        if old && std::fs::remove_file(entry.path()).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}

// ---------------------------------------------------------------------------
// The 720p copy
// ---------------------------------------------------------------------------

/// The ffmpeg arguments for the copy: the whole file, 720p at most (never
/// upscaled), libx264 veryfast (the fastest encoder we have on every
/// platform, 27x real time on an M-series Mac), a keyframe every two seconds
/// so seeks over the network land quickly, AAC stereo, faststart so the
/// browser can start before the file has downloaded, and ffmpeg's progress
/// on stdout.
pub fn transcode_args(input: &str, output: &Path, scale_down: bool) -> Vec<String> {
    let mut args: Vec<String> = [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostats",
        "-progress",
        "pipe:1",
        "-i",
        input,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
    ]
    .into_iter()
    .map(String::from)
    .collect();
    if scale_down {
        args.extend(["-vf", "scale=-2:720"].into_iter().map(String::from));
    }
    args.extend(
        [
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "23",
            "-maxrate",
            "3500k",
            "-bufsize",
            "7000k",
            "-pix_fmt",
            "yuv420p",
            "-force_key_frames",
            "expr:gte(t,n_forced*2)",
            "-sc_threshold",
            "0",
            "-c:a",
            "aac",
            "-b:a",
            "96k",
            "-ac",
            "2",
            "-movflags",
            "+faststart",
        ]
        .into_iter()
        .map(String::from),
    );
    args.push(output.to_string_lossy().into_owned());
    args
}

/// Microseconds encoded so far, from one line of `-progress` output. ffmpeg
/// prints `out_time_us=…` and, in older builds, `out_time_ms=…`, which is
/// microseconds too despite the name. `N/A` and other lines give None.
pub fn parse_progress_us(line: &str) -> Option<u64> {
    let (key, value) = line.trim().split_once('=')?;
    if key != "out_time_us" && key != "out_time_ms" {
        return None;
    }
    value.trim().parse::<i64>().ok().filter(|v| *v >= 0).map(|v| v as u64)
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressEvent<'a> {
    id: &'a str,
    phase: &'a str,
    fraction: f64,
}

/// Best effort: progress must never fail the job.
fn emit_progress(app: &tauri::AppHandle, id: &str, phase: &'static str, fraction: f64) {
    use tauri::Emitter;
    if let Err(e) = app.emit_to("main", "game-video-progress", ProgressEvent { id, phase, fraction }) {
        eprintln!("[game-video] failed to emit progress ({phase} {fraction:.3}): {e}");
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscodeResult {
    pub size_bytes: u64,
    pub width: u32,
    pub height: u32,
    pub duration_ms: u64,
}

/// Runs ffmpeg under the job, following `-progress` on stdout. Ok(true) when
/// it exited cleanly, Ok(false) with stderr when it failed, Err when stopped.
async fn run_transcode(
    app: &tauri::AppHandle,
    args: &[String],
    job: &JobHandle,
    job_id: &str,
    source_duration_ms: u64,
) -> Result<(bool, String), String> {
    use tauri_plugin_shell::process::CommandEvent;
    use tauri_plugin_shell::ShellExt;

    if job.is_cancelled() {
        return Err(EXPORT_CANCELLED.into());
    }
    let (mut rx, child) = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| e.to_string())?
        .args(args)
        .spawn()
        .map_err(crate::sidecar_error)?;
    job.attach(Box::new(child));

    let total_us = (source_duration_ms.max(1) as f64) * 1000.0;
    let mut last_emitted = -1.0f64;
    let mut code = None;
    let mut stderr = Vec::new();
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Terminated(payload) => code = payload.code,
            CommandEvent::Stderr(line) => {
                stderr.extend(line);
                stderr.push(b'\n');
            }
            CommandEvent::Stdout(line) => {
                if let Some(us) = parse_progress_us(&String::from_utf8_lossy(&line)) {
                    let fraction = ((us as f64) / total_us).clamp(0.0, 0.999);
                    // ffmpeg reports twice a second; the UI needs far less.
                    if fraction - last_emitted >= 0.002 {
                        last_emitted = fraction;
                        emit_progress(app, job_id, "encoding", fraction);
                    }
                }
            }
            _ => {}
        }
    }
    job.detach();
    if job.is_cancelled() {
        return Err(EXPORT_CANCELLED.into());
    }
    Ok((code == Some(0), String::from_utf8_lossy(&stderr).into_owned()))
}

/// Reads a file's duration and size through ffmpeg's banner, as probe_video does.
async fn probe_file(app: &tauri::AppHandle, path: &Path) -> Result<(u64, u32, u32), String> {
    let (_, stderr, _) = crate::video_frames::run_ffmpeg_capture(
        app,
        &["-hide_banner".into(), "-i".into(), path.to_string_lossy().into_owned()],
    )
    .await?;
    let probe = parse_ffmpeg_probe(&stderr).ok_or_else(|| "transcode: could not read the copy".to_string())?;
    Ok((probe.duration_ms, probe.width, probe.height))
}

/// Makes the 720p copy of `input` at `output` (a path from
/// game_video_cache_path). Writes a hidden partial file and renames it only
/// when ffmpeg finished, so a copy that exists in the cache is always a
/// finished encode, then checks the copy's length against the source.
#[tauri::command]
pub async fn transcode_game_video(
    app: tauri::AppHandle,
    jobs: tauri::State<'_, Arc<ExportJobs>>,
    input: String,
    output: String,
    source_duration_ms: u64,
    source_height: u32,
    job_id: String,
) -> Result<TranscodeResult, String> {
    let input = checked_video_path(&input)?;
    let out_path = PathBuf::from(&output);
    let dir = cache_dir(&app)?.canonicalize().map_err(|e| e.to_string())?;
    let parent = out_path
        .parent()
        .ok_or_else(|| "transcode: bad output path".to_string())?
        .canonicalize()
        .map_err(|e| format!("transcode: {e}"))?;
    if parent != dir || out_path.extension().and_then(|e| e.to_str()) != Some("mp4") {
        return Err("transcode: the copy must be an .mp4 in the game-videos cache".into());
    }

    let job = ExportJobs::begin(&jobs, &job_id);
    let partial = partial_output_path(&out_path);
    let _ = std::fs::remove_file(&partial);
    job.own(&partial);
    let args = transcode_args(&input, &partial, source_height > 720);
    emit_progress(&app, &job_id, "encoding", 0.0);
    let (ok, stderr) = match run_transcode(&app, &args, &job, &job_id, source_duration_ms).await {
        Ok(r) => r,
        Err(e) => {
            let _ = std::fs::remove_file(&partial);
            return Err(e);
        }
    };
    if !ok {
        let _ = std::fs::remove_file(&partial);
        let tail: String = stderr.lines().rev().take(5).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n");
        return Err(format!("ffmpeg failed: {tail}"));
    }
    std::fs::rename(&partial, &out_path).map_err(|e| format!("transcode: {e}"))?;

    let (duration_ms, width, height) = match probe_file(&app, &out_path).await {
        Ok(p) => p,
        Err(e) => {
            let _ = std::fs::remove_file(&out_path);
            return Err(e);
        }
    };
    if duration_ms.abs_diff(source_duration_ms) > DURATION_TOLERANCE_MS {
        let _ = std::fs::remove_file(&out_path);
        return Err(format!(
            "transcode_incomplete: the copy is {duration_ms} ms, the source {source_duration_ms} ms"
        ));
    }
    let size_bytes = std::fs::metadata(&out_path).map_err(|e| e.to_string())?.len();
    emit_progress(&app, &job_id, "encoding", 1.0);
    Ok(TranscodeResult { size_bytes, width, height, duration_ms })
}

// ---------------------------------------------------------------------------
// Part uploads
// ---------------------------------------------------------------------------

/// A running request, stopped by aborting its task.
struct AbortOnKill(tokio::task::AbortHandle);

impl Killable for AbortOnKill {
    fn kill(self: Box<Self>) {
        self.0.abort();
    }
}

static HTTP: OnceLock<reqwest::Client> = OnceLock::new();

fn http() -> &'static reqwest::Client {
    HTTP.get_or_init(|| {
        reqwest::Client::builder()
            // A 32 MiB part on a slow uplink; the webview retries on failure.
            .timeout(Duration::from_secs(20 * 60))
            .connect_timeout(Duration::from_secs(30))
            .build()
            .expect("reqwest client")
    })
}

/// PUTs bytes `offset..offset+length` of a cached copy to a presigned part
/// URL and returns the part's ETag (bare, without quotes). A non-2xx answer
/// is `upload_status_<code>`, so the webview can tell an expired URL (403)
/// from a failed connection and sign the part again.
#[tauri::command]
pub async fn game_video_upload_part(
    app: tauri::AppHandle,
    jobs: tauri::State<'_, Arc<ExportJobs>>,
    path: String,
    offset: u64,
    length: u64,
    url: String,
    job_id: String,
) -> Result<String, String> {
    let p = checked_cache_path(&app, &path)?;
    if !url.starts_with("https://") {
        return Err("upload_part: the part URL must be https".into());
    }
    if length == 0 || length > MAX_PART_BYTES {
        return Err("upload_part: part length out of range".into());
    }

    let bytes = tokio::task::spawn_blocking(move || -> Result<Vec<u8>, String> {
        let mut file = std::fs::File::open(&p).map_err(|e| e.to_string())?;
        file.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
        let mut buf = Vec::with_capacity(length as usize);
        file.take(length).read_to_end(&mut buf).map_err(|e| e.to_string())?;
        if buf.len() as u64 != length {
            return Err(format!("upload_part: short read, {} of {length} bytes", buf.len()));
        }
        Ok(buf)
    })
    .await
    .map_err(|e| e.to_string())??;

    let job = ExportJobs::begin(&jobs, &job_id);
    if job.is_cancelled() {
        return Err(EXPORT_CANCELLED.into());
    }
    let request = http().put(&url).header(reqwest::header::CONTENT_LENGTH, length).body(bytes);
    let task = tokio::spawn(async move { request.send().await });
    job.attach(Box::new(AbortOnKill(task.abort_handle())));
    let response = match task.await {
        Err(e) if e.is_cancelled() => return Err(EXPORT_CANCELLED.into()),
        Err(e) => return Err(format!("upload_part: {e}")),
        Ok(Err(e)) => {
            job.detach();
            if job.is_cancelled() {
                return Err(EXPORT_CANCELLED.into());
            }
            return Err(format!("upload_part: {e}"));
        }
        Ok(Ok(r)) => r,
    };
    job.detach();
    if job.is_cancelled() {
        return Err(EXPORT_CANCELLED.into());
    }
    let status = response.status();
    if !status.is_success() {
        return Err(format!("upload_status_{}", status.as_u16()));
    }
    response
        .headers()
        .get(reqwest::header::ETAG)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim().trim_matches('"').to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "upload_part: no ETag in the answer".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transcode_args_make_a_720p_faststart_copy_with_progress_on_stdout() {
        let args = transcode_args("/Users/coach/Movies/game.mp4", Path::new("/cache/.m1.scoutable-partial.mp4"), true);
        let joined = args.join(" ");
        assert!(joined.starts_with("-y -hide_banner -loglevel error -nostats -progress pipe:1 -i /Users/coach/Movies/game.mp4"));
        assert!(joined.contains("-map 0:v:0 -map 0:a:0? -vf scale=-2:720 -c:v libx264 -preset veryfast -crf 23"));
        assert!(joined.contains("-force_key_frames expr:gte(t,n_forced*2) -sc_threshold 0"));
        assert!(joined.contains("-c:a aac -b:a 96k -ac 2 -movflags +faststart"));
        assert_eq!(args.last().map(String::as_str), Some("/cache/.m1.scoutable-partial.mp4"));
    }

    #[test]
    fn a_source_at_or_below_720p_is_not_scaled() {
        let args = transcode_args("in.mp4", Path::new("out.mp4"), false);
        assert!(!args.iter().any(|a| a == "-vf"));
        assert!(!args.iter().any(|a| a.starts_with("scale=")));
    }

    #[test]
    fn progress_lines_give_microseconds_and_nothing_else_does() {
        assert_eq!(parse_progress_us("out_time_us=1500000"), Some(1_500_000));
        assert_eq!(parse_progress_us("out_time_ms=1500000\n"), Some(1_500_000));
        assert_eq!(parse_progress_us("out_time_us=N/A"), None);
        assert_eq!(parse_progress_us("out_time_us=-1"), None);
        assert_eq!(parse_progress_us("frame=120"), None);
        assert_eq!(parse_progress_us("progress=end"), None);
        assert_eq!(parse_progress_us("garbage"), None);
    }

    #[test]
    fn match_ids_are_plain() {
        assert!(valid_match_id("2583394"));
        assert!(valid_match_id("demo-5dc28ee0-0186-4ca5-9e8d-9023d4794a92"));
        assert!(!valid_match_id(""));
        assert!(!valid_match_id("../etc"));
        assert!(!valid_match_id("a/b"));
    }
}
