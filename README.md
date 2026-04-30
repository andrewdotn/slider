# Slider

A presentation tool for markdown files, built on vite's dev server and MDX,
with output format inspired by go present and progressive-reveal features
inspired by LaTeX's beamer.

## Features

  - Live reload when markdown files are changed on disk

  - A new slide is created for content below each h1/h2

  - Progressive reveal tags in the markdown input:

      - `<Sl.Pause/>` to break a slide into sub-slides

      - `<Sl.Span when="1-2,4"/> … content … </Sl.Span>` for content that
        appears on some subslides but not others

  - `<TableOfContents/>` tag with optional `minDepth` and `maxDepth`
    attributes, e.g., 

## Shortcut keys

  - Right/left arrow keys to advance by sub-slide

  - Up/down arrow keys advance by full slides, skipping over progressive-reveal
    from subslides

## Running

    node --experimental-strip-types server.ts \
        [--port 1234] \
        [--base-dir /path-to-slides]

## Caveats

This is intended for running trusted input on localhost, not for publishing
slides on the internet (yet?).

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

Original specs for some previously-implemented features are in the `specs`
folder.
