#include <stdio.h>
#include <threads.h>

#define ONE_MILLISECOND_IN_NANOSECONDS (1000 * 1000)

int main() {
    struct timespec sleep_time = {0, 100 * ONE_MILLISECOND_IN_NANOSECONDS};

    // sleeps are to demonstrate streaming output
    for (int i = 0; i < 5; i++) {
        printf("Hello, world!\n");
        thrd_sleep(&sleep_time, NULL);
    }
    return 0;
}
