/**
 * 等待指定時間
 * @param ms 等待時間（毫秒）
 */
export const sleep = (ms: number): Promise<void> => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};
