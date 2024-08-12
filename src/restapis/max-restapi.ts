import { restapiUrl } from "../environments/restapi-url";
import { createHmac } from "crypto";
import qs from "qs";
import dotenv from "dotenv";
import { MaxOrderResponse } from "../interfaces/max-order-response";
import { MaxOrder } from "../interfaces/max-order";
import { log } from "../utils/log";

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

  constructor() {
    dotenv.config();

    this.accessKey = process.env.MAX_ACCESS_KEY || "";
    this.secretKey = process.env.MAX_SECRET_KEY || "";

    if (!this.accessKey || !this.secretKey) {
      throw new Error("找不到 MAX API Key");
    }
  }

  /**
   * 掛單
   * @param price 掛單的價格
   * @param volume 掛單的數量，預設為 0.0002
   * @returns 掛單編號
   */
  public placeOrder = async (
    price: string,
    volume: string = "0.0002"
  ): Promise<number> => {
    log(`開始掛單，價格：${price}，數量：${volume}`);

    const request = {
      market: "btcusdt",
      side: "sell",
      volume, // Precision: 6
      price,
      ord_type: "limit",
      nonce: Date.now().toString(),
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
    };

    log(`掛單成功，訂單編號：${newOrder.id}`);

    return newOrder.id;
  };

  /**
   * 撤單
   * @param id 要撤單的訂單編號
   */
  public cancelOrder = async (id: number): Promise<void> => {
    log(`開始撤單，訂單編號：${id}`);

    const request = {
      id,
      nonce: Date.now(),
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

    const response: MaxOrderResponse = await fetch(
      `${restapiUrl.max.baseUrl}${restapiUrl.max.cancelOrder}?${qs.stringify(
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

    log(`撤單成功，訂單編號：${id}`);
  };
}
