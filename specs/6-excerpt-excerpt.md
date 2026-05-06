So far the FileExcerpt tag has shown entire files. For some files that’s
too much for a slide. Implement an `excerptRegexes` attribute. When
present, for each (start, end) pair in the MDX attribute, on the slide,
only show lines from the line after each start match, to the line before
the next end match. Excerpts should be non-overlapping, so start the search
for the next start on the line after the end match.

    <FileExcerpt
        src="long.py"
        excerptRegexes={[[/^# start cut/,/#^ end cut/]]}
        runMethod="Makefile"
    />

one tricky bit: the ability to edit the textarea and hit run and have the
changes applied needs to still work, affecting the whole file. Two options:

  - Require that excerptRegexes only have a single entry when `runMethod`
    is present, and only show the first match

  - When there are multiple excerptRegex matches, in the text editor show
    `…` (with leading number of spaces based on previous line of code)
    between each excerpt and then as long as manual edits keep the same
    number of `…` lines they can be mapped back to the right intervals of
    the source file.
