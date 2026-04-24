# Clinical PDF fonts

This directory holds the TrueType font files used by the clinical PDF renderer
(`backend/src/services/pdf/*`). Files are fetched at build time by
`scripts/fetch-noto-fonts.mjs` and are **not** committed to git.

Expected files (populate via `npm run fetch:fonts`):

    NotoSans-Regular.ttf
    NotoSans-Bold.ttf
    NotoSans-Italic.ttf
    LICENSE-OFL-1.1.txt

## Why NotoSans?

Clinical text routinely contains glyphs outside WinAnsi / Latin-1:
`—`, `•`, `≥`, `≤`, `µ`, `°`, `→`, German/Nordic accents, etc. pdf-lib's
`StandardFonts` cannot encode these — they were previously stripped to `?` by
a destructive `sanitize()` step, which is unacceptable in a clinical record.

NotoSans covers the full Latin + extended punctuation + symbol range we need
and is distributed under the SIL Open Font License 1.1.

## Missing files?

If the fonts are not present at render time (e.g. offline CI on a cold clone),
the renderer gracefully falls back to `StandardFonts.Helvetica` with the
legacy sanitize step and emits a one-line warning to the server log. Reports
still render; a small number of glyphs become `?`. Re-run `npm run fetch:fonts`
to restore full Unicode support.
