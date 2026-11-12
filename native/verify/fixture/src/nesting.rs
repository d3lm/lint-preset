/*
 * A block comment with /* a nested comment */ in it, which Rust allows,
 * wrapped
 * badly.
 */

/* A single-line block comment that is kept as written. */

//// Four slashes make a plain comment that is never analyzed, even when it is far longer than any width.

/***
 * Three stars make a plain block comment too.
 */
pub fn nested() {}

// A plain comment that is never analyzed.
// Neither is this run of plain comments.
pub fn plain() {}

pub fn trailing() {}
/// A doc comment after code, which the tool skips, and which documents the item below.
pub fn after_trailing() {}
