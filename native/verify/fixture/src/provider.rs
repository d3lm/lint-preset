//! The [`Provider`], which counts its reads. Comments here hold non-ASCII text like 漢字,
//! ünïcödé, and 😀, which
//! the tool measures by characters.

use crate::permissions::Permission;

/// Reads values and counts how often it did, for [`count_provider_reads`](crate::count_provider_reads).
pub struct Provider {
  name: String,
  reads: usize,
  permissions: Vec<Permission>,
}

impl Provider {
  /// Creates a provider with the
  /// given name and no reads.
  pub fn new(name: &str) -> Self {
    Self {
      name: name.to_string(),
      reads: 0,
      permissions: vec![Permission::Read],
    }
  }

  /// Returns the name.
  pub fn name(&self) -> &str {
    &self.name
  }

  /// Reads a value. A string like `"// not a comment"` or `"/* not either */"` in the code below
  /// never counts
  /// as a comment.
  pub fn read(&mut self) -> &'static str {
    self.reads += 1;

    let _raw = r#"/// "not" a doc comment /*"#;
    let _slash = '/';

    "// not a comment"
  }

  /// Returns the number of reads since the provider was created or [`reset`](Self::reset).
  pub fn reads(&self) -> usize {
    self.reads
  }

  /// Sets the number of reads back to zero, and
  /// keeps the [`Permission`]s.
  pub fn reset(&mut self) {
    self.reads = 0;
  }
}
