use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    fs::{self, OpenOptions},
    io::{BufRead, BufReader, ErrorKind, Write},
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};

const MAX_LIST_LIMIT: usize = 10_000;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct DiagnosticEventInput {
    pub level: String,
    pub source: String,
    pub message: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct DiagnosticEvent {
    pub id: String,
    pub timestamp_ms: u128,
    pub level: String,
    pub source: String,
    pub message: String,
}

#[derive(Debug)]
pub struct DiagnosticsStore {
    path: PathBuf,
    sequence: AtomicU64,
}

impl DiagnosticsStore {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            sequence: AtomicU64::new(0),
        }
    }

    pub fn append(&self, input: DiagnosticEventInput) -> Result<DiagnosticEvent, String> {
        if let Some(parent) = self
            .path
            .parent()
            .filter(|path| !path.as_os_str().is_empty())
        {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }

        let timestamp_ms = crate::metrics::current_time_ms();
        let sequence = self.sequence.fetch_add(1, Ordering::Relaxed);
        let event = DiagnosticEvent {
            id: format!("d{timestamp_ms}-{sequence}"),
            timestamp_ms,
            level: input.level,
            source: input.source,
            message: input.message,
        };
        let mut line = serde_json::to_string(&event).map_err(|err| err.to_string())?;
        line.push('\n');

        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
            .map_err(|err| err.to_string())?;
        file.write_all(line.as_bytes())
            .map_err(|err| err.to_string())?;
        file.sync_all().map_err(|err| err.to_string())?;

        Ok(event)
    }

    pub fn list(&self, limit: usize) -> Result<Vec<DiagnosticEvent>, String> {
        let limit = limit.min(MAX_LIST_LIMIT);
        if limit == 0 {
            return Ok(Vec::new());
        }

        let file = match fs::File::open(&self.path) {
            Ok(file) => file,
            Err(err) if err.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
            Err(err) => return Err(err.to_string()),
        };
        let reader = BufReader::new(file);
        let mut events = VecDeque::with_capacity(limit);

        for line in reader.lines() {
            let line = line.map_err(|err| err.to_string())?;
            if line.trim().is_empty() {
                continue;
            }
            if events.len() == limit {
                events.pop_front();
            }
            let event =
                serde_json::from_str::<DiagnosticEvent>(&line).map_err(|err| err.to_string())?;
            events.push_back(event);
        }

        Ok(events.into_iter().rev().collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diagnostics_store_appends_and_reads_newest_events_first() {
        let temp = tempfile::tempdir().expect("temp dir");
        let store = DiagnosticsStore::new(temp.path().join("diagnostics.jsonl"));

        store
            .append(DiagnosticEventInput {
                level: "info".to_string(),
                source: "startup".to_string(),
                message: "visible shell".to_string(),
            })
            .expect("append");
        store
            .append(DiagnosticEventInput {
                level: "warn".to_string(),
                source: "indexing".to_string(),
                message: "large workspace".to_string(),
            })
            .expect("append");

        let events = store.list(10).expect("list");
        assert_eq!(events[0].source, "indexing");
        assert_eq!(events[1].source, "startup");
    }
}
