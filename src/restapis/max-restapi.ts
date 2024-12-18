import { restapiUrl } from "../environments/restapi-url";
import { createHmac } from "crypto";
import qs from "qs";
import dotenv from "dotenv";
import { MaxOrderResponse } from "../interfaces/max-order-response";
import { MaxOrder } from "../interfaces/max-order";
import { log } from "../utils/log";
import { MaxTradesOfOrder } from "../interfaces/max-trades-of-order";

/**
 * MAX Rest API
 */
export class MaxRestApi {
  /**
   * MAX API access key
   */
  private accessKey: string;

  /**
   * MAX API secret key
   */
  private secretKey: string;

  /**
   * The base crypto for XEMM
   */
  private crypto: Record<string, string> | null = null;

  constructor(crypto: Record<string, string>) {
    this.crypto = crypto;

    if (!this.crypto) {
      throw new Error("Crypto is not set");
    }

    dotenv.config();

    this.accessKey = process.env.MAX_ACCESS_KEY || "";
    this.secretKey = process.env.MAX_SECRET_KEY || "";

    if (!this.accessKey || !this.secretKey) {
      throw new Error("找不到 MAX API Key");
    }
  }

  /**
   * Place an order
   * @param ord_type "post_only" or "market"
   * @param price price to place
   * @param side "buy" or "sell"
   * @param volume volume to place
   * @returns ID of the placed order
   */
  public placeOrder = async (
    ord_type: "post_only" | "market",
    price: string | null,
    side: "buy" | "sell",
    volume: string
  ): Promise<MaxOrder> => {
    log(`Start to place order at price ${price} with volume ${volume}`);

    const nonce = Date.now();

    if (!this.crypto) {
      throw new Error("Crypto is not set");
    }

    const request = price
      ? {
          market: `${this.crypto.lowercase}usdt`,
          side,
          volume,
          price,
          ord_type,
          nonce,
        }
      : {
          market: `${this.crypto.lowercase}usdt`,
          side,
          volume,
          ord_type,
          nonce,
        };

    const paramsToBeSigned = {
      ...request,
      path: restapiUrl.max.placeOrder,
    };

    const payload = Buffer.from(JSON.stringify(paramsToBeSigned)).toString(
      "base64"
    );

    const signature = createHmac("sha256", this.secretKey)
      .update(payload)
      .digest("hex");

    const response: MaxOrderResponse = await fetch(
      `${restapiUrl.max.baseUrl}${restapiUrl.max.placeOrder}?${qs.stringify(
        request,
        {
          arrayFormat: "brackets",
        }
      )}`,
      {
        method: "POST",
        headers: {
          "X-MAX-ACCESSKEY": this.accessKey,
          "X-MAX-PAYLOAD": payload,
          "X-MAX-SIGNATURE": signature,
        },
      }
    ).then((res) => res.json());

    if (response.success === false) {
      throw new Error(response.error?.message);
    }

    const newOrder: MaxOrder = {
      id: response.id!,
      price: response.price!,
      state: response.state!,
      volume: response.volume!,
      remainingVolume: response.remaining_volume!,
      timestamp: Date.now(),
    };

    return newOrder;
  };

  /**
   * Cancel an order
   * @param id ID of the order to cancel
   */
  public cancelOrder = async (id: number): Promise<void> => {
    log(`Start to cancel order ${id}`);

    const nonce = Date.now();

    const request = {
      id,
      nonce,
    };

    const paramsToBeSigned = {
      ...request,
      path: restapiUrl.max.cancelOrder,
    };

    const payload = Buffer.from(JSON.stringify(paramsToBeSigned)).toString(
      "base64"
    );

    const signature = createHmac("sha256", this.secretKey)
      .update(payload)
      .digest("hex");

    try {
      const response: MaxOrderResponse = await fetch(
        `${restapiUrl.max.baseUrl}${restapiUrl.max.cancelOrder}?${qs.stringify(
          request,
          {
            arrayFormat: "brackets",
          }
        )}`,
        {
          method: "DELETE",
          headers: {
            "X-MAX-ACCESSKEY": this.accessKey,
            "X-MAX-PAYLOAD": payload,
            "X-MAX-SIGNATURE": signature,
          },
        }
      ).then((res) => res.json());

      if (response.success === false) {
        throw new Error(response.error?.message);
      }
    } catch (error: any) {
      throw new Error(error.message);
    }
  };

