import crypto from "crypto";
import WebSocket from "ws";
import { websocketUrl } from "../environments/websocket-url";
import { log } from "../utils/log";
import dotenv from "dotenv";
import { MaxSocketMessage } from "../interfaces/max-socket-message";
import { MaxOrderMessage } from "../interfaces/max-order-message";

export class MaxWs {
  private ws: WebSocket;

  /**
   * MAX API access key
   */
  private accessKey: string;

  /**
   * MAX API secret key
   */
  private secretKey: string;

  /**
   * MAX 最佳買價
   */
  private maxBestBid: number | null = null;

  constructor() {
    dotenv.config();

    this.accessKey = process.env.MAX_ACCESS_KEY || "";
    this.secretKey = process.env.MAX_SECRET_KEY || "";

    if (!this.accessKey || !this.secretKey) {
      throw new Error("找不到 MAX API Key");
    }

    this.ws = new WebSocket(websocketUrl.max);
  }

  /**
   * 監聽 MAX 最新成交並呼叫 callback
   * @param callback 根據最新成交採取行動的函式
   */
  public listenToRecentTrade = (callback: Function): void => {
    this.ws.on("message", (data: WebSocket.Data) => {
      const orderMessage: MaxOrderMessage = JSON.parse(data.toString());

      if (orderMessage.e === "order_update") {
        callback(orderMessage);
      }
    });
  }

  /**
   * 取得 MAX 最佳買價
   * @returns MAX 最佳買價
   */
  public getBestBid = (): number => {
    if (this.maxBestBid === null) {
      throw new Error("MAX 最佳買價尚未取得");
    }

    return this.maxBestBid;
  };

  /**
   * 連上 WebSocket server
   */
  public connectAndAuthenticate = (): void => {
    // 建立 WebSocket 連線
    this.ws.on("open", () => {
      log("已連上 MAX WebSocket");

      // 取得授權
      this.authenticate();

      // 訂閱訂單簿
      this.subscribeOrderBook();

      // Ping-Pong 以維持連線
      setInterval(() => {
        this.ws.ping("test");
      }, 60000);
    });
  };

  /**
   * 取得 MAX WebSocket 授權
   */
  private authenticate = () => {
    const timestamp = Date.now();
    const hmac = crypto.createHmac("sha256", this.secretKey);
    const signature = hmac.update(timestamp.toString()).digest("hex");

    const request = {
      action: "auth",
      apiKey: this.accessKey,
      nonce: timestamp,
      signature: signature,
      id: "frederick",
      filters: ["order"], // only subscribe to order events
    };

    this.ws.send(JSON.stringify(request));
  };

  /**
   * 訂閱 MAX 訂單簿最新資訊
   */
  private subscribeOrderBook = (): void => {
    const request = {
      action: "sub",
      subscriptions: [
        {
          channel: "book",
          market: "btcusdt",
          depth: 1,
        },
      ],
      id: "btcusdt-order-book",
    };

    this.ws.send(JSON.stringify(request));

    this.ws.on("message", (data: WebSocket.Data) => {
      const book: MaxSocketMessage = JSON.parse(data.toString());

      if (book.e === "subscribed") {
        return;
      }

      if (book.e === "error") {
        console.log("Error from MAX WebSocket");
        console.log(book);
        return;
      }

      if (book.e === "snapshot") {
        this.maxBestBid = parseFloat(book.b[0][0]);
        return;
      }

      if (book.e === "update" && book.b.length) {
        for (const bid of book.b) {
          const volume = parseFloat(bid[1]);
          if (volume !== 0) {
            this.maxBestBid = parseFloat(bid[0]);
          }
        }
      }
    });
  };
}
