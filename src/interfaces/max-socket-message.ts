/**
 * The order book message from MAX Exchange.
 */
export interface MaxSocketMessage {
  /**
   * Channel
   */
  c: string;

  /**
   * Market
   */
  M: string;

  /**
   * Event
   */
  e: "subscribed" | "snapshot" | "update" | "error";

  /**
   * Asks
   */
  a: Array<Array<string>>;

  /**
   * Bids
   */
  b: Array<Array<string>>;

  /**
   * Trades
   */
  t: {
    /**
     * Price
     */
    p: string;

    /**
     * Volume
     */
    v: string;

    /**
     * Trend
     */
    tr: string;

    /**
     * Trade time
     */
    T: number;
  }[];

  /**
   * Timestamp
   */
  T: number;
}
