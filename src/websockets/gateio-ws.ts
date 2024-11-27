import WebSocket from "ws";
import { websocketUrl } from "../environments/websocket-url";
import { log } from "../utils/log";
import crypto from "crypto";
import dotenv from "dotenv";
import { GateioBalanceUpdate } from "../interfaces/gateio-balance-update";
import { GateioOrderBook } from "../interfaces/gateio-order-book";

/**
 * The WebSocket stream for Gate.io
 */
export class GateioWs {
  /**
   * WebSocket instance
   */
  private ws: WebSocket;

  /**
   * Best bid price
   */
  private bestBid: number | null = null;

  /**
   * Best ask price
   */
  private bestAsk: number | null = null;

  /**
   * The base crypto for XEMM
   */
  private crypto: Record<string, string> | null = null;

  /**
   * The latest fair price
   */
  private latestFairPrice: number | null = null;

  constructor(crypto: Record<string, string>) {
    this.crypto = crypto;

    if (!this.crypto) {
      throw new Error("Crypto is not set");
    }

    dotenv.config();
    this.ws = new WebSocket(websocketUrl.gateio);

    this.ws.on("open", () => {
      log("Connected to Gate.io WebSocket");

      const time = Math.floor(Date.now() / 1000);

      // Ping the server
      this.ws.send(JSON.stringify({ time, channel: "spot.ping" }));

      const apiKey = process.env.GATE_IO_API_KEY;
      const secret = process.env.GATE_IO_SECRET;

      if (!apiKey || !secret) {
        throw new Error("Gate.io API key is not set in .env");
      }

      // Login
      const signature = this.getSignature(secret, `api\nspot.login\n\n${time}`);

      this.ws.send(
        JSON.stringify({
          time,
          channel: "spot.login",
          event: "api",
          payload: {
            req_id: "1",
            api_key: apiKey,
            req_header: {},
            timestamp: time.toString(),
            signature,
          },
        })
      );

      if (!this.crypto) {
        throw new Error("Crypto is not set");
      }

      // Subscribe to crypto/USDT order book for best bid & ask
      this.ws.send(
        JSON.stringify({
          time,
          channel: "spot.order_book",
          event: "subscribe",
          payload: [`${this.crypto.uppercase}_USDT`, "10", "100ms"],
        })
      );

      // Subscribe to trades
      this.ws.send(
        JSON.stringify({
          time,
          channel: "spot.trades",
          event: "subscribe",
          payload: [`${this.crypto.uppercase}_USDT`],
        })
      );

      // Subscribe to balance updates
      this.ws.send(
        JSON.stringify({
          time,
          channel: "spot.balances",
          event: "subscribe",
        })
      );
    });
  }

  /**
   * Listen to placed order update on Gate.io
   * @param callback called when placed order is updated
   */
  public listenToPlacedOrderUpdate = (callback: Function): void => {
    this.ws.on("message", (data: Buffer) => {
      const message = JSON.parse(data.toString());

      if (!message.header || message.header.channel !== "spot.order_place") {
        return;
      }

      log("Order message from Gate.io:");
      console.log("");
      console.log(message);
      console.log("");

      if (callback) {
        callback();
      }
    });
  };

  /**
   * Sign the content with the secret key
   * @param secret the secret key
   * @param content the content to sign
   */
  private getSignature(secret: string, content: string): string {
    const hmac = crypto.createHmac("sha512", secret);
    hmac.update(content);
    return hmac.digest("hex");
  }

  /**
   * Compute the fair price based on the order book
   * @param orderBook
   * @returns
   */
  private computeFairPrice = (orderBook: GateioOrderBook) => {
    const weightedPricesAtEachLevel = [];

    for (let i = 0; i < 10; ++i) {
      const [bidPrice, bidVolume] = orderBook.result.bids[i];
      const [askPrice, askVolume] = orderBook.result.asks[i];

      const weightedPrice =
        (+bidPrice * +bidVolume + +askPrice * +askVolume) /
        (+bidVolume + +askVolume);

      weightedPricesAtEachLevel.push(weightedPrice);
    }

    // Use exponential decay to compute the fair price
    let sum = 0;
    let lambda = 0.1;

    for (let i = 0; i < 10; ++i) {
      sum += weightedPricesAtEachLevel[i] * Math.exp(-lambda * i);
    }

    let exponentialDecaySum = 0;

    for (let i = 0; i < 10; ++i) {
      exponentialDecaySum += Math.exp(-lambda * i);
    }

    return sum / exponentialDecaySum;
  };

