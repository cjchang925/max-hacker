/**
 * MAX 帳戶餘額
 */
export interface MaxBalance {
  /**
   * 可用餘額
   */
  available: number;

  /**
   * 已鎖定餘額
   */
  locked: number;
}
