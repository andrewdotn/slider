# Evaluation

go present allows code blocks to be sourced from files that can then be
run, for example:

    .play -edit tar_stats.go /start cut/+1,/end cut/-1

will show a few selected lines from a go file, allow editing those lines in
the browser, and then provides a Run button in the corner that runs the
whole file and gives a popup with streaming output that also includes
Run/Kill/Close buttons.

We want something like that for slider.

The idea is an MDX tag, with more options to come later:

    <FileExcerpt
        src="hello/hello.c"
        lineHighlights=[/hello world/]
        runMethod="Makefile"
    />

  - This will display all of the indicated source file as an *editable*
    code block on the slide, with lines matching the regexes highlighted

When the "run" button is clicked, the backend will:

  - create a temporary directory
  - copy the files from the directory containing src into it
  - run `make clean` (but don’t show the output unless it fails)
  - then run `make`

streaming the output live to the browser

Temporary directories should go into a `temp-eval` folder in the base dir,
so that they can be easily cleaned. Include the talk+slide slug in the
temporary directory name, and keep the last 5 temp folders for each code
block around while the server is running, but delete them all when the
server shuts down.

Instead of the golang Run/Kill/Close button, have a "Manage" button that
pops up a menu with actions:
  - View clean output
  - Copy path
  - Re-run
  - Kill
  - Close


