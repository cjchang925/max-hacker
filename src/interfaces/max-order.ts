export interface MaxOrder {
  /**
   * 訂單編號
   */
  id: number;

  /**
   * 掛單價格
   */
  price: string;

  /**
   * 掛單狀態
   */
  state: "wait" | "cancel" | "done";

  /**
   * 掛單數量
   */
  volume: string;

  /**
   * 未成交的數量
   */
  remainingVolume: string;

  /**
   * 掛單時間
   */
  timestamp: number;
}
