//! One error type for every command. Serialised to the UI as `{ kind, message }`.

use serde::{Serialize, Serializer, ser::SerializeStruct};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("File error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Invalid data: {0}")]
    Json(#[from] serde_json::Error),
    #[error("{0}")]
    Network(String),
    #[error("{0}")]
    Invalid(String),
}

impl From<reqwest::Error> for AppError {
    fn from(e: reqwest::Error) -> Self {
        let msg = if e.is_connect() || e.is_timeout() {
            "Couldn't connect. Check your internet connection and try again.".to_string()
        } else if let Some(status) = e.status() {
            format!("The server answered with an error ({status}). Try again later.")
        } else {
            format!("Network problem: {e}")
        };
        AppError::Network(msg)
    }
}

impl AppError {
    fn kind(&self) -> &'static str {
        match self {
            AppError::Db(_) => "db",
            AppError::Io(_) => "io",
            AppError::Network(_) => "network",
            AppError::Json(_) | AppError::Invalid(_) => "invalid",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let mut st = s.serialize_struct("AppError", 2)?;
        st.serialize_field("kind", self.kind())?;
        st.serialize_field("message", &self.to_string())?;
        st.end()
    }
}

pub type AppResult<T> = Result<T, AppError>;
