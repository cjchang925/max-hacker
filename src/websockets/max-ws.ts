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
  /**
   * MAX WebSocket instance
   */
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
   * Best bid price
   */
  private bestBid: number | null = null;

  /**
   * Best ask price
   */
  private bestAsk: number | null = null;

  /**
   * The volume of the best bid price
   */
  private bestBidVolume: number | null = null;

  /**
   * The volume of the best ask price
   */
  private bestAskVolume: number | null = null;

  /**
   * The base crypto for XEMM
   */
  private crypto: Record<string, string> | null = null;

  constructor(_crypto: Record<string, string>) {
    this.crypto = _crypto;

    if (!this.crypto) {
      throw new Error("Crypto is not set");
    }

    dotenv.config();

    this.accessKey = process.env.MAX_ACCESS_KEY || "";
    this.secretKey = process.env.MAX_SECRET_KEY || "";

    if (!this.accessKey || !this.secretKey) {
      throw new Error("MAX API Key is not set in .env");
    }

    this.ws = new WebSocket(websocketUrl.max);

    this.ws.on("open", () => {
      log("Connected to MAX WebSocket");
      this.authenticate();
      this.subscribeOrderBook();

      // Ping-Pong to keep the connection alive
      setInterval(() => {
        this.ws.ping("test");
      }, 60000);
    });
  }

  /**
   * Monitor the latest trades on MAX and call the callback
   * @param callback Hedge on Gate.io if any trade happens on MAX
   */
  public listenToOrderUpdate = (callback: Function): void => {
    this.ws.on("message", (data: WebSocket.Data) => {
      const orderMessage: MaxOrderMessage = JSON.parse(data.toString());

      if (orderMessage.e !== "order_update" || !callback) {
        return;
      }

      callback(orderMessage);
    });
  };

  /**
   * Listen to account balance updates
   * @param callback Callback function to handle account balance updates
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
   * Listen to trade updates
   * @param callback Callback function to handle trade updates
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
   * Listen to general trade updates
   * @param callback Callback function to handle general trades
   */
  public listenToGeneralTradeUpdate = (callback: Function): void => {
    this.ws.on("message", (data: WebSocket.Data) => {
      const message: MaxSocketMessage = JSON.parse(data.toString());

      if (message.e !== "update" || message.c !== "trade" || !callback) {
        return;
      }

      callback(message);
    });
  };

  /**
   * Get the best bid price on MAX
   * @returns MAX best bid price
   */
  public getBestBid = (): number => {
    if (this.bestBid === null) {
      throw new Error("The best bid price on MAX is not available");
    }

    return this.bestBid;
  };

  /**
   * Get the best ask price on MAX
   * @returns MAX best ask price
   */
  public getBestAsk = (): number => {
    if (this.bestAsk === null) {
      throw new Error("The best ask price on MAX is not available");
    }

    return this.bestAsk;
  };

  /**
   * Authenticate the connection to MAX WebSocket
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
      filters: ["account", "order", "trade_update"],
    };

    this.ws.send(JSON.stringify(request));
  };

  /**
   * Subscribe to the order book on MAX
   */
  private subscribeOrderBook = (): void => {
    if (!this.crypto) {
      throw new Error("Crypto is not set");
    }

    const request = {
      action: "sub",
      subscriptions: [
        {
          channel: "book",
          market: `${this.crypto.lowercase}usdt`,
          depth: 1,
        },
        {
          channel: "trade",
          market: `${this.crypto.lowercase}usdt`,
        },
      ],
      id: `${this.crypto.lowercase}usdt-order-book`,
    };

    this.ws.send(JSON.stringify(request));

    this.ws.on("message", (data: WebSocket.Data) => {
      const message: MaxSocketMessage = JSON.parse(data.toString());

      if (message.e === "subscribed") {
        return;
      }

      if (message.e === "error") {
        console.log("Error from MAX WebSocket");
        console.log(message);
        return;
      }

      if (message.e === "snapshot") {
        try {
          this.bestAsk = parseFloat(message.a[0][0]);
          this.bestAskVolume = parseFloat(message.a[0][1]);
          this.bestBid = parseFloat(message.b[0][0]);
          this.bestBidVolume = parseFloat(message.b[0][1]);
        } catch (error) {
          log(`Cannot parse the order book snapshot`);
          console.log(message);
          log(`Error: ${error}`);
        }

        return;
      }

      if (message.e === "update" && message.a.length) {
        for (const ask of message.a) {
          const volume = parseFloat(ask[1]);
          if (volume !== 0) {
            this.bestAsk = parseFloat(ask[0]);
            this.bestAskVolume = parseFloat(message.a[0][1]);
          }
        }
      }

      if (message.e === "update" && message.b.length) {
        for (const bid of message.b) {
          const volume = parseFloat(bid[1]);
          if (volume !== 0) {
            this.bestBid = parseFloat(bid[0]);
            this.bestBidVolume = parseFloat(message.b[0][1]);
          }
        }
      }
    });
  };

  /**
   * Get the best bid volume on MAX
   * @returns The best bid volume on MAX
   */
  public getBestBidVolume = (): number => {
    if (this.bestBidVolume === null) {
      throw new Error("The best bid volume on MAX is not available");
    }

    return this.bestBidVolume;
  };

  /**
   * Get the best ask volume on MAX
   * @returns The best ask volume on MAX
   */
  public getBestAskVolume = (): number => {
    if (this.bestAskVolume === null) {
      throw new Error("The best ask volume on MAX is not available");
    }

    return this.bestAskVolume;
  };

  /**
   * Close the connection to MAX WebSocket
   */
  public close = (): void => {
    this.ws.close();
  };
}
