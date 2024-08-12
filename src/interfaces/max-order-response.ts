/**
 * MAX 掛單和撤單的回應
 */
export interface MaxOrderResponse {
  /**
   * 請求是否成功，若成功不會有這個欄位
   */
  success?: boolean;

  /**
   * 錯誤內容
   */
  error?: {
    /**
     * 錯誤代碼
     */
    code: number;

    /**
     * 錯誤訊息
     */
    message: string;
  };

  /**
   * 訂單編號
   */
  id?: number;

  /**
   * 掛單價格
   */
  price?: string;

  /**
   * 訂單狀態
   */
  state?: 'wait' | 'cancel' | 'done';

  /**
   * 掛單數量
   */
  volume?: string;

  /**
   * 未成交的數量
   */
  remaining_volume?: string;
}
