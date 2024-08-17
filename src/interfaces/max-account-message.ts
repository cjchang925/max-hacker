/**
 * MAX 帳戶餘額訊息
 */
export interface MaxAccountMessage {
  /**
   * 事件
   */
  e: string;

  /**
   * 各幣種餘額
   */
  B: {
    /**
     * 幣種
     */
    cu: string;

    /**
     * 可用餘額
     */
    av: string;

    /**
     * 已鎖定餘額
     */
    l: string;
  }[];
}
