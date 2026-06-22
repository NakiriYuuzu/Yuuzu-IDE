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

        let path = entry.path();
        let path = dunce::simplified(&path).to_path_buf();

        entries.push(FileTreeEntry {
            name,
            path,
            is_dir: file_type.is_dir(),
        });
    }

    sort_entries(&mut entries);

    Ok(entries)
}

pub fn scan_directory(workspace_root: &Path, path: &Path) -> Result<Vec<FileTreeEntry>, String> {
    let root = dunce::canonicalize(workspace_root).map_err(|err| err.to_string())?;
    let path = dunce::canonicalize(path).map_err(|err| err.to_string())?;
    if !path.starts_with(&root) {
        return Err(format!("path outside workspace: {}", path.display()));
    }
    scan_top_level(&path)
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

    #[cfg(windows)]
    #[test]
    fn scan_top_level_simplifies_verbatim_entry_paths() {
        let root = tempdir().expect("tempdir");
        File::create(root.path().join("package.json")).expect("package file");
        let verbatim_root = std::fs::canonicalize(root.path()).expect("verbatim root");
        assert!(
            verbatim_root.to_string_lossy().starts_with(r"\\?\"),
            "precondition: std canonicalize must produce a verbatim prefix on Windows"
        );

        let entries = super::scan_top_level(&verbatim_root).expect("scan succeeds");
        let package = entries
            .iter()
            .find(|entry| entry.name == "package.json")
            .expect("package entry");

        assert!(
            !package.path.to_string_lossy().starts_with(r"\\?\"),
            "Explorer paths sent to the frontend must not keep the verbatim prefix"
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

    #[test]
    fn scan_directory_accepts_nested_workspace_child() {
        let root = tempdir().expect("tempdir");
        fs::create_dir(root.path().join("src")).expect("src dir");
        File::create(root.path().join("src/main.ts")).expect("main file");

        let entries = super::scan_directory(root.path(), &root.path().join("src")).expect("scan");

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "main.ts");
    }

    #[test]
    fn scan_directory_rejects_outside_workspace() {
        let root = tempdir().expect("tempdir");
        let outside = tempdir().expect("outside");

        let result = super::scan_directory(root.path(), outside.path());

        assert!(result.unwrap_err().contains("outside workspace"));
    }
}
