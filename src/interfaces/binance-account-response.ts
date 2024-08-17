export interface BinanceAccountResponse {
  /**
   * 訂單編號（客製化）
   */
  id: string;

  /**
   * 狀態碼，200 表示成功，其他表示失敗
   */
  status: number;

  /**
   * 帳戶相關資訊
   */
  result: {
    /**
     * 餘額
     */
    balances: {
      /**
       * 幣種
       */
      asset: string;

      /**
       * 可用餘額
       */
      free: string;

      /**
       * 已鎖定餘額
       */
      locked: string;
    }[];
  };
}
