/**
 * Balance update message from Gate.io
 */
export interface GateioBalanceUpdate {
  /**
   * Channel name
   */
  channel: string;

  /**
   * Event name
   */
  event: string;

  /**
   * Balance update result
   */
  result: {
    /**
     * Currency name
     */
    currency: string;

    /**
     * Available balance
     */
    available: string;
  }[];
}
