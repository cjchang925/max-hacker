/**
 * MAX 掛單成交回應
 */
export interface MaxTradesOfOrder {
  /**
   * 成交價格
   */
  price: string;

  /**
   * 成交量
   */
  volume: string;

  /**
   * 成交方向
   */
  side: "bid" | "ask";

  /**
   * 掛單編號
   */
  order_id: number;
}
