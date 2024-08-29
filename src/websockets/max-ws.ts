import crypto from "crypto";
import WebSocket from "ws";
import { websocketUrl } from "../environments/websocket-url";
import { log } from "../utils/log";
import dotenv from "dotenv";
import { MaxSocketMessage } from "../interfaces/max-socket-message";
import { MaxOrderMessage } from "../interfaces/max-order-message";
import { MaxAccountMessage } from "../interfaces/max-account-message";
import { MaxTradeMessage } from "../interfaces/max-trade-message";

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

  /**
   * MAX 最佳賣價
   */
  private maxBestAsk: number | null = null;

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

      if (orderMessage.e !== "order_update" || !callback) {
        return;
      }

      callback(orderMessage);
    });
  };

  /**
   * 訂閱 MAX 帳戶餘額資訊
   * @param callback 接收帳戶餘額資訊的函式
   */
  public listenToAccountUpdate = (callback: Function): void => {
    this.ws.on("message", (data: WebSocket.Data) => {
      const accountMessage: MaxAccountMessage = JSON.parse(data.toString());

      if (!accountMessage.e.includes("account") || !callback) {
        return;
      }

      callback(accountMessage);
    });
  };

  /**
   * 訂閱 MAX 成交訊息
   * @param callback 接收成交訊息的函式
   */
  public listenToTradeUpdate = (callback: Function): void => {
    this.ws.on("message", (data: WebSocket.Data) => {
      const tradeMessage: MaxTradeMessage = JSON.parse(data.toString());

      if (tradeMessage.e !== "trade_update" || !callback) {
        return;
      }

      callback(tradeMessage);
    });
  };

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
   * 取得 MAX 最佳賣價
   * @returns MAX 最佳賣價
   */
  public getBestAsk = (): number => {
    if (this.maxBestAsk === null) {
      throw new Error("MAX 最佳賣價尚未取得");
    }

    return this.maxBestAsk;
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
      filters: ["account", "order", "trade_update"], // subscribe to order, account and trade_update events
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
          // market: "btcusdt",
          market: "bnbusdt",
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
        try {
          this.maxBestAsk = parseFloat(book.a[0][0]);
          this.maxBestBid = parseFloat(book.b[0][0]);
        } catch (error) {
          log(`讀取 snapshot 訊息發生錯誤，訊息內容：`);
          console.log(book);
          log(`錯誤訊息：`);
          console.log(error);
        }

        return;
      }

      if (book.e === "update" && book.a.length) {
        for (const ask of book.a) {
          const volume = parseFloat(ask[1]);
          if (volume !== 0) {
            this.maxBestAsk = parseFloat(ask[0]);
          }
        }
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
