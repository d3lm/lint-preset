# Notes

## `src/comments/`

Each issue type has a tier, set in `ISSUE_TIERS` in `src/comments/analyze.ts`:

- **Verdicts** (`overflow`, `underfill`, `widow`, `unbalanced`) fail `comments check` and count as remaining after the agent ran.
- **Hints** (`orphan`, `split-parenthetical`, `banner`, `em-dash`, `semicolon`, `label-colon`, `emphasis`, `dash`) only pick which comments the agent sees. The prompt marks them as possible issues, and the agent decides whether the rule applies.

Hint checks are heuristics, so false positives are expected and acceptable. A false positive costs one agent look at a comment. It never fails a check.

- The hint checks (`ABBREVIATIONS` in `src/comments/wrap.ts`, and `BANNER`, `COLUMN_RULE`, `COLON`, `SEMICOLON`, `EMPHASIS`, and `DASH` in `src/comments/style.ts`) already have some exceptions, like number ranges in `DASH` and globs in `EMPHASIS`. Don't add more to get rid of false positives. Put that judgment in the agent rules (`DEFAULT_RULES` in `src/comments/agent.ts`) instead.
- If a hint check is too noisy, keep its rule in `DEFAULT_RULES` and delete the check.
- Choose the tier from the complete rule, including its exemptions, not from the character or pattern that finds candidates. The `—` character is literal, but whether it breaks the rule depends on whether it's in a quotation, so `em-dash` is a hint.
- A verdict must establish a violation without interpreting prose, like a line length. A verdict may only have a structural exemption whose syntax and boundaries are documented and tested, and that exempts every region with that syntax regardless of meaning. Everything else is a hint.
- Guessing that text is laid out by hand may stop the wrapper from rewrapping it, but it never hides hints, and it never exempts the text from `overflow`. Only code and the layout syntax listed in "Text Kept as Written" in `README.md` are exempt from verdicts.
- The wrapper may use heuristics like the orphan check to choose line breaks. When a layout fits the hard maximum, analyzing its own rewrap with the same options must never report a layout issue. An indivisible token that exceeds `maxWidth` stays intact and remains an overflow verdict.
