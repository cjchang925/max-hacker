import WebSocket from "ws";
import { websocketUrl } from "../environments/websocket-url";
import { log } from "../utils/log";
import { BinanceTrade } from "../interfaces/binance-trade";

export class BinanceStreamWs {
  private ws: WebSocket;

  constructor() {
    // this.ws = new WebSocket(websocketUrl.binance.stream.btcusdtTrade);
    this.ws = new WebSocket(websocketUrl.binance.stream.bnbusdcTrade);
  }

  /**
   * 連上 WebSocket server
   */
  public connect = (): void => {
    // 建立 WebSocket 連線
    this.ws.on("open", () => {
      log("已連上 Binance Stream WebSocket");
    });

    // Ping-Pong 以維持連線
    this.ws.on("ping", (data: WebSocket.Data) => {
      this.ws.pong(data);
    });
  };

  /**
   * 監聽幣安最新成交價
   * @param callback 取得最新成交價後呼叫的 callback
   */
  public listenToLatestPrices = (callback: Function): void => {
    this.ws.on("message", (data: WebSocket.Data) => {
      const trade: BinanceTrade = JSON.parse(data.toString());
      const latestTradePrice = parseFloat(trade.p);

      if (callback) {
        callback(latestTradePrice);
      }
    });
  };
}
