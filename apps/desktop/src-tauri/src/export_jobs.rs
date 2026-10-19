//! Running exports, so they can be stopped part-way.
//!
//! An export renders segment after segment through the ffmpeg sidecar. Each
//! export runs under an id the webview chose (its progress id); the registry
//! keeps that export's current ffmpeg process, so `cancel_export(id)` can stop
//! the render in the middle of a segment instead of after the whole timeline.
//! Rust-spawned sidecars are not tracked by the shell plugin, so quitting the
//! app also goes through here (`kill_all`), which also deletes the files the
//! export was writing: its own cleanup never runs when the process exits.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

/// The error an export returns when it was stopped on purpose. The webview
/// treats it as "nothing to report", never as a failure.
pub const EXPORT_CANCELLED: &str = "export_cancelled";

/// A running process that can be stopped: the ffmpeg child, or a fake in tests.
pub trait Killable: Send {
    fn kill(self: Box<Self>);
}

impl Killable for tauri_plugin_shell::process::CommandChild {
    fn kill(self: Box<Self>) {
        // Best effort: the process may already have exited.
        let _ = (*self).kill();
    }
}

#[derive(Default)]
struct Job {
    cancelled: bool,
    child: Option<Box<dyn Killable>>,
    /// Files to delete if the app quits mid-export.
    files: Vec<PathBuf>,
}

#[derive(Default)]
struct Inner {
    jobs: HashMap<String, Job>,
    /// Stop requests that arrived before their export registered (the
    /// webview can ask the moment it starts the call).
    early: HashSet<String>,
}

#[derive(Default)]
pub struct ExportJobs {
    inner: Mutex<Inner>,
}

impl ExportJobs {
    fn lock(&self) -> MutexGuard<'_, Inner> {
        // A panic while holding the lock leaves plain data behind; keep going.
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Registers an export. The returned handle unregisters it when dropped,
    /// however the export ends.
    pub fn begin(jobs: &Arc<Self>, id: &str) -> JobHandle {
        let mut inner = jobs.lock();
        let cancelled = inner.early.remove(id);
        inner.jobs.insert(id.to_string(), Job { cancelled, ..Job::default() });
        JobHandle { jobs: Arc::clone(jobs), id: id.to_string() }
    }

    /// Stops an export: marks it cancelled and kills its running process.
    /// Returns false when no such export is running (yet, or any more).
    pub fn cancel(&self, id: &str) -> bool {
        let mut inner = self.lock();
        match inner.jobs.get_mut(id) {
            Some(job) => {
                job.cancelled = true;
                if let Some(child) = job.child.take() {
                    child.kill();
                }
                true
            }
            None => {
                inner.early.insert(id.to_string());
                false
            }
        }
    }

    /// Stops every running export and deletes what it was writing (the app
    /// is quitting).
    pub fn kill_all(&self) {
        let mut inner = self.lock();
        for job in inner.jobs.values_mut() {
            job.cancelled = true;
            if let Some(child) = job.child.take() {
                child.kill();
            }
            for path in job.files.drain(..) {
                let _ = std::fs::remove_file(path);
            }
        }
    }

    #[cfg(test)]
    fn running(&self) -> usize {
        self.lock().jobs.len()
    }
}

/// One export's entry in the registry.
pub struct JobHandle {
    jobs: Arc<ExportJobs>,
    id: String,
}

impl JobHandle {
    pub fn is_cancelled(&self) -> bool {
        self.jobs.lock().jobs.get(&self.id).is_some_and(|j| j.cancelled)
    }

    /// Keeps the running process so a stop can reach it. If the export was
    /// stopped in the meantime, the process is killed at once.
    pub fn attach(&self, child: Box<dyn Killable>) {
        let mut inner = self.jobs.lock();
        match inner.jobs.get_mut(&self.id) {
            Some(job) if !job.cancelled => job.child = Some(child),
            _ => {
                drop(inner);
                child.kill();
            }
        }
    }

    /// A file this export writes, deleted if the app quits before the export
    /// ends. While the export runs, its own cleanup is the caller's.
    pub fn own(&self, path: &Path) {
        if let Some(job) = self.jobs.lock().jobs.get_mut(&self.id) {
            job.files.push(path.to_path_buf());
        }
    }

    /// The process ended on its own.
    pub fn detach(&self) {
        if let Some(job) = self.jobs.lock().jobs.get_mut(&self.id) {
            job.child = None;
        }
    }
}

impl Drop for JobHandle {
    fn drop(&mut self) {
        self.jobs.lock().jobs.remove(&self.id);
    }
}

/// Files an export creates along the way, deleted when it ends however it
/// ends (finished, failed part-way, or stopped), and by `kill_all` if the
/// app quits first.
pub struct TempFiles<'a> {
    paths: Vec<PathBuf>,
    job: Option<&'a JobHandle>,
}

impl<'a> TempFiles<'a> {
    pub fn new(job: Option<&'a JobHandle>) -> Self {
        TempFiles { paths: Vec::new(), job }
    }

    /// Tracks a path for deletion and hands it back.
    pub fn track(&mut self, path: PathBuf) -> PathBuf {
        if let Some(job) = self.job {
            job.own(&path);
        }
        self.paths.push(path.clone());
        path
    }
}

impl Drop for TempFiles<'_> {
    fn drop(&mut self) {
        for path in &self.paths {
            let _ = std::fs::remove_file(path);
        }
    }
}

