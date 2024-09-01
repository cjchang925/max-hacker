/**
 * MAX balance message
 */
export interface MaxAccountMessage {
  /**
   * event
   */
  e: string;

  /**
   * balances
   */
  B: {
    /**
     * currency
     */
    cu: string;

    /**
     * available balance
     */
    av: string;

    /**
     * locked balance
     */
    l: string;
  }[];
}
