//! A module with a byte order mark and CRLF line endings, whose comments are wrapped badly,
//! like the others.

/// Returns one. The line endings of the file stay CRLF after the rewrap, and so does every line
/// of this comment.
pub fn one() -> u8 {
  1
}
