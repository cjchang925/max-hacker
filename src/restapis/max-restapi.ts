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
   * 掛單。如果是買單，nonce 為偶數；如果是賣單，nonce 為奇數，避免兩個程式同時執行時 nonce 相同
   * @param price 掛單的價格
   * @param side "buy" 表示買進, "sell" 表示賣出
   * @param volume 掛單的數量，預設為 0.1
   * @returns 掛單編號
   */
  public placeOrder = async (
    price: string,
    side: "buy" | "sell",
    volume: string = "0.1"
  ): Promise<MaxOrder> => {
    log(`開始掛單，價格：${price}，數量：${volume}`);

    let nonce = Date.now();

    if (side === "buy" && nonce % 2) {
      nonce += 1;
    }

    if (side === "sell" && !(nonce % 2)) {
      nonce += 1;
    }

    const request = {
      market: "btcusdt",
      side,
      volume, // Precision: 6
      price,
      ord_type: "post_only",
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
   * 撤單。如果是買單，nonce 為偶數；如果是賣單，nonce 為奇數，避免兩個程式同時執行時 nonce 相同
   * @param id 要撤單的訂單編號
   * @param side "buy" 表示撤掉買單, "sell" 表示撤掉賣單
   */
  public cancelOrder = async (
    id: number,
    side: "buy" | "sell"
  ): Promise<void> => {
    log(`開始撤單，訂單編號：${id}`);

    let nonce = Date.now();

    if (side === "buy" && nonce % 2) {
      nonce += 1;
    }

    if (side === "sell" && !(nonce % 2)) {
      nonce += 1;
    }

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
  };

  /**
   * 撤銷所有 MAX 掛單
   * @param side 掛單方向
   */
  public clearOrders = async (side: "buy" | "sell"): Promise<void> => {
    log(`開始撤銷所有 MAX ${side} 掛單`);

    let nonce = Date.now();

    if (side === "buy" && nonce % 2) {
      nonce += 1;
    }

    if (side === "sell" && !(nonce % 2)) {
      nonce += 1;
    }

    const request = {
      market: "btcusdt",
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

    const response = await fetch(
      `${restapiUrl.max.baseUrl}${restapiUrl.max.clearOrders}?${qs.stringify(
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
    );

    if (response.status === 200) {
      log(`撤銷所有 ${side} 掛單成功`);
    } else {
      throw new Error(`撤銷所有 ${side} 掛單失敗`);
    }
  };
}