  /**
   * Listen to order book update on Gate.io
   * @param callback called when order book is updated
   */
  public listenToOrderBookUpdate = (callback: Function): void => {
    this.ws.on("message", (data: Buffer) => {
      const message: GateioOrderBook = JSON.parse(data.toString());

      if (message.channel !== "spot.order_book" || message.event !== "update") {
        return;
      }

      this.bestBid = parseFloat(message.result.bids[0][0]);
      this.bestAsk = parseFloat(message.result.asks[0][0]);

      const fairPrice = this.computeFairPrice(message);

      if (this.latestFairPrice === fairPrice) {
        return;
      }

      this.latestFairPrice = fairPrice;

      if (callback) {
        callback(fairPrice);
      }
    });
  };

  /**
   * Listen to trade update on Gate.io
   * @param callback called when trade is updated
   */
  public listenToTradeUpdate = (callback: Function): void => {
    this.ws.on("message", (data: Buffer) => {
      const message = JSON.parse(data.toString());

      if (message.channel !== "spot.trades" || message.event !== "update") {
        return;
      }

      const price = parseFloat(message.result.price);

      if (callback) {
        callback(price);
      }
    });
  };

  /**
   * Listen to balance update on Gate.io
   * @param callback called when balance is updated
   */
  public listenToBalanceUpdate = (callback: Function): void => {
    this.ws.on("message", (data: Buffer) => {
      const message: GateioBalanceUpdate = JSON.parse(data.toString());

      if (message.channel !== "spot.balances" || message.event !== "update") {
        return;
      }

      if (callback) {
        callback(message);
      }
    });
  };

  /**
   * Place a market order with adjusted amount
   * @param side "buy" or "sell"
   * @param amount amount of order
   */
  private placeMarketOrder = (side: "buy" | "sell", amount: string): void => {
    if (!this.crypto) {
      throw new Error("Crypto is not set");
    }

    if (side === "buy") {
      log(`Placing a ${side} order for ${amount} USDT`);
    } else {
      log(`Placing a ${side} order for ${amount} ${this.crypto.uppercase}`);
    }

    this.ws.send(
      JSON.stringify({
        time: Math.floor(Date.now() / 1000),
        channel: "spot.order_place",
        event: "api",
        payload: {
          req_id: "1",
          req_param: {
            text: "t-my-custom-id",
            currency_pair: `${this.crypto.uppercase}_USDT`,
            type: "market",
            account: "spot",
            side,
            amount,
            time_in_force: "ioc",
          },
        },
      })
    );
  };

  /**
   * Adjust amount and then place a market order
   * @param side "buy" or "sell"
   * @param amount Crypto amount. For a buy order, this method converts it to USDT.
   */
  public adjustAndPlaceMarketOrder = (
    side: "buy" | "sell",
    amount: string
  ): void => {
    if (side === "sell") {
      // Adjust the amount to 5 decimal places
      const cryptoAmount = (
        Math.floor(parseFloat(amount) * 100) / 100
      ).toString();
      this.placeMarketOrder(side, cryptoAmount);
      return;
    }

    // Convert crypto to USDT
    const cryptoToUsdt = this.bestAsk;
    if (!cryptoToUsdt) {
      log("Error: bestAsk is not available");
      return;
    }

    const usdtAmount = (
      Math.floor(parseFloat(amount) * cryptoToUsdt * 100) / 100
    ).toString();
    this.placeMarketOrder(side, usdtAmount);
  };

  /**
   * Get the best ask price on Gate.io
   * @returns Gate.io best ask price
   */
  public getBestAsk = (): number => {
    if (this.bestAsk === null) {
      throw new Error("The best ask price on Gate.io is not available");
    }

    return this.bestAsk;
  };

  /**
   * Get the best bid price on Gate.io
   * @returns Gate.io best bid price
   */
  public getBestBid = (): number => {
    if (this.bestBid === null) {
      throw new Error("The best bid price on Gate.io is not available");
    }

    return this.bestBid;
  };

  /**
   * Close the WebSocket connection
   */
  public close = (): void => {
    this.ws.close();
  };
}
