use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

pub const MAX_DATABASE_ROWS: usize = 500;
pub const MAX_DATABASE_CELL_CHARS: usize = 2000;
pub const MAX_QUERY_HISTORY: usize = 30;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum DatabaseKind {
    SQLite,
    PostgreSQL,
    MsSql,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum DatabaseConnectionSource {
    SQLite {
        path: PathBuf,
    },
    Tcp {
        host: String,
        port: u16,
        database: String,
        username: Option<String>,
        secret_id: Option<String>,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct DatabaseProfile {
    pub id: String,
    pub workspace_root: String,
    pub name: String,
    pub kind: DatabaseKind,
    pub source: DatabaseConnectionSource,
    pub read_only: bool,
    pub production: bool,
    pub created_ms: u64,
    pub updated_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct DatabaseProfileInput {
    pub id: Option<String>,
    pub workspace_root: String,
    pub name: String,
    pub kind: DatabaseKind,
    pub sqlite_path: Option<String>,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub database: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub read_only: bool,
    pub production: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct DatabaseSchema {
    pub profile_id: String,
    pub tables: Vec<DatabaseTable>,
    pub refreshed_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct DatabaseTable {
    pub schema: Option<String>,
    pub name: String,
    pub row_count: Option<u64>,
    pub columns: Vec<DatabaseColumn>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct DatabaseColumn {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub primary_key: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum QueryKind {
    Read,
    Mutation,
    Destructive,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct QueryClassification {
    pub kind: QueryKind,
    pub requires_confirmation: bool,
    pub confirmation_text: String,
    pub reason: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct DatabaseQueryRequest {
    pub profile_id: String,
    pub sql: String,
    pub limit: usize,
    pub confirmation: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct DatabaseQueryResult {
    pub profile_id: String,
    pub sql: String,
    pub classification: QueryClassification,
    pub columns: Vec<String>,
    pub rows: Vec<DatabaseRow>,
    pub affected_rows: Option<u64>,
    pub truncated: bool,
    pub executed_ms: u64,
    pub history_id: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct DatabaseRow {
    pub cells: Vec<DatabaseCell>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum DatabaseCellKind {
    Null,
    Text,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct DatabaseCell {
    pub kind: DatabaseCellKind,
    pub display: String,
}

impl DatabaseCell {
    pub fn null() -> Self {
        Self {
            kind: DatabaseCellKind::Null,
            display: String::new(),
        }
    }

    pub fn text(value: impl Into<String>) -> Self {
        Self {
            kind: DatabaseCellKind::Text,
            display: truncate_cell(value.into()),
        }
    }
}

impl DatabaseQueryResult {
    pub fn from_rows(columns: Vec<String>, rows: Vec<Vec<DatabaseCell>>, executed_ms: u64) -> Self {
        let truncated = rows.len() > MAX_DATABASE_ROWS;
        let bounded_rows = rows
            .into_iter()
            .take(MAX_DATABASE_ROWS)
            .map(|cells| DatabaseRow {
                cells: cells
                    .into_iter()
                    .map(|cell| match cell.kind {
                        DatabaseCellKind::Null => cell,
                        DatabaseCellKind::Text => DatabaseCell {
                            kind: DatabaseCellKind::Text,
                            display: truncate_cell(cell.display),
                        },
                    })
                    .collect(),
            })
            .collect();

        Self {
            profile_id: String::new(),
            sql: String::new(),
            columns,
            rows: bounded_rows,
            affected_rows: None,
            truncated,
            executed_ms,
            history_id: String::new(),
            classification: QueryClassification {
                kind: QueryKind::Read,
                requires_confirmation: false,
                confirmation_text: String::new(),
                reason: String::new(),
            },
        }
    }
}

pub fn classify_sql(sql: &str) -> QueryClassification {
    let mut has_executable_statement = false;
    let mut kind = QueryKind::Read;

    for statement in split_sql_statements(sql) {
        if let Some(token) = first_sql_token(statement) {
            has_executable_statement = true;
            let statement_kind = match token.as_str() {
                "SELECT" | "WITH" | "EXPLAIN" | "SHOW" | "DESCRIBE" => QueryKind::Read,
                "INSERT" | "UPDATE" | "DELETE" | "MERGE" | "CALL" => QueryKind::Mutation,
                "DROP" | "TRUNCATE" | "ALTER" | "CREATE" | "REINDEX" | "VACUUM" => {
                    QueryKind::Destructive
                }
                _ => QueryKind::Destructive,
            };

            if matches!(statement_kind, QueryKind::Destructive) {
                kind = QueryKind::Destructive;
                break;
            }

            if matches!(statement_kind, QueryKind::Mutation) && matches!(kind, QueryKind::Read) {
                kind = QueryKind::Mutation;
            }
        }
    }

    if !has_executable_statement {
        kind = QueryKind::Destructive;
    }

    let (requires_confirmation, confirmation_text, reason) = match kind {
        QueryKind::Read => (false, String::new(), "read-only statement".to_string()),
        QueryKind::Mutation => (
            true,
            "RUN MUTATION".to_string(),
            "mutating SQL requires visible confirmation".to_string(),
        ),
        QueryKind::Destructive => (
            true,
            "RUN DESTRUCTIVE SQL".to_string(),
            "destructive or unknown SQL requires explicit confirmation".to_string(),
        ),
    };

    QueryClassification {
        kind,
        requires_confirmation,
        confirmation_text,
        reason,
    }
}

pub fn validate_query_request(
    profile: &DatabaseProfile,
    request: &DatabaseQueryRequest,
) -> Result<QueryClassification, String> {
    if request.profile_id != profile.id {
        return Err("profile id mismatch".to_string());
    }

    let classification = classify_sql(&request.sql);

    if profile.read_only && !matches!(classification.kind, QueryKind::Read) {
        return Err("read-only database profile blocks mutating SQL".to_string());
    }

    if classification.requires_confirmation
        && request.confirmation.as_deref() != Some(classification.confirmation_text.as_str())
    {
        return Err(format!(
            "confirmation required: {}",
            classification.confirmation_text
        ));
    }

    Ok(classification)
}

fn split_sql_statements(sql: &str) -> Vec<&str> {
    let bytes = sql.as_bytes();
    let mut statements = Vec::new();

    let mut statement_start = 0;
    let mut index = 0;
    let mut in_single_quote = false;
    let mut in_double_quote = false;
    let mut in_line_comment = false;
    let mut in_block_comment = false;

    while index < bytes.len() {
        if in_line_comment {
            if bytes[index] == b'\n' {
                in_line_comment = false;
            }
            index += 1;
            continue;
        }

        if in_block_comment {
            if bytes[index] == b'*' && index + 1 < bytes.len() && bytes[index + 1] == b'/' {
                in_block_comment = false;
                index += 2;
                continue;
            }

            index += 1;
            continue;
        }

        if in_single_quote {
            if bytes[index] == b'\'' {
                if index + 1 < bytes.len() && bytes[index + 1] == b'\'' {
                    index += 2;
                    continue;
                }
                in_single_quote = false;
            }
            index += 1;
            continue;
        }

        if in_double_quote {
            if bytes[index] == b'"' {
                if index + 1 < bytes.len() && bytes[index + 1] == b'"' {
                    index += 2;
                    continue;
                }
                in_double_quote = false;
            }
            index += 1;
            continue;
        }

        if bytes[index] == b'\'' {
            in_single_quote = true;
            index += 1;
            continue;
        }

        if bytes[index] == b'"' {
            in_double_quote = true;
            index += 1;
            continue;
        }

        if bytes[index] == b'-' && index + 1 < bytes.len() && bytes[index + 1] == b'-' {
            in_line_comment = true;
            index += 2;
            continue;
        }

        if bytes[index] == b'/' && index + 1 < bytes.len() && bytes[index + 1] == b'*' {
            in_block_comment = true;
            index += 2;
            continue;
        }

        if bytes[index] == b';' {
            let statement = sql[statement_start..index].trim();
            if !statement.is_empty() {
                statements.push(statement);
            }
            statement_start = index + 1;
            index += 1;
            continue;
        }

        index += 1;
    }

    let trailing_statement = sql[statement_start..].trim();
    if !trailing_statement.is_empty() {
        statements.push(trailing_statement);
    }

    statements
}

pub fn database_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_millis() as u64)
}

fn first_sql_token(sql: &str) -> Option<String> {
    let bytes = sql.as_bytes();
    let mut index = 0;
    let first = next_token(bytes, &mut index)?;
    if first != "WITH" {
        return Some(first);
    }

    let mut current = skip_whitespace_and_comments(bytes, index).unwrap_or(index);

    let mut recursive_probe = current;
    if next_token(bytes, &mut recursive_probe).as_deref() == Some("RECURSIVE") {
        current = skip_whitespace_and_comments(bytes, recursive_probe).unwrap_or(recursive_probe);
    }

    loop {
        current = skip_whitespace_and_comments(bytes, current).unwrap_or(current);
        if current >= bytes.len() {
            return None;
        }

        next_token(bytes, &mut current)?;

        current = skip_whitespace_and_comments(bytes, current).unwrap_or(current);
        if matches_current_char(bytes, current, b'(') {
            current = skip_nested_parentheses(bytes, current)?;
            current = skip_whitespace_and_comments(bytes, current).unwrap_or(current);
        }

        if next_token(bytes, &mut current).as_deref() != Some("AS") {
            return None;
        }

        current = skip_whitespace_and_comments(bytes, current).unwrap_or(current);
        if !matches_current_char(bytes, current, b'(') {
            return None;
        }

        current = skip_nested_parentheses(bytes, current)?;
        current = skip_whitespace_and_comments(bytes, current).unwrap_or(current);
        if current >= bytes.len() {
            return None;
        }

        if bytes[current] == b',' {
            current += 1;
            continue;
        }

        break;
    }

    next_token(bytes, &mut current)
}

fn skip_nested_parentheses(bytes: &[u8], start: usize) -> Option<usize> {
    let mut index = start;
    if !matches_current_char(bytes, index, b'(') {
        return None;
    }

    let mut depth = 0usize;
    index += 1;
    depth += 1;

    while index < bytes.len() {
        let byte = bytes[index];
        if byte == b'\'' {
            index = skip_single_quote(bytes, index)?;
            continue;
        }
        if byte == b'"' {
            index = skip_double_quote(bytes, index)?;
            continue;
        }
        if byte == b'-' && index + 1 < bytes.len() && bytes[index + 1] == b'-' {
            index = skip_line_comment(bytes, index)?;
            continue;
        }
        if byte == b'/' && index + 1 < bytes.len() && bytes[index + 1] == b'*' {
            index = skip_block_comment(bytes, index)?;
            continue;
        }

        if byte == b'(' {
            depth = depth.saturating_add(1);
        } else if byte == b')' {
            depth = depth.saturating_sub(1);
            if depth == 0 {
                return Some(index + 1);
            }
        }
        index += 1;
    }
    None
}

fn next_token(bytes: &[u8], index: &mut usize) -> Option<String> {
    *index = skip_whitespace_and_comments(bytes, *index)?;
    let start = *index;

    while *index < bytes.len() {
        if bytes[*index].is_ascii_whitespace() {
            break;
        }
        if bytes[*index] == b'-'
            && *index + 1 < bytes.len()
            && bytes[*index + 1] == b'-'
        {
            break;
        }
        if bytes[*index] == b'/'
            && *index + 1 < bytes.len()
            && bytes[*index + 1] == b'*'
        {
            break;
        }
        if bytes[*index] == b';' || bytes[*index] == b',' {
            break;
        }
        *index += 1;
    }

    if *index == start {
        return None;
    }

    let token = std::str::from_utf8(&bytes[start..*index]).ok()?;
    let token = token.trim_matches(&[';', '(', ')'][..]);
    Some(token.to_ascii_uppercase())
}

fn skip_whitespace_and_comments(bytes: &[u8], start: usize) -> Option<usize> {
    let mut index = start;

    while index < bytes.len() {
        if bytes[index].is_ascii_whitespace() {
            index += 1;
            continue;
        }

        if bytes[index] == b'-' && index + 1 < bytes.len() && bytes[index + 1] == b'-' {
            index = skip_line_comment(bytes, index)?;
            continue;
        }

        if bytes[index] == b'/' && index + 1 < bytes.len() && bytes[index + 1] == b'*' {
            index = skip_block_comment(bytes, index)?;
            continue;
        }

        return Some(index);
    }

    None
}

fn skip_line_comment(bytes: &[u8], start: usize) -> Option<usize> {
    let mut index = start + 2;
    while index < bytes.len() && bytes[index] != b'\n' {
        index += 1;
    }
    if index < bytes.len() {
        Some(index + 1)
    } else {
        None
    }
}

fn skip_block_comment(bytes: &[u8], start: usize) -> Option<usize> {
    let mut index = start + 2;
    while index + 1 < bytes.len() {
        if bytes[index] == b'*' && bytes[index + 1] == b'/' {
            return Some(index + 2);
        }
        index += 1;
    }
    None
}

fn skip_single_quote(bytes: &[u8], start: usize) -> Option<usize> {
    let mut index = start + 1;
    while index < bytes.len() {
        if bytes[index] == b'\'' {
            if index + 1 < bytes.len() && bytes[index + 1] == b'\'' {
                index += 2;
                continue;
            }
            return Some(index + 1);
        }
        index += 1;
    }
    None
}

fn skip_double_quote(bytes: &[u8], start: usize) -> Option<usize> {
    let mut index = start + 1;
    while index < bytes.len() {
        if bytes[index] == b'"' {
            if index + 1 < bytes.len() && bytes[index + 1] == b'"' {
                index += 2;
                continue;
            }
            return Some(index + 1);
        }
        index += 1;
    }
    None
}

fn matches_current_char(bytes: &[u8], index: usize, expected: u8) -> bool {
    if index >= bytes.len() {
        return false;
    }
    bytes[index] == expected
}

fn truncate_cell(value: String) -> String {
    value.chars().take(MAX_DATABASE_CELL_CHARS).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_reads_and_mutations_with_confirmation_policy() {
        assert_eq!(classify_sql("SELECT * FROM users").kind, QueryKind::Read);
        assert_eq!(
            classify_sql("  WITH recent AS (SELECT 1) SELECT * FROM recent").kind,
            QueryKind::Read,
        );

        let update = classify_sql("UPDATE users SET role = 'admin'");
        assert_eq!(update.kind, QueryKind::Mutation);
        assert!(update.requires_confirmation);
        assert_eq!(update.confirmation_text, "RUN MUTATION");

        let drop_table = classify_sql("DROP TABLE users");
        assert_eq!(drop_table.kind, QueryKind::Destructive);
        assert!(drop_table.requires_confirmation);
        assert_eq!(drop_table.confirmation_text, "RUN DESTRUCTIVE SQL");
    }

    #[test]
    fn classifies_multistatement_sql_as_destructive() {
        let result = classify_sql("SELECT 1; DROP TABLE users");

        assert_eq!(result.kind, QueryKind::Destructive);
        assert!(result.requires_confirmation);
        assert_eq!(result.confirmation_text, "RUN DESTRUCTIVE SQL");
    }

    #[test]
    fn with_cte_with_mutation_is_not_read() {
        let result = classify_sql("WITH cte AS (SELECT 1) DELETE FROM users");

        assert_ne!(result.kind, QueryKind::Read);
        assert!(result.requires_confirmation);
        match result.kind {
            QueryKind::Mutation => assert_eq!(result.confirmation_text, "RUN MUTATION"),
            QueryKind::Destructive => assert_eq!(result.confirmation_text, "RUN DESTRUCTIVE SQL"),
            QueryKind::Read => unreachable!(),
        }
    }

    #[test]
    fn readonly_profiles_reject_mutating_sql_even_with_confirmation() {
        let profile = database_profile("profile-1", DatabaseKind::PostgreSQL, true, true);

        let result = validate_query_request(
            &profile,
            &DatabaseQueryRequest {
                profile_id: profile.id.clone(),
                sql: "DELETE FROM audit_log".to_string(),
                limit: 100,
                confirmation: Some("RUN DESTRUCTIVE SQL".to_string()),
            },
        );

        assert_eq!(
            result.expect_err("read-only profile blocks mutation"),
            "read-only database profile blocks mutating SQL"
        );
    }

    #[test]
    fn readonly_profiles_reject_mutation_after_read_statement() {
        let profile = database_profile("profile-1", DatabaseKind::PostgreSQL, true, true);

        let result = validate_query_request(
            &profile,
            &DatabaseQueryRequest {
                profile_id: profile.id.clone(),
                sql: "SELECT 1; DELETE FROM users".to_string(),
                limit: 100,
                confirmation: Some("RUN DESTRUCTIVE SQL".to_string()),
            },
        );

        assert_eq!(
            result.expect_err("read-only profile blocks mutation"),
            "read-only database profile blocks mutating SQL"
        );
    }

    #[test]
    fn readonly_profiles_reject_with_mutating_cte() {
        let profile = database_profile("profile-1", DatabaseKind::PostgreSQL, true, true);

        let result = validate_query_request(
            &profile,
            &DatabaseQueryRequest {
                profile_id: profile.id.clone(),
                sql: "WITH cte AS (SELECT 1) DELETE FROM users".to_string(),
                limit: 100,
                confirmation: Some("RUN DESTRUCTIVE SQL".to_string()),
            },
        );

        assert_eq!(
            result.expect_err("read-only profile blocks mutation"),
            "read-only database profile blocks mutating SQL"
        );
    }

    #[test]
    fn query_results_are_bounded_and_cells_are_truncated() {
        let result = DatabaseQueryResult::from_rows(
            vec!["id".to_string(), "payload".to_string()],
            (0..600)
                .map(|index| {
                    vec![
                        DatabaseCell::text(index.to_string()),
                        DatabaseCell::text("x".repeat(MAX_DATABASE_CELL_CHARS + 10)),
                    ]
                })
                .collect(),
            42,
        );

        assert_eq!(result.rows.len(), MAX_DATABASE_ROWS);
        assert!(result.truncated);
        assert_eq!(
            result.rows[0].cells[1].display.len(),
            MAX_DATABASE_CELL_CHARS
        );
    }

    fn database_profile(
        id: &str,
        kind: DatabaseKind,
        read_only: bool,
        production: bool,
    ) -> DatabaseProfile {
        DatabaseProfile {
            id: id.to_string(),
            workspace_root: "/workspace".to_string(),
            name: "Profile".to_string(),
            kind,
            source: DatabaseConnectionSource::Tcp {
                host: "localhost".to_string(),
                port: 5432,
                database: "app".to_string(),
                username: Some("yuuzu".to_string()),
                secret_id: Some("secret-1".to_string()),
            },
            read_only,
            production,
            created_ms: 1,
            updated_ms: 1,
        }
    }
}
