/**
 * MAX order response
 */
export interface MaxOrderResponse {
  /**
   * Whether the request is successful. Only exists when the request fails.
   */
  success?: boolean;

  /**
   * Error message. Only exists when the request fails.
   */
  error?: {
    /**
     * Error code
     */
    code: number;

    /**
     * Error message
     */
    message: string;
  };

  /**
   * Order ID
   */
  id?: number;

  /**
   * Order price
   */
  price?: string;

  /**
   * Order state
   */
  state?: 'wait' | 'cancel' | 'done';

  /**
   * Order volume
   */
  volume?: string;

  /**
   * Remaining volume
   */
  remaining_volume?: string;
}
