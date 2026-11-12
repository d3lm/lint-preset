//! A crate whose comments are wrapped badly on purpose, so that the `comments` tool rewraps
//! them. It holds every kind of Rust comment and the parts of rustdoc Markdown that a rewrap
//! must keep, like
//! intra-doc links, headings, lists, tables, footnotes, and doctests. The verification renders
//! the docs before and after the rewrap and compares them.
//!
//! See [`permissions`], [`Provider`], and [`count_provider_reads`] for the main items, or
//! [the provider module][`provider`] for the
//! rest. A [link with a destination](crate::permissions::Permission) and [a link to an
//! anchor](crate::Provider#method.reads) also resolve, and so do [`Vec<T>`] and [HashMap<K, V>].
//!
//! # Examples
//!
//! ```
//! # use comments_fixture::Provider;
//! let provider = Provider::new("main");
//! assert_eq!(comments_fixture::count_provider_reads(&provider), 0); // a line that is far longer than any width
//! ```

#![allow(dead_code)]

pub mod crlf;
mod nesting;
pub mod permissions;
pub mod provider;

use std::collections::HashMap;

pub use provider::Provider;

/// Counts the reads of a [`Provider`]. Each call to [`Provider::read`] adds one, and
/// [`Provider::reset`] sets the count back to zero.
/// The count is never
/// negative, since it is a [`usize`].
///
/// # Panics
///
/// Never panics. The function only reads a field, so it is safe to call from any thread that
/// holds a reference to the provider, and from any number of threads at the same time.
///
/// # Examples
///
/// ```
/// use comments_fixture::{count_provider_reads, Provider};
///
/// let mut provider = Provider::new("main");
/// provider.read();
/// assert_eq!(count_provider_reads(&provider), 1);
/// ```
pub fn count_provider_reads(provider: &Provider) -> usize {
  provider.reads()
}

/// Returns a map from the name of each provider to its count of reads, built with
/// [`HashMap::from_iter`] over
/// [`count_provider_reads`]. The map holds one entry per provider, and providers with the same name
/// keep the count of the last one.
pub fn counts(providers: &[Provider]) -> HashMap<&str, usize> {
  providers
    .iter()
    .map(|provider| (provider.name(), count_provider_reads(provider)))
    .collect()
}

/// Links that continue on the next line, which an editor can't follow, so the rewrap joins each
/// of them: a [link to an
/// item](crate::permissions::Permission), a [link with a
/// label][`provider`], a [link with a title](crate::Provider "the
/// provider"), a link to [HashMap<K,
/// V>], and an ![image of a
/// provider](https://example.com/a.svg). A link stays on one line however narrow the
/// comment is, like the [link to the method that counts the reads](crate::count_provider_reads).
pub fn links() {}

/// Lists, which wrap with a hanging indent:
///
/// - The first item, which is long enough that it has to continue on the next line at the width of the
///   comment.
/// - A second item
///   with a short line.
///   1. A nested item that goes on and on, past the width of the comment, so that it needs a second line.
///   2. Another nested
///      item.
/// * An item with a star.
/// + An item with a plus, then [`counts`] and [`permissions::Permission::Read`].
///
/// Task lists:
///
/// - [x] A finished task that is described in a sentence long enough to need a second line, too.
/// - [ ] An open
///   task.
pub fn lists() {}

/// Tables are kept as they are, even when a row is longer than the width of the comment by far:
///
/// | Option | Meaning |
/// | ------ | ------- |
/// | `width` | The preferred width of a comment line, which includes its indentation and prefix. |
/// | `maxWidth` | The hard maximum. |
///
/// Footnotes[^width] and their definitions are kept too, and a paragraph after them is
/// rewrapped.
///
/// [^width]: The width counts columns, with tabs expanded to the tab width of the file.
pub fn tables() {}

/// Emphasis like *this*, strong text like **this**, ~~struck~~ text, and `code spans` stay as
/// they
/// are. So do "smart quotes", an ellipsis... and dashes -- like this one -- since a rewrap only
/// moves whole words. HTML like <kbd>Ctrl</kbd> and <span title="a title">inline tags</span>
/// stays in one piece, and so does an autolink like <https://docs.rs/crate/latest> or a
/// [link](https://example.com/a-path?query=value#anchor "with a title").
///
/// A code span can wrap: `cargo test
/// --doc` runs the doctests.
///
/// Escaped characters like \* and \_ and \[ stay escaped, and so do entities like &amp; and &lt;.
pub fn inline() {}

/// A line that ends with two spaces breaks the line in Markdown,
/// so this paragraph is kept as written,
/// and so is the one with a backslash\
/// at the end of a line.
///
/// > A block quote is kept as written, even when it is long enough that it goes on past the width.
///
/// <details>
/// <summary>HTML blocks</summary>
///
/// The content of an HTML block is Markdown again, and it is rewrapped like any
/// other
/// paragraph.
///
/// </details>
///
/// Headings with underlines are kept:
///
/// Setext Heading
/// --------------
///
/// ---
///
/// A rule above, and a paragraph with an equals sign = in it, and a hash # in it, and a plus + in it, and a
/// greater than > in it, and 1. in it, which never start a line after the rewrap.
pub fn layout() {}

/** An outer block doc comment
 * that is wrapped badly, with a [`Provider`] link and a long line that goes past the width of the comment.
 *
 * # Errors
 *
 * Returns an error when
 * the [`Permission`](permissions::Permission) is missing.
 */
pub fn block_doc() -> Result<(), String> {
  Ok(())
}

/**
 * A JSDoc-like outer block doc comment, with a star
 * on every line, and a [`counts`]
 * link.
 */
pub fn starred_block_doc() {}

/*
 * A plain block comment that rustdoc never renders, which is wrapped
 * badly
 * too.
 */
pub fn plain_block() {}

pub struct Settings {
  /// The preferred width of a comment line, including its indentation and the comment prefix,
  /// like `/// `.
  pub width: usize,

  /// The hard maximum.
  /// Lines of prose never go past it.
  pub max_width: usize,
}

impl Settings {
  /// Returns the default settings, with a [`width`](Self::width) of 80 and a
  /// [`max_width`](Self::max_width)
  /// of 100.
  pub fn new() -> Self {
    Self {
      width: 80,
      max_width: 100,
    }
  }
}

impl Default for Settings {
  fn default() -> Self {
    Self::new()
  }
}

/// An enum whose variants have docs.
pub enum Kind {
  /// A doc comment on a variant, which is wrapped
  /// badly.
  Line,

  /// Another one, with an [`Option<T>`] and a [`Result<T, E>`] that
  /// resolve.
  Block,
}

/// A trait with docs on its methods.
pub trait Count {
  /// Counts the things, see [`count_provider_reads`] for a function
  /// that does the same for a [`Provider`].
  fn count(&self) -> usize;
}

macro_rules! documented {
  () => {
    /// A doc comment inside a macro, which the tool rewraps like any
    /// other.
    pub fn from_macro() {}
  };
}

documented!();
