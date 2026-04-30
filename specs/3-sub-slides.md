In the markdown, we want LaTeX-beamer-inspired "overlay specification" tags for
sub-slides.

For example, with markdown like this (it's ok to adjust the syntax to make it
easier to implement in MDX)

    # Slide 1

      - One thing
      <Pause/>
      - Another thing

    # Slide 2

    - Advantages

        <SubSlide when=2>
        - Fast
        </SubSlide>

    <SubSlide when=3->
    - Disadvantages
    <SubSlide when=3->

        <SubSlide when=4>
        - Complicated
        <SubSlide when=4>

when Nexting through, Slide 1 should show twice, once as /slide-1 with just
"One thing" and then as /slide-1#2 with both things. Slide 2 should show 4
times, with Advantages on all sub-slides, Fast only on the second, etc.


Note that the rendering code currently forces reading files as markdown not
mdx, because of how MDX treats curly braces. This needs to be addressed for new
MDX tags to work.  We will never have `{` in a markdown code block that we want
interpreted as JSX, so customize the rendering pipeline appropriately.
