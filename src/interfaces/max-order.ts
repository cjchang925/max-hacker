/**
 * Max order information
 */
export interface MaxOrder {
  /**
   * Order ID
   */
  id: number;

  /**
   * Order price
   */
  price: string;

  /**
   * Order state
   */
  state: "wait" | "cancel" | "done";

  /**
   * Order volume
   */
  volume: string;

  /**
   * Remaining volume
   */
  remainingVolume: string;

  /**
   * Current timestamp
   */
  timestamp: number;
}
