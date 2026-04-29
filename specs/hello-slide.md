We’re building a presentation tool.

sample-talk1.md has a sample talk. Each heading starts a new slide.

The URL scheme would be:

/sample-talk1/ is slide 1
/sample-talk1/motivation is slide 2
/sample-talk1/getting-started is slide 3

each endpoint should return

    <!-- Slide -->
    $raw_markdown
    <!-- /Slide -->
    <a href="…">Previous</a>
    <a href="…">Next</a>

Implement this, leveraging the skipped test.
