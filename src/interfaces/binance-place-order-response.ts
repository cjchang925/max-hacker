export interface BinancePlaceOrderResponse {
  /**
   * 訂單編號（客製化）
   */
  id: string;

  /**
   * 狀態碼，200 表示成功，其他表示失敗
   */
  status: number;
}
