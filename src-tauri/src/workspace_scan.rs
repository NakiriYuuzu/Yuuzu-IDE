use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct FileTreeEntry {
    pub name: String,
    pub path: PathBuf,
    pub is_dir: bool,
}

pub fn scan_top_level(path: &Path) -> Result<Vec<FileTreeEntry>, String> {
    let mut entries = Vec::new();

    for entry in fs::read_dir(path).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let file_name = entry.file_name();
        let name = file_name.to_string_lossy().into_owned();
        let file_type = entry.file_type().map_err(|err| err.to_string())?;

        if file_type.is_dir() && matches!(name.as_str(), ".git" | "node_modules" | "target") {
            continue;
        }

        entries.push(FileTreeEntry {
            name,
            path: entry.path(),
            is_dir: file_type.is_dir(),
        });
    }

    sort_entries(&mut entries);

    Ok(entries)
}

fn sort_entries(entries: &mut [FileTreeEntry]) {
    entries.sort_by(|left, right| {
        right
            .is_dir
            .cmp(&left.is_dir)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
            .then_with(|| left.name.cmp(&right.name))
            .then_with(|| left.path.cmp(&right.path))
    });
}

#[cfg(test)]
mod tests {
    use std::fs::{self, File};

    use tempfile::tempdir;

    #[test]
    fn scan_top_level_sorts_directories_first_and_ignores_heavy_dirs() {
        let root = tempdir().expect("tempdir");
        fs::create_dir(root.path().join("src")).expect("src dir");
        fs::create_dir(root.path().join("Docs")).expect("Docs dir");
        fs::create_dir(root.path().join(".git")).expect(".git dir");
        fs::create_dir(root.path().join("node_modules")).expect("node_modules dir");
        fs::create_dir(root.path().join("target")).expect("target dir");
        File::create(root.path().join("Cargo.toml")).expect("Cargo.toml file");
        File::create(root.path().join("README.md")).expect("README.md file");

        let entries = super::scan_top_level(root.path()).expect("scan succeeds");

        let names = entries
            .iter()
            .map(|entry| (entry.name.as_str(), entry.is_dir))
            .collect::<Vec<_>>();
        assert_eq!(
            names,
            vec![
                ("Docs", true),
                ("src", true),
                ("Cargo.toml", false),
                ("README.md", false),
            ],
        );
    }

    #[test]
    fn scan_top_level_keeps_heavy_names_when_regular_files() {
        let root = tempdir().expect("tempdir");
        File::create(root.path().join(".git")).expect(".git file");
        File::create(root.path().join("node_modules")).expect("node_modules file");
        File::create(root.path().join("target")).expect("target file");

        let entries = super::scan_top_level(root.path()).expect("scan succeeds");

        let names = entries
            .iter()
            .map(|entry| (entry.name.as_str(), entry.is_dir))
            .collect::<Vec<_>>();
        assert_eq!(
            names,
            vec![(".git", false), ("node_modules", false), ("target", false),],
        );
    }

    #[test]
    fn scan_top_level_sorts_case_collisions_deterministically() {
        let mut entries = vec![
            super::FileTreeEntry {
                name: "Ω".to_string(),
                path: "ohm-sign".into(),
                is_dir: false,
            },
            super::FileTreeEntry {
                name: "Ω".to_string(),
                path: "omega".into(),
                is_dir: false,
            },
        ];

        super::sort_entries(&mut entries);

        let names = entries
            .iter()
            .map(|entry| entry.name.as_str())
            .collect::<Vec<_>>();
        assert_eq!(names, vec!["Ω", "Ω"]);
    }
}
