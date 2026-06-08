use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize)]
pub struct AppMetricSnapshot {
    pub timestamp_ms: u128,
    pub process_id: u32,
}

pub fn snapshot() -> AppMetricSnapshot {
    let timestamp_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time before unix epoch")
        .as_millis();

    AppMetricSnapshot {
        timestamp_ms,
        process_id: std::process::id(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_includes_process_id() {
        let value = snapshot();

        assert!(value.process_id > 0);
    }
}
