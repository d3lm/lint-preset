/*!
 * Permissions, as an inner block doc comment that is wrapped
 * badly. See [`Permission`] and
 * [`crate::count_provider_reads`].
 */

/// A permission that a [`Provider`](crate::Provider) checks before it reads. Each variant
/// stands for one kind of access, and a provider may hold any number of them at once, in any order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Permission {
  /// Allows reads.
  Read,
  /// Allows writes, which
  /// also count as reads.
  Write,
}

impl Permission {
  /// Whether the permission allows reads. A tab indents this comment, which the tool expands to the tab width of
  /// the file when it measures the line.
  pub fn reads(self) -> bool {
    matches!(self, Self::Read | Self::Write)
  }
}
