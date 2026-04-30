The approach in 3-sub-slides.md worked ok, but the implementation using AST
turned out not to be the right choice.

The problem is that in an example like the following, the `when="4"` span
needs to preserve that `- Complicated` is a sub-bullet under
"Disadvantages", and that doesn't work with MDX syntax that wraps instead
of being inside markdown syntax.

```
# Talk

<TableOfContents/>

## Slide 1

  - One thing
    <Sl.Pause/>
  - Another thing

## Slide 2

  - Advantages
  
      <Sl.Span when="2">
      - Fast
      </Sl.Span>

  <Pause/> 

  - Disadvantages
  
  <Sl.Span when="4">
      - Complicated
  </Sl.Span>
```

So we'll need a non-MDX parsing pass for these special tags,
that will emit to MDX subsequent subslides created by textual elision,
like so:

```
## Slide 2

  - Advantages
```

```
## Slide 2

  - Advantages

      - Fast
```

```
## Slide 2

  - Advantages

  - Disadvantages
```

```
## Slide 2

  - Advantages

  - Disadvantages

      - Complicated
```

To help distinguish MDX tags from these new slider ones, rename `<Pause/>`
and `<SubSlide>` to `<Sl.Pause>` and `<Sl.Span>` as these are invalid MDX
tag names.

Also be more lenient than MDX on tag formatting, `<Sl.Span when=2>` should
be fine, even though MDX wants quotes around the attributes.
