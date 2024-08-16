/**
 * MAX 訂單訊息
 */
export interface MaxOrderMessage {
  /**
   * 事件
   */
  e: string;

  /**
   * 訂單資訊
   */
  o: {
    /**
     * 訂單編號
     */
    i: number;

    /**
     * 掛單價格
     */
    p: string;

    /**
     * 掛單量
     */
    v: string;

    /**
     * 未成交量
     */
    rv: string;

    /**
     * 已成交量
     */
    ev: string;

    /**
     * 訂單狀態
     */
    S: string;
  }[];
}
