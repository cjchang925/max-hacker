import WebSocket from "ws";
import { websocketUrl } from "../environments/websocket-url";
import { log } from "../utils/log";
import { GateioOrderBookUpdate } from "../interfaces/gateio-order-book-update";
import crypto from "crypto";
import dotenv from "dotenv";
import { dot } from "node:test/reporters";
import { GateioBalanceUpdate } from "../interfaces/gateio-balance-update";

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

  constructor() {
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

      // Subscribe to BTC/USDT order book for best bid & ask
      this.ws.send(
        JSON.stringify({
          time,
          channel: "spot.book_ticker",
          event: "subscribe",
          payload: ["BTC_USDT"],
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
   * Listen to order book update on Gate.io
   * @param callback called when order book is updated
   */
  public listenToOrderBookUpdate = (callback: Function): void => {
    this.ws.on("message", (data: Buffer) => {
      const message: GateioOrderBookUpdate = JSON.parse(data.toString());

      if (
        message.channel !== "spot.book_ticker" ||
        message.event !== "update"
      ) {
        return;
      }

      this.bestBid = parseFloat(message.result.b);
      this.bestAsk = parseFloat(message.result.a);

      if (callback) {
        callback(this.bestBid, this.bestAsk);
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
    this.ws.send(
      JSON.stringify({
        time: Math.floor(Date.now() / 1000),
        channel: "spot.order_place",
        event: "api",
        payload: {
          req_id: "1",
          req_param: {
            text: "t-my-custom-id",
            currency_pair: "BTC_USDT",
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
   * @param amount BTC amount. For a buy order, this method converts it to USDT.
   */
  public adjustAndPlaceMarketOrder = (
    side: "buy" | "sell",
    amount: string
  ): void => {
    if (side === "sell") {
      // Adjust the amount to 5 decimal places
      const btcAmount = parseFloat(amount).toFixed(5);
      this.placeMarketOrder(side, btcAmount);
      return;
    }

    // Convert BTC to USDT
    const btcToUsdt = this.bestAsk;
    if (!btcToUsdt) {
      log("Error: bestAsk is not available");
      return;
    }

    const usdtAmount = (parseFloat(amount) * btcToUsdt).toFixed(2);
    this.placeMarketOrder(side, usdtAmount);
  };
}
