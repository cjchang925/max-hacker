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
   * @param side "buy" 表示買進, "sell" 表示賣出
   * @param volume 掛單的數量
   * @returns 掛單編號
   */
  public placeOrder = async (
    price: string,
    side: "buy" | "sell",
    volume: string
  ): Promise<MaxOrder> => {
    log(`開始掛單，價格：${price}，數量：${volume}`);

    let nonce = Date.now();

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
   * 撤單
   * @param id 要撤單的訂單編號
   * @param side "buy" 表示撤掉買單, "sell" 表示撤掉賣單
   */
  public cancelOrder = async (
    id: number,
    side: "buy" | "sell"
  ): Promise<void> => {
    log(`開始撤單，訂單編號：${id}`);

    let nonce = Date.now();

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

  /**
   * 取得訂單成交紀錄
   * @param orderId 訂單編號
   * @returns 訂單成交紀錄
   */
  public getTradesOfOrder = async (
    orderId: number
  ): Promise<MaxTradesOfOrder[]> => {
    log(`開始取得訂單 ${orderId} 的成交紀錄`);

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
      log(`訂單 ${orderId} 的成交紀錄`);
      return trades;
    } else {
      throw new Error(`取得訂單 ${orderId} 的成交紀錄失敗`);
    }
  };
}
