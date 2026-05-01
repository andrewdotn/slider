#!/usr/bin/env python3
"""Spawn bash in a pty and relay stdio to the parent process.

This is here to avoid having to `enableScripts` in  yarn.

Resize commands arrive as "rows cols\n" lines on FD 3. The helper applies
them with ioctl(TIOCSWINSZ) on the pty master and forwards SIGWINCH to bash.
"""
import errno
import fcntl
import os
import pty
import select
import signal
import struct
import sys
import termios


def set_winsize(fd: int, rows: int, cols: int) -> None:
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


def main() -> None:
    ctrl_fd = 3
    try:
        os.fstat(ctrl_fd)
    except OSError:
        ctrl_fd = -1

    argv = sys.argv[1:] or ["bash", "--login"]

    pid, master_fd = pty.fork()
    if pid == 0:
        try:
            os.execvp(argv[0], argv)
        except OSError:
            os._exit(1)

    set_winsize(master_fd, 24, 80)

    stdin_fd = 0
    stdout_fd = 1

    for fd in (master_fd, stdin_fd, ctrl_fd):
        if fd < 0:
            continue
        flags = fcntl.fcntl(fd, fcntl.F_GETFL)
        fcntl.fcntl(fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

    ctrl_buf = b""
    done = False

    while not done:
        rfds = [master_fd, stdin_fd]
        if ctrl_fd >= 0:
            rfds.append(ctrl_fd)
        try:
            r, _, _ = select.select(rfds, [], [])
        except InterruptedError:
            continue
        except OSError as e:
            if e.errno == errno.EINTR:
                continue
            break

        if master_fd in r:
            try:
                data = os.read(master_fd, 65536)
            except OSError as e:
                if e.errno in (errno.EIO,):
                    break
                if e.errno in (errno.EAGAIN, errno.EWOULDBLOCK):
                    data = b""
                else:
                    raise
            else:
                if not data:
                    break
            if data:
                try:
                    os.write(stdout_fd, data)
                except BrokenPipeError:
                    done = True

        if stdin_fd in r:
            try:
                data = os.read(stdin_fd, 65536)
            except OSError as e:
                if e.errno in (errno.EAGAIN, errno.EWOULDBLOCK):
                    data = b"\x00"
                else:
                    data = b""
            if not data:
                try:
                    os.close(master_fd)
                except OSError:
                    pass
                break
            if data != b"\x00":
                try:
                    os.write(master_fd, data)
                except OSError:
                    done = True

        if ctrl_fd >= 0 and ctrl_fd in r:
            try:
                chunk = os.read(ctrl_fd, 4096)
            except OSError as e:
                if e.errno in (errno.EAGAIN, errno.EWOULDBLOCK):
                    chunk = b""
                else:
                    chunk = b""
            if not chunk:
                ctrl_fd = -1
            else:
                ctrl_buf += chunk
                while b"\n" in ctrl_buf:
                    line, ctrl_buf = ctrl_buf.split(b"\n", 1)
                    parts = line.strip().split()
                    if len(parts) != 2:
                        continue
                    try:
                        rows = int(parts[0])
                        cols = int(parts[1])
                    except ValueError:
                        continue
                    try:
                        set_winsize(master_fd, rows, cols)
                        os.kill(pid, signal.SIGWINCH)
                    except OSError:
                        pass

    status = 0
    try:
        _, status = os.waitpid(pid, 0)
    except OSError:
        pass
    if os.WIFEXITED(status):
        sys.exit(os.WEXITSTATUS(status))
    sys.exit(1)


if __name__ == "__main__":
    main()
