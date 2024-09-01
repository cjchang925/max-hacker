/**
 * Update message of order book.
 */
export interface GateioOrderBookUpdate {
  /**
   * Channel name
   */
  channel: string;

  /**
   * Event name
   */
  event: string;

  /**
   * Result of order book update.
   */
  result: {
    /**
     * Best ask
     */
    a: string;

    /**
     * Best bid.
     */
    b: string;
  };
}
