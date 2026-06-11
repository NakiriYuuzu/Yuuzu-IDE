#include <stdio.h>

int main(void) {
  int counter = 1;
  counter += 2;
  printf("%d\n", counter);
  return counter == 3 ? 0 : 1;
}
