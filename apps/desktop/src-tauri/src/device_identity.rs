//! Hardware device identity for the anti-sharing device registry.
//!
//! The machine id (macOS IOPlatformUUID / Windows MachineGuid / Linux
//! /etc/machine-id) is hashed HERE, in Rust, so the raw identifier never
//! crosses into the webview. The `scoutable-hwid-v1|` domain prefix means the
//! same MachineGuid hashes differently for any other app, and normalization
//! (trim + lowercase) pins stability against cosmetic changes in the source.
//! The server salts this hash again per user before storing, so the value we
//! send is never persisted as-is either.

use sha2::{Digest, Sha256};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceIdentity {
    /// "dt:" + lowercase hex sha256 — the transport prefix keeps desktop,
    /// iOS ("ios:") and Android ("and:") values collision-proof inside the
    /// server's single hash namespace.
    pub hardware_id: String,
    /// Cleaned hostname ("Leonards MacBook Pro") for the device list label;
    /// None when unavailable.
    pub host_name: Option<String>,
}

fn hash_machine_id(raw: &str) -> String {
    let normalized = raw.trim().to_lowercase();
    let digest = Sha256::digest(format!("scoutable-hwid-v1|{normalized}").as_bytes());
    format!("dt:{digest:x}")
}

fn clean_hostname(raw: &str) -> Option<String> {
    let cleaned = raw
        .trim()
        .trim_end_matches(".local")
        .replace('-', " ")
        .trim()
        .to_string();
    if cleaned.is_empty() {
        None
    } else {
        Some(cleaned)
    }
}

#[tauri::command]
pub fn get_device_identity() -> Result<DeviceIdentity, String> {
    let machine_id = machine_uid::get().map_err(|e| format!("machine id unavailable: {e}"))?;
    if machine_id.trim().is_empty() {
        return Err("machine id empty".into());
    }
    let host_name = hostname::get()
        .ok()
        .and_then(|h| clean_hostname(&h.to_string_lossy()));
    Ok(DeviceIdentity {
        hardware_id: hash_machine_id(&machine_id),
        host_name,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_is_domain_separated_and_normalized() {
        // Golden: pins the prefix + normalization; a change here silently
        // re-identifies every desktop install, so it must be deliberate.
        let h = hash_machine_id("  ABC-123  ");
        assert_eq!(h, hash_machine_id("abc-123"));
        assert!(h.starts_with("dt:"));
        assert_eq!(h.len(), 3 + 64);
        assert_eq!(
            h,
            "dt:803b37fc5844b10e27b33f96d83276db73dd2aba64ac9219d6f011fc2016f55c"
        );
    }

    #[test]
    fn hostname_cleanup() {
        assert_eq!(
            clean_hostname("Leonards-MacBook-Pro.local"),
            Some("Leonards MacBook Pro".to_string())
        );
        assert_eq!(clean_hostname("studio"), Some("studio".to_string()));
        assert_eq!(clean_hostname(""), None);
        assert_eq!(clean_hostname(".local"), None);
    }
}
