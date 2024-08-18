/**
 * MAX 成交訊息
 */
export interface MaxTradeMessage {
  /**
   * 事件
   */
  e: string;

  /**
   * 成交訊息
   */
  t: {
    /**
     * 成交編號
     */
    i: number;

    /**
     * 交易對
     */
    M: string;

    /**
     * 成交方向，bid 表示買單，ask 表示賣單
     */
    sd: "bid" | "ask";

    /**
     * 成交價格
     */
    p: string;

    /**
     * 成交量
     */
    v: string;

    /**
     * 是否為 maker 單
     */
    m: boolean;

    /**
     * 掛單編號
     */
    oi: number;
  }[];
}