  /**
   * Clear all orders
   * @param side "buy" or "sell"
   */
  public clearOrders = async (side: "buy" | "sell"): Promise<void> => {
    log(`Start to clear ${side} orders on MAX`);

    const nonce = Date.now();

    if (!this.crypto) {
      throw new Error("Crypto is not set");
    }

    const request = {
      market: `${this.crypto.lowercase}usdt`,
      side,
      nonce,
    };

    const paramsToBeSigned = {
      ...request,
      path: restapiUrl.max.clearOrders,
    };

    const payload = Buffer.from(JSON.stringify(paramsToBeSigned)).toString(
      "base64"
    );

    const signature = createHmac("sha256", this.secretKey)
      .update(payload)
      .digest("hex");

    try {
      const response = await fetch(
        `${restapiUrl.max.baseUrl}${restapiUrl.max.clearOrders}?${qs.stringify(
          request,
          {
            arrayFormat: "brackets",
          }
        )}`,
        {
          method: "DELETE",
          headers: {
            "X-MAX-ACCESSKEY": this.accessKey,
            "X-MAX-PAYLOAD": payload,
            "X-MAX-SIGNATURE": signature,
          },
        }
      );

      if (response.status >= 300) {
        console.log(response);
        throw new Error(`Failed to clear ${side} orders on MAX`);
      }
    } catch (error: any) {
      throw new Error(error.message);
    }
  };

  /**
   * Check if open orders exist
   * @returns true if open orders exist
   */
  public checkIfOpenOrdersExist = async (): Promise<Boolean> => {
    const nonce = Date.now();

    if (!this.crypto) {
      throw new Error("Crypto is not set");
    }

    const request = {
      market: `${this.crypto.lowercase}usdt`,
      nonce,
    };

    const paramsToBeSigned = {
      ...request,
      path: restapiUrl.max.openOrders,
    };

    const payload = Buffer.from(JSON.stringify(paramsToBeSigned)).toString(
      "base64"
    );

    const signature = createHmac("sha256", this.secretKey)
      .update(payload)
      .digest("hex");

    try {
      const response = await fetch(
        `${restapiUrl.max.baseUrl}${restapiUrl.max.openOrders}?${qs.stringify(
          request,
          {
            arrayFormat: "brackets",
          }
        )}`,
        {
          method: "GET",
          headers: {
            "X-MAX-ACCESSKEY": this.accessKey,
            "X-MAX-PAYLOAD": payload,
            "X-MAX-SIGNATURE": signature,
          },
        }
      );

      if (response.status >= 300) {
        console.log(response);
        throw new Error(`Failed to get open orders on MAX`);
      }

      const orders = await response.json();

      return orders.length > 0;
    } catch (error: any) {
      throw new Error(error.message);
    }
  };

  /**
   * Get trades of an order
   * @param orderId order ID
   * @returns trades of the order
   */
  public getTradesOfOrder = async (
    orderId: number
  ): Promise<MaxTradesOfOrder[]> => {
    let nonce = Date.now();

    const request = {
      id: orderId,
      nonce,
    };

    const paramsToBeSigned = {
      ...request,
      path: restapiUrl.max.tradesOfOrder,
    };

    const payload = Buffer.from(JSON.stringify(paramsToBeSigned)).toString(
      "base64"
    );

    const signature = createHmac("sha256", this.secretKey)
      .update(payload)
      .digest("hex");

    const response = await fetch(
      `${restapiUrl.max.baseUrl}${restapiUrl.max.tradesOfOrder}?${qs.stringify(
        request,
        {
          arrayFormat: "brackets",
        }
      )}`,
      {
        method: "GET",
        headers: {
          "X-MAX-ACCESSKEY": this.accessKey,
          "X-MAX-PAYLOAD": payload,
          "X-MAX-SIGNATURE": signature,
        },
      }
    );

    if (response.status === 200) {
      const trades: MaxTradesOfOrder[] = await response.json();
      return trades;
    } else {
      throw new Error(`Failed to get the trade records of ${orderId}`);
    }
  };
}
