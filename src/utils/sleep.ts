/**
 * Wait certain time.
 * @param ms time to wait in milliseconds
 */
export const sleep = (ms: number): Promise<void> => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};
