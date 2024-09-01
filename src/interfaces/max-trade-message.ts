/**
 * MAX trade message
 */
export interface MaxTradeMessage {
  /**
   * event
   */
  e: string;

  /**
   * trades
   */
  t: {
    /**
     * trades ID
     */
    i: number;

    /**
     * trading pair
     */
    M: string;

    /**
     * side, bid means it is a buy order, ask means it is a sell order
     */
    sd: "bid" | "ask";

    /**
     * price
     */
    p: string;

    /**
     * volume
     */
    v: string;

    /**
     * whether it is a maker order
     */
    m: boolean;

    /**
     * order ID
     */
    oi: number;
  }[];
}
