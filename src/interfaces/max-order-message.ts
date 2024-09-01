/**
 * MAX order message
 */
export interface MaxOrderMessage {
  /**
   * event
   */
  e: string;

  /**
   * order
   */
  o: {
    /**
     * ID
     */
    i: number;

    /**
     * price
     */
    p: string;

    /**
     * volume
     */
    v: string;

    /**
     * remaining volume
     */
    rv: string;

    /**
     * executed volume
     */
    ev: string;

    /**
     * state
     */
    S: string;
  }[];
}
