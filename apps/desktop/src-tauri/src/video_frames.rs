//! Frame access for the user's own game videos through the ffmpeg sidecar:
//! `probe_video` (duration, size, fps) and `grab_frames` (JPEGs at given
//! seconds, a 1-fps range from one decode run, or 9×8 grey thumbnails for the
//! recording fingerprint). The webview already streams these files over
//! `stream://`, so the only path guard is "a regular file with a video
//! extension" — the temp-dir confinement of `extract_poster_frame` does not
//! apply here.

use base64::Engine;
use serde::{Deserialize, Serialize};

const VIDEO_EXTENSIONS: [&str; 6] = ["mp4", "mov", "avi", "mkv", "webm", "m4v"];
const MAX_TIMES: usize = 64;
const MAX_RANGE_SECONDS: f64 = 120.0;
const MAX_RANGE_FPS: f64 = 4.0;
const MIN_WIDTH: u32 = 64;
const MAX_WIDTH: u32 = 1920;
const MAX_THUMB_SIDE: u32 = 64;

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VideoProbe {
    pub duration_ms: u64,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
}

#[derive(Deserialize, Clone, Copy, Debug)]
pub struct CropBox {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Deserialize, Debug)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FrameAt {
    Times { times: Vec<f64> },
    Range { start: f64, duration: f64, fps: f64 },
}

