import WebSocket from "ws";
import { websocketUrl } from "../environments/websocket-url";
import { log } from "../utils/log";
import dotenv from "dotenv";
import fs from "fs";
import crypto from "crypto";
import { BinancePlaceOrderResponse } from "../interfaces/binance-place-order-response";
import { BinanceAccountResponse } from "../interfaces/binance-account-response";

export class BinanceApiWs {
  private ws: WebSocket;

  constructor() {
    dotenv.config();
    this.ws = new WebSocket(websocketUrl.binance.api);
  }

  /**
   * 連上 WebSocket server
   */
  public connect = (): void => {
    // 建立 WebSocket 連線
    this.ws.on("open", () => {
      log("已連上 Binance API WebSocket");
      this.logon();
    });

    // Ping-Pong 以維持連線
    this.ws.on("ping", (data: WebSocket.Data) => {
      this.ws.pong(data);
    });
  };

  /**
   * 監聽幣安成交訊息
   */
  public listenToOrderUpdate = (): void => {
    this.ws.on("message", (data: WebSocket.Data) => {
      const response: BinancePlaceOrderResponse = JSON.parse(data.toString());

      if (response.status !== 200) {
        console.error(response);
        throw new Error("幣安市價下單失敗");
      }

      if (response.id === "frederick-market-order") {
        log("幣安市價單交易成功");
      }
    });
  };

  /**
   * 登入幣安 WebSocket API，之後的請求就不需要攜帶 API key 和簽章
   */
  private logon = (): void => {
    const binanceApiKey = process.env.BINANCE_API_KEY || "";

    if (!binanceApiKey) {
      throw new Error("找不到 Binance API Key");
    }

    const params: Record<string, string> = {
      apiKey: binanceApiKey,
      timestamp: Date.now().toString(),
    };

    params.signature = this.signAndGetSignature(params);

    const request = {
      id: "frederick-logon",
      method: "session.logon",
      params,
    };

    this.ws.send(JSON.stringify(request));
  };

  /**
   * 市價買進
   * @param symbol 交易對，例如 "BTCUSDT"
   * @param volume 買進數量，不包含手續費
   * @param side "BUY" 表示買進, "SELL" 表示賣出
   */
  public placeMarketOrder = (
    symbol: string,
    volume: string,
    side: "BUY" | "SELL"
  ): void => {
    // 將數量無條件捨去到小數點第四位以符合幣安下單的 LOT_SIZE 規定
    const adjustedVolume = Math.floor(parseFloat(volume) * 10000) / 10000;

    log(`開始在幣安以市價單 ${side} ${adjustedVolume} in ${symbol}`);

    const params: Record<string, string> = {
      symbol,
      side,
      type: "MARKET",
      quantity: adjustedVolume.toString(),
      timestamp: Date.now().toString(),
    };

    const request = {
      id: "frederick-market-order",
      method: "order.place",
      params,
    };

    this.ws.send(JSON.stringify(request));
  };

  /**
   * 取得帳戶餘額
   */
  public getAccountBalance = (): void => {
    const params: Record<string, string> = {
      timestamp: Date.now().toString(),
    };

    const request = {
      id: "frederick-account-balance",
      method: "account.status",
      params,
    };

    this.ws.send(JSON.stringify(request));
  };

  /**
   * 監聽帳戶餘額訊息
   */
  public listenToAccountUpdate = (callback: Function): void => {
    this.ws.on("message", (data: WebSocket.Data) => {
      const response: BinanceAccountResponse = JSON.parse(data.toString());

      if (response.status !== 200) {
        console.error(response);
        throw new Error("幣安帳戶餘額查詢失敗");
      }

      if (response.id === "frederick-account-balance" && callback) {
        callback(response);
      }
    });
  };

  /**
   * 使用 ED25519 演算法簽署參數並取得簽名
   */
  private signAndGetSignature = (params: Record<string, string | number>) => {
    const payload = Object.entries(params)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join("&");

    const privateKeyPath = process.env.BINANCE_PRIVATE_KEY_PATH || "";

    if (!privateKeyPath) {
      throw new Error("Private key path is not found.");
    }

    const privateKey = fs.readFileSync(privateKeyPath, "utf8");

    const signature = crypto
      .sign(null, Buffer.from(payload), {
        key: privateKey,
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
      })
      .toString("base64");

    return signature;
  };
}
