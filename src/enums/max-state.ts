export enum MaxState {
  /**
   * 預設狀態
   */
  DEFAULT = "default",

  /**
   * 已開始掛單，正在等待掛單完成
   */
  PENDING_PLACE_ORDER = "pending-place-order",

  /**
   * 正在撤單中
   */
  PENDING_CANCEL_ORDER = "pending-cancel-order",

  /**
   * 進入休眠狀態
   */
  SLEEP = "sleep",
}
