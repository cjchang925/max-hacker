/**
 * Gate.io Order Book
 */
export interface GateioOrderBook {
  /**
   * Event of the message
   */
  event: string;

  /**
   * Channel of the message
   */
  channel: string;

  /**
   * Order book data
   */
  result: {
    /**
     * Bids
     */
    bids: string[][];

    /**
     * Asks
     */
    asks: string[][];
  };
}
