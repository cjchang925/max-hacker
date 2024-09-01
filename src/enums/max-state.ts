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
   * Cancelling order on MAX
   */
  CANCELLING_ORDER = "pending-cancel-order",

  /**
   * The bot is sleeping
   */
  SLEEP = "sleep",
}
