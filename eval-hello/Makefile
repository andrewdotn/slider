.PHONY: run clean

run: hello
	./$<

%: %.c
	cc -o $@ $<

clean::
	rm -f hello