#[derive(Deserialize, Debug)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FrameOutput {
    Jpeg { width: u32, quality: u8, crop: Option<CropBox> },
    GrayThumb { width: u32, height: u32 },
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FrameGrabRequest {
    pub path: String,
    pub at: FrameAt,
    pub output: FrameOutput,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GrabbedFrame {
    pub t: f64,
    pub data_base64: String,
    pub width: u32,
    pub height: u32,
}

/// `Duration: 01:58:32.46, …` and `Stream #0:0 … Video: h264 …, 1920x1080 [SAR …], 25 fps, …` from `ffmpeg -i` stderr.
pub fn parse_ffmpeg_probe(stderr: &str) -> Option<VideoProbe> {
    let dur_line = stderr.lines().find(|l| l.trim_start().starts_with("Duration:"))?;
    let dur_text = dur_line.trim_start().trim_start_matches("Duration:").trim();
    let dur_text = dur_text.split(',').next()?.trim();
    let mut parts = dur_text.split(':');
    let h: f64 = parts.next()?.parse().ok()?;
    let m: f64 = parts.next()?.parse().ok()?;
    let s: f64 = parts.next()?.parse().ok()?;
    let duration_ms = ((h * 3600.0 + m * 60.0 + s) * 1000.0).round() as u64;

    let mut width = 0u32;
    let mut height = 0u32;
    let mut fps = 0f64;
    if let Some(video_line) = stderr.lines().find(|l| l.contains("Video:")) {
        for raw in video_line.split(',') {
            let token = raw.trim();
            if width == 0 {
                if let Some((w, rest)) = token.split_once('x') {
                    let h_part: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
                    if let (Ok(w), Ok(h)) = (w.parse::<u32>(), h_part.parse::<u32>()) {
                        if w >= 16 && h >= 16 {
                            width = w;
                            height = h;
                        }
                    }
                }
            }
            if fps == 0.0 {
                if let Some(num) = token.strip_suffix(" fps") {
                    if let Ok(v) = num.trim().parse::<f64>() {
                        fps = v;
                    }
                }
            }
        }
    }
    Some(VideoProbe { duration_ms, width, height, fps })
}

/// Split a concatenated MJPEG stream on SOI markers (FF D8 FF). A trailing partial image is kept as-is.
pub fn split_mjpeg_stream(buf: &[u8]) -> Vec<&[u8]> {
    let mut out = Vec::new();
    let mut start: Option<usize> = None;
    let mut i = 0;
    while i + 2 < buf.len() {
        if buf[i] == 0xFF && buf[i + 1] == 0xD8 && buf[i + 2] == 0xFF {
            if let Some(s) = start {
                out.push(&buf[s..i]);
            }
            start = Some(i);
            i += 3;
        } else {
            i += 1;
        }
    }
    if let Some(s) = start {
        out.push(&buf[s..]);
    }
    out
}

/// The `-vf` chain: optional `fps=`, optional crop (fractions of the source), then a width-preserving scale.
pub fn video_filter(fps: Option<f64>, crop: Option<CropBox>, width: u32) -> String {
    let mut parts: Vec<String> = Vec::new();
    if let Some(f) = fps {
        parts.push(format!("fps={f}"));
    }
    if let Some(c) = crop {
        parts.push(format!("crop=iw*{:.4}:ih*{:.4}:iw*{:.4}:ih*{:.4}", c.w, c.h, c.x, c.y));
    }
    parts.push(format!("scale={width}:-2"));
    parts.join(",")
}

fn valid_crop(c: &CropBox) -> bool {
    let fin = [c.x, c.y, c.w, c.h].iter().all(|v| v.is_finite());
    fin && c.x >= 0.0 && c.y >= 0.0 && c.w > 0.0 && c.h > 0.0 && c.x + c.w <= 1.0 + 1e-9 && c.y + c.h <= 1.0 + 1e-9
}

pub fn validate_request(req: &FrameGrabRequest) -> Result<(), String> {
    match &req.at {
        FrameAt::Times { times } => {
            if times.is_empty() || times.len() > MAX_TIMES {
                return Err(format!("grab_frames: between 1 and {MAX_TIMES} times"));
            }
            if times.iter().any(|t| !t.is_finite() || *t < 0.0) {
                return Err("grab_frames: times must be non-negative".into());
            }
        }
        FrameAt::Range { start, duration, fps } => {
            if !start.is_finite() || *start < 0.0 {
                return Err("grab_frames: range start must be non-negative".into());
            }
            if !duration.is_finite() || *duration <= 0.0 || *duration > MAX_RANGE_SECONDS {
                return Err(format!("grab_frames: range duration must be within {MAX_RANGE_SECONDS} s"));
            }
            if !fps.is_finite() || *fps <= 0.0 || *fps > MAX_RANGE_FPS {
                return Err(format!("grab_frames: range fps must be within {MAX_RANGE_FPS}"));
            }
        }
    }
    match &req.output {
        FrameOutput::Jpeg { width, quality, crop } => {
            if *width < MIN_WIDTH || *width > MAX_WIDTH {
                return Err(format!("grab_frames: width must be {MIN_WIDTH}..={MAX_WIDTH}"));
            }
            if *quality < 1 || *quality > 31 {
                return Err("grab_frames: quality must be 1..=31".into());
            }
            if let Some(c) = crop {
                if !valid_crop(c) {
                    return Err("grab_frames: crop must lie inside the frame".into());
                }
            }
        }
        FrameOutput::GrayThumb { width, height } => {
            if *width == 0 || *height == 0 || *width > MAX_THUMB_SIDE || *height > MAX_THUMB_SIDE {
                return Err(format!("grab_frames: thumbnail sides must be 1..={MAX_THUMB_SIDE}"));
            }
        }
    }
    Ok(())
}

pub fn is_video_file(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .map(|e| VIDEO_EXTENSIONS.contains(&e.as_str()))
        .unwrap_or(false)
}

fn checked_video_path(path: &str) -> Result<String, String> {
    let p = std::path::Path::new(path);
    if !is_video_file(p) {
        return Err("video: not a video file".into());
    }
    let meta = std::fs::metadata(p).map_err(|e| format!("video: {e}"))?;
    if !meta.is_file() {
        return Err("video: not a regular file".into());
    }
    Ok(p.to_string_lossy().to_string())
}

fn encode_base64(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

async fn run_ffmpeg(app: &tauri::AppHandle, args: &[String]) -> Result<(Vec<u8>, String, bool), String> {
    use tauri_plugin_shell::ShellExt;
    // Raw stdout: the shell plugin otherwise splits output into lines and
    // appends a newline to each, which corrupts binary frames (a 9×8 grey
    // thumbnail came back as 73 bytes instead of 72).
    let out = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| e.to_string())?
        .args(args)
        .set_raw_out(true)
        .output()
        .await
        .map_err(|e| e.to_string())?;
    Ok((out.stdout, String::from_utf8_lossy(&out.stderr).to_string(), out.status.success()))
}

#[tauri::command]
pub async fn probe_video(app: tauri::AppHandle, path: String) -> Result<VideoProbe, String> {
    let video = checked_video_path(&path)?;
    // ffmpeg exits 1 without an output file; the stream info is on stderr regardless.
    let (_, stderr, _) = run_ffmpeg(&app, &["-hide_banner".into(), "-i".into(), video]).await?;
    parse_ffmpeg_probe(&stderr).ok_or_else(|| "probe_video: could not read the video".to_string())
}

/// Dimensions from the JPEG's SOF marker, so callers know what the model will see.
fn jpeg_size(buf: &[u8]) -> (u32, u32) {
    let mut i = 2usize;
    while i + 9 < buf.len() {
        if buf[i] != 0xFF {
            i += 1;
            continue;
        }
        let marker = buf[i + 1];
        let is_sof = (0xC0..=0xCF).contains(&marker) && marker != 0xC4 && marker != 0xC8 && marker != 0xCC;
        if is_sof {
            let h = u16::from_be_bytes([buf[i + 5], buf[i + 6]]) as u32;
            let w = u16::from_be_bytes([buf[i + 7], buf[i + 8]]) as u32;
            return (w, h);
        }
        let len = u16::from_be_bytes([buf[i + 2], buf[i + 3]]) as usize;
        i += 2 + len;
    }
    (0, 0)
}

#[tauri::command]
pub async fn grab_frames(app: tauri::AppHandle, req: FrameGrabRequest) -> Result<Vec<GrabbedFrame>, String> {
    validate_request(&req)?;
    let video = checked_video_path(&req.path)?;
    let mut frames = Vec::new();

    match (&req.at, &req.output) {
        (FrameAt::Times { times }, FrameOutput::Jpeg { width, quality, crop }) => {
            let vf = video_filter(None, *crop, *width);
            for t in times {
                let args: Vec<String> = [
                    "-hide_banner", "-loglevel", "error", "-ss", &format!("{t:.3}"), "-i", &video,
                    "-frames:v", "1", "-vf", &vf, "-f", "image2pipe", "-c:v", "mjpeg", "-q:v", &quality.to_string(), "-",
                ]
                .iter()
                .map(|s| s.to_string())
                .collect();
                let (stdout, stderr, ok) = run_ffmpeg(&app, &args).await?;
                if !ok || stdout.is_empty() {
                    return Err(format!("grab_frames: no frame at {t:.1}s: {}", stderr.trim()));
                }
                let (w, h) = jpeg_size(&stdout);
                frames.push(GrabbedFrame { t: *t, data_base64: encode_base64(&stdout), width: w, height: h });
            }
        }
        (FrameAt::Range { start, duration, fps }, FrameOutput::Jpeg { width, quality, crop }) => {
            let vf = video_filter(Some(*fps), *crop, *width);
            let args: Vec<String> = [
                "-hide_banner", "-loglevel", "error", "-ss", &format!("{start:.3}"), "-t", &format!("{duration:.3}"), "-i", &video,
                "-vf", &vf, "-f", "image2pipe", "-c:v", "mjpeg", "-q:v", &quality.to_string(), "-",
            ]
            .iter()
            .map(|s| s.to_string())
            .collect();
            let (stdout, stderr, ok) = run_ffmpeg(&app, &args).await?;
            if !ok {
                return Err(format!("grab_frames: range failed: {}", stderr.trim()));
            }
            for (i, jpeg) in split_mjpeg_stream(&stdout).into_iter().enumerate() {
                let (w, h) = jpeg_size(jpeg);
                frames.push(GrabbedFrame { t: start + i as f64 / fps, data_base64: encode_base64(jpeg), width: w, height: h });
            }
        }
        (FrameAt::Times { times }, FrameOutput::GrayThumb { width, height }) => {
            let vf = format!("scale={width}:{height}:flags=area,format=gray");
            let expected = (*width as usize) * (*height as usize);
            for t in times {
                let args: Vec<String> = [
                    "-hide_banner", "-loglevel", "error", "-ss", &format!("{t:.3}"), "-i", &video,
                    "-frames:v", "1", "-vf", &vf, "-f", "rawvideo", "-pix_fmt", "gray", "-",
                ]
                .iter()
                .map(|s| s.to_string())
                .collect();
                let (stdout, stderr, ok) = run_ffmpeg(&app, &args).await?;
                if !ok || stdout.len() != expected {
                    return Err(format!("grab_frames: no thumbnail at {t:.1}s ({} bytes): {}", stdout.len(), stderr.trim()));
                }
                frames.push(GrabbedFrame { t: *t, data_base64: encode_base64(&stdout), width: *width, height: *height });
            }
        }
        (FrameAt::Range { .. }, FrameOutput::GrayThumb { .. }) => {
            return Err("grab_frames: thumbnails are grabbed at explicit times".into());
        }
    }
    Ok(frames)
}

#[cfg(test)]
mod tests {
    use super::*;

    const STDERR_50FPS: &str = "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'x.mp4':\n  Duration: 02:35:01.21, start: 0.000000, bitrate: 4763 kb/s\n  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 1920x1080 [SAR 1:1 DAR 16:9], 4631 kb/s, 50 fps, 50 tbr, 12800 tbn (default)\n  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 128 kb/s (default)\n";
    const STDERR_30FPS: &str = "  Duration: 01:58:32.46, start: 0.000000, bitrate: 504 kb/s\n  Stream #0:0[0x1](und): Video: h264 (Main) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 640x360 [SAR 1:1 DAR 16:9], 404 kb/s, 30 fps, 30 tbr, 15360 tbn (default)\n";
    const STDERR_FRACTIONAL: &str = "  Duration: 00:00:20.02, start: 0.000000, bitrate: 1 kb/s\n  Stream #0:0: Video: h264, yuv420p, 1280x720, 29.97 fps, 29.97 tbr\n";

    #[test]
    fn parses_duration_size_and_fps() {
        assert_eq!(
            parse_ffmpeg_probe(STDERR_50FPS),
            Some(VideoProbe { duration_ms: 9_301_210, width: 1920, height: 1080, fps: 50.0 })
        );
        assert_eq!(
            parse_ffmpeg_probe(STDERR_30FPS),
            Some(VideoProbe { duration_ms: 7_112_460, width: 640, height: 360, fps: 30.0 })
        );
        let p = parse_ffmpeg_probe(STDERR_FRACTIONAL).unwrap();
        assert_eq!((p.width, p.height, p.duration_ms), (1280, 720, 20_020));
        assert!((p.fps - 29.97).abs() < 1e-9);
    }

    #[test]
    fn probe_needs_a_duration() {
        assert_eq!(parse_ffmpeg_probe("x.mp4: No such file or directory\n"), None);
    }

    #[test]
    fn splits_mjpeg_on_soi_markers() {
        let a = [0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 0xFF, 0xD9];
        let b = [0xFF, 0xD8, 0xFF, 0xDB, 9, 0xFF, 0xD9];
        let mut buf = Vec::new();
        buf.extend_from_slice(&a);
        buf.extend_from_slice(&b);
        let parts = split_mjpeg_stream(&buf);
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[0], &a[..]);
        assert_eq!(parts[1], &b[..]);
        assert!(split_mjpeg_stream(&[1, 2, 3]).is_empty());
    }

    #[test]
    fn builds_the_filter_chain() {
        assert_eq!(video_filter(None, None, 640), "scale=640:-2");
        assert_eq!(
            video_filter(Some(1.0), Some(CropBox { x: 0.2, y: 0.84, w: 0.6, h: 0.16 }), 640),
            "fps=1,crop=iw*0.6000:ih*0.1600:iw*0.2000:ih*0.8400,scale=640:-2"
        );
    }

    fn req(at: FrameAt, output: FrameOutput) -> FrameGrabRequest {
        FrameGrabRequest { path: "/tmp/x.mp4".into(), at, output }
    }

    #[test]
    fn validates_request_bounds() {
        let jpeg = || FrameOutput::Jpeg { width: 640, quality: 4, crop: None };
        assert!(validate_request(&req(FrameAt::Times { times: vec![0.0, 5.0] }, jpeg())).is_ok());
        assert!(validate_request(&req(FrameAt::Times { times: vec![] }, jpeg())).is_err());
        assert!(validate_request(&req(FrameAt::Times { times: vec![1.0; MAX_TIMES + 1] }, jpeg())).is_err());
        assert!(validate_request(&req(FrameAt::Times { times: vec![-1.0] }, jpeg())).is_err());
        assert!(validate_request(&req(FrameAt::Range { start: 10.0, duration: 34.0, fps: 1.0 }, jpeg())).is_ok());
        assert!(validate_request(&req(FrameAt::Range { start: 10.0, duration: 500.0, fps: 1.0 }, jpeg())).is_err());
        assert!(validate_request(&req(FrameAt::Range { start: 10.0, duration: 10.0, fps: 10.0 }, jpeg())).is_err());
        assert!(validate_request(&req(FrameAt::Times { times: vec![0.0] }, FrameOutput::Jpeg { width: 10, quality: 4, crop: None })).is_err());
        assert!(validate_request(&req(FrameAt::Times { times: vec![0.0] }, FrameOutput::Jpeg { width: 640, quality: 4, crop: Some(CropBox { x: 0.5, y: 0.5, w: 0.6, h: 0.1 }) })).is_err());
        assert!(validate_request(&req(FrameAt::Times { times: vec![0.0] }, FrameOutput::GrayThumb { width: 9, height: 8 })).is_ok());
        assert!(validate_request(&req(FrameAt::Times { times: vec![0.0] }, FrameOutput::GrayThumb { width: 9000, height: 8 })).is_err());
    }

    #[test]
    fn recognises_video_files_by_extension() {
        assert!(is_video_file(std::path::Path::new("/a/b/Game.MP4")));
        assert!(!is_video_file(std::path::Path::new("/a/b/notes.txt")));
        assert!(!is_video_file(std::path::Path::new("/a/b/noext")));
    }

    #[test]
    fn reads_jpeg_dimensions_from_the_sof_marker() {
        // SOI, APP0 (len 4), SOF0 (len 11: precision, height 96, width 640, 1 component)
        let jpeg = [
            0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x04, 0x00, 0x00,
            0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x60, 0x02, 0x80, 0x01, 0x01, 0x11, 0x00,
        ];
        assert_eq!(jpeg_size(&jpeg), (640, 96));
    }
}
