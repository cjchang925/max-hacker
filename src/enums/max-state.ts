export enum MaxState {
  /**
   * Default state
   */
  DEFAULT = "default",

  /**
   * Placing order on MAX
   */
  PLACING_ORDER = "pending-place-order",

  /**
   * Placing market order on Gate.io
   */
  PLACING_MARKET_ORDER = "pending-place-market-order",

  /**
   * Cancelling order on MAX
   */
  CANCELLING_ORDER = "pending-cancel-order",

  /**
   * The bot is sleeping
   */
  SLEEP = "sleep",
}
