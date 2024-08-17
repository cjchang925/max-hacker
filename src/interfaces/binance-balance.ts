/**
 * 幣安帳戶餘額
 */
export interface BinanceBalance {
  /**
   * 可用餘額
   */
  free: number;

  /**
   * 已鎖定餘額
   */
  locked: number;
}