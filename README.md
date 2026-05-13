# Slider

A presentation tool for markdown files, built on vite’s dev server and MDX,
with output format inspired by go present and progressive-reveal features
inspired by LaTeX’s beamer.

## AI disclosure

  - This README is entirely human-written. I scaffolded out a hello world
    express app by hand and then let the agent run from that. I generally
    reviewed the code before committing it, but didn‘t dig into all the
    details, as my focus at the time was on creating, entirely without AI,
    the content for the talk that I used this tool to present. I believe
    most of the code is of passable/reasonable-ish quality except for the
    CSS which I think is not good.

## Features

  - Live reload when talk files are changed on disk

  - A new slide is created for content below each h1/h2, or on `<Break/>`

  - Progressive reveal tags in the markdown input:

      - `<Sl.Pause/>` to break a slide into sub-slides

      - `<Sl.Span when="1-2,4"/> … content … </Sl.Span>` for content that
        appears on some subslides but not others

  - `<TableOfContents/>` tag with optional `minDepth` and `maxDepth`
    attributes, e.g., `<TableOfContents minDepth="2" maxdepth="4"/>
    to show h2/h3/h4 tags.

      - There’s also an optional `skipCurrentSlide={true}` option that by
        default hides table of contents slides from the table of contents.

  - `<Font size="80%"/>` scales the text on one slide. Helpful for code
    blocks.

  - `<Hide>…</Hide>` leaves space for the child content without displaying it

  - Customize syntax highlighting for indented code blocks via a comment
    before, e.g.,

         <!-- syntax: html -->

            hello <b>world</b>

  - Highlighting inside code blocks -- end a line with `//HL` or `#HL` to
    have the background appear bright yellow. Repeat the `HL` bit for lines
    that should appear on the slide with a literal `//HL` or `#HL`. More `HL`s
    in the input toggle highlighting in the output as they add more `HL`s.

  - `<Frame src="https://docs.example.com/" fallback="docs.png"/>` embeds a
    web page. `fallback` is an optional image to show in “offline mode”
    which is toggled via the `o` key. The URL is also shown but doesn’t
    update during nav because security.

  - `<FileExcerpt src="hello/hello.c"/>` displays a file as a code block.

      - `lineHighlights={[/foo/]} />` will highlight

      - `runMethod="Makefile"` makes the code block editable and runnable.
        Files in the same directory as `src` will be copied to a temporary
        directory, where `make clean` and then `make` will run. You can
        even spawn a shell to interact with files in the temporary
        directory.

          - Add `makefileName="Makefile.foo"` to select among different
            Makefiles in the same directory. `makefileTargets={["foo"]}` is
            available too.

          - `runDirectory="foo/bar"` can set a parent dir containing a
            Makefile for when `src="foo/bar/baz.qux"` is nested

        Recent temporary files are stored in `temp-eval` until the server
        exits.

      - `excerptRegexes={[[/begin cut/, /end cut/]]} />` shows only the
        portions of the file between (but not including) those regexes. You
        can still live-edit those excerpted portions.

## Shortcut keys

  - Right/left arrow keys to advance by sub-slide

  - Up/down arrow keys advance by full slides, skipping over progressive-reveal
    from subslides

  - `l` toggles laser pointer mode

  - `f` toggles full screen

  - `r` does a soft reload, throwing away code block edits and resetting
    `<Frame/>` objects without leaving fullscreen mode

  - `o` toggles offline mode, making `<Frame/>` show fallback images
    instead of iframes

  - `d` toggles debug mode, with overlays such as what syntax code blocks
    were auto-detected as

## Running

### Directly on your machine

Requires Node 24 and yarn 4 (pinned via volta — `volta install node yarn`
will pick up the versions from `package.json`). Then:

    yarn install
    node --experimental-strip-types server.ts \
        [--port 1234] \
        [--base-dir /path-to-slides]

### With Docker

If you'd rather not install node and the native build tools locally, a
`Dockerfile` and `docker-compose.yml` are included:

    docker compose up --build

This serves on <http://localhost:3000> and uses the repo root as the slides
base directory. To point at a different folder of talks, set `SLIDES_DIR`:

    SLIDES_DIR=/path/to/talks docker compose up

The repo is bind-mounted into the container so live-reload still works when
you edit source files. `node_modules` lives in a named volume because
`node-pty` is a native binding and needs to be built for the container's
platform, not the host's.

## Caveats

This is intended for running trusted input on localhost, not for publishing
slides on the internet (yet?).

The embedded web terminal can‘t repeat characters on holding down keys
without disabling ApplePressAndHoldEnabled for the whole browser.

## Developer notes

  - node and yarn versions are pinned with volta
  - `yarn vitest run` runs the tests
  - Playwright is used for some tests
  - All changes require tests.
  - User-facing changes should update the documentation in this README as well.

## Implementation notes

  - The express server is in server.ts and provides endpoints:
      - `/`: list of talks in base directory
      - `/talks/:talk/`, e.g., `/talks/sample-talk/`: initial slide of talk,
        for example of `sample-talk.md` in the base directory
      - `/talks/:talk/:slide`, e.g., `/talks/sample-talk/conclusion`: specific
        slide of talk. A slug is generated from the slide heading.
      - `/talks/:talk/:slide#n`: subslide n of given slide
      - `/talks-static/:talk/:file`: static assets, e.g., raw markdown files,
        images, etc.
      - `/vite/…`: vite dev server internal stuff

  - This is currently a SPA, using React, with no SSR except on `/`; the URL ,
    and updates happen in place because the vite hmr machinery is too
    heavyweight too reload the whole page on slide-to-slide navigation.

  - `present.css` is mostly borrowed from go present, put all CSS changes into
    `style.css` instead.

  - Syntax highlighting is a bit complicated because CodeMirror, used for
    editable code blocks, doesn’t support as many languages as we’d like.

Original specs for some previously-implemented features are in the `specs`
folder.