/// Where the final pass writes before the result is moved into place: a
/// hidden file beside the target, so a stopped or failed export never
/// truncates or leaves a file at the path the user chose.
pub fn partial_output_path(output: &Path) -> PathBuf {
    let dir = output.parent().unwrap_or_else(|| Path::new("."));
    let stem = output
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "export".to_string());
    let ext = output
        .extension()
        .map(|e| e.to_string_lossy().into_owned())
        .unwrap_or_else(|| "mp4".to_string());
    dir.join(format!(".{stem}.scoutable-partial.{ext}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct FakeChild(Arc<AtomicUsize>);
    impl Killable for FakeChild {
        fn kill(self: Box<Self>) {
            self.0.fetch_add(1, Ordering::SeqCst);
        }
    }

    fn fake() -> (Box<dyn Killable>, Arc<AtomicUsize>) {
        let kills = Arc::new(AtomicUsize::new(0));
        (Box::new(FakeChild(Arc::clone(&kills))), kills)
    }

    #[test]
    fn cancel_kills_the_running_process_and_marks_the_job() {
        let jobs = Arc::new(ExportJobs::default());
        let handle = ExportJobs::begin(&jobs, "a");
        let (child, kills) = fake();
        handle.attach(child);
        assert!(!handle.is_cancelled());
        assert!(jobs.cancel("a"));
        assert!(handle.is_cancelled());
        assert_eq!(kills.load(Ordering::SeqCst), 1);
        // A second stop finds nothing left to kill.
        assert!(jobs.cancel("a"));
        assert_eq!(kills.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn a_process_started_after_the_stop_is_killed_on_attach() {
        let jobs = Arc::new(ExportJobs::default());
        let handle = ExportJobs::begin(&jobs, "a");
        assert!(jobs.cancel("a"));
        let (child, kills) = fake();
        handle.attach(child);
        assert_eq!(kills.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn a_stop_before_the_export_registers_still_applies() {
        let jobs = Arc::new(ExportJobs::default());
        assert!(!jobs.cancel("early"));
        let handle = ExportJobs::begin(&jobs, "early");
        assert!(handle.is_cancelled());
        // The early request is used up: a later export with another id runs.
        let other = ExportJobs::begin(&jobs, "other");
        assert!(!other.is_cancelled());
    }

    #[test]
    fn a_finished_process_is_not_killed_by_a_late_stop() {
        let jobs = Arc::new(ExportJobs::default());
        let handle = ExportJobs::begin(&jobs, "a");
        let (child, kills) = fake();
        handle.attach(child);
        handle.detach();
        assert!(jobs.cancel("a"));
        assert_eq!(kills.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn dropping_the_handle_unregisters_the_export() {
        let jobs = Arc::new(ExportJobs::default());
        {
            let _handle = ExportJobs::begin(&jobs, "a");
            assert_eq!(jobs.running(), 1);
        }
        assert_eq!(jobs.running(), 0);
    }

    #[test]
    fn kill_all_stops_every_export() {
        let jobs = Arc::new(ExportJobs::default());
        let a = ExportJobs::begin(&jobs, "a");
        let b = ExportJobs::begin(&jobs, "b");
        let (child_a, kills_a) = fake();
        let (child_b, kills_b) = fake();
        a.attach(child_a);
        b.attach(child_b);
        jobs.kill_all();
        assert!(a.is_cancelled() && b.is_cancelled());
        assert_eq!(kills_a.load(Ordering::SeqCst), 1);
        assert_eq!(kills_b.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn temp_files_are_deleted_when_dropped() {
        let dir = std::env::temp_dir().join(format!("sc_tempfiles_test_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let a = dir.join("a.mp4");
        let b = dir.join("b.png");
        {
            let mut temp = TempFiles::new(None);
            std::fs::write(temp.track(a.clone()), b"x").unwrap();
            std::fs::write(temp.track(b.clone()), b"y").unwrap();
            assert!(a.exists() && b.exists());
        }
        assert!(!a.exists() && !b.exists());
        let _ = std::fs::remove_dir(&dir);
    }

    #[test]
    fn quitting_deletes_the_files_a_running_export_owns() {
        let dir = std::env::temp_dir().join(format!("sc_killall_test_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let segment = dir.join("seg.mp4");
        let partial = dir.join(".out.scoutable-partial.mp4");
        let jobs = Arc::new(ExportJobs::default());
        let handle = ExportJobs::begin(&jobs, "a");
        let mut temp = TempFiles::new(Some(&handle));
        std::fs::write(temp.track(segment.clone()), b"x").unwrap();
        std::fs::write(temp.track(partial.clone()), b"y").unwrap();
        jobs.kill_all();
        // Deleted while the export's own guard is still alive, as at exit.
        assert!(!segment.exists() && !partial.exists());
        drop(temp);
        let _ = std::fs::remove_dir(&dir);
    }

    #[test]
    fn partial_output_sits_hidden_beside_the_target() {
        assert_eq!(
            partial_output_path(Path::new("/Users/coach/Movies/Defence_vertical.mp4")),
            PathBuf::from("/Users/coach/Movies/.Defence_vertical.scoutable-partial.mp4")
        );
        assert_eq!(
            partial_output_path(Path::new("clip")),
            PathBuf::from(".clip.scoutable-partial.mp4")
        );
    }
}
