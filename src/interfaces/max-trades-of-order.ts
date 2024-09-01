/**
 * MAX trades of order
 */
export interface MaxTradesOfOrder {
  /**
   * price
   */
  price: string;

  /**
   * volume
   */
  volume: string;

  /**
   * side
   */
  side: "bid" | "ask";

  /**
   * order ID
   */
  order_id: number;
}
