import dotenv from "dotenv";
import { log } from "./utils/log";
import { BinanceStreamWs } from "./websockets/binance-stream-ws";
import { BinanceApiWs } from "./websockets/binance-api-ws";
import { MaxWs } from "./websockets/max-ws";
import { MaxRestApi } from "./restapis/max-restapi";
import { MaxOrder } from "./interfaces/max-order";
import { MaxState } from "./enums/max-state";
import { sleep } from "./utils/sleep";
import { MaxOrderMessage } from "./interfaces/max-order-message";
import { MaxBalance } from "./interfaces/max-balance";
import { MaxAccountMessage } from "./interfaces/max-account-message";
import { BinanceRestApi } from "./restapis/binance-restapi";
import { BinanceAccountResponse } from "./interfaces/binance-account-response";
import { BinanceBalance } from "./interfaces/binance-balance";
import { MaxTradeMessage } from "./interfaces/max-trade-message";
import { MaxTradesOfOrder } from "./interfaces/max-trades-of-order";

/**
 * Frederick, the agent.
 */
class Frederick {
  /**
   * 幣安 WebSocket Stream，null 表示尚未建立物件
   */
  private binanceStreamWs: BinanceStreamWs | null = null;

  /**
   * 幣安 WebSocket API
   */
  private binanceApiWs: BinanceApiWs;

  /**
   * 幣安 REST API
   */
  private binanceRestApi: BinanceRestApi;

  /**
   * MAX WebSocket
   */
  private maxWs: MaxWs;

  /**
   * MAX Rest API
   */
  private maxRestApi: MaxRestApi;

  /**
   * MAX 所有有效的掛單
   */
  private maxActiveOrders: MaxOrder[] = [];

  /**
   * 正在撤銷的掛單編號集合，避免重複撤單卡住程式執行
   */
  private cancellingOrderSet: Set<number> = new Set();

  /**
   * 所有掛單編號集合，避免掛單又撤單後，三秒的等待時間過去又記錄掛單成功
   */
  private orderIdSet: Set<number> = new Set();

  /**
   * MAX 掛單與撤單狀態
   */
  private maxState: MaxState = MaxState.DEFAULT;

  /**
   * 幣安使用的穩定幣，null 表示尚未決定
   */
  private binanceStableCoin: string | null = null;

  /**
   * 目前賣出 BTC 的交易所，決定 XEMM 執行方向
   * 預設先從 MAX 賣出，完成一次 XEMM 後再改由 Binance 賣出，來回切換
   * null 表示程式剛開始執行，尚未決定 XEMM 執行方向
   */
  private nowSellingExchange: "MAX" | "Binance" | null = null;

  /**
   * MAX 最新掛單價格
   */
  private maxLatestOrderPrice: number | null = null;

  /**
   * MAX 各幣種餘額，以幣種為 key，餘額為 value
   */
  private maxBalance: Record<string, MaxBalance> = {};

  /**
   * 幣安各幣種餘額，以幣種為 key，餘額為 value
   */
  private binanceBalance: Record<string, BinanceBalance> = {};

  /**
   * MAX 掛單成交紀錄
   */
  private maxTradesOfOrderMap: Map<number, MaxTradesOfOrder[]> = new Map();

  constructor() {
    dotenv.config();

    this.binanceApiWs = new BinanceApiWs();
    this.binanceApiWs.connect();
    this.binanceApiWs.listenToOrderUpdate();

    this.binanceRestApi = new BinanceRestApi();

    this.maxWs = new MaxWs();
    this.maxWs.listenToAccountUpdate(this.maxAccountUpdateCallback);
    this.maxWs.connectAndAuthenticate();

    this.maxRestApi = new MaxRestApi();
  }

  /**
   * Frederick kicks off!!!
   */
  public kicksOff = async (): Promise<void> => {
    log("Frederick kicks off!!!");

    await sleep(2000);

    // 監聽 MAX 掛單狀態
    this.maxWs.listenToRecentTrade(this.maxOrderUpdateCallback);

    // 監聽 MAX 成交訊息
    // 目前暫時不用 Socket 監聽，改用 Rest API 輪詢，看看會不會比較穩定
    // this.maxWs.listenToTradeUpdate(this.maxTradeUpdateCallback);

    // 監聽幣安帳戶餘額
    this.binanceApiWs.listenToAccountUpdate(this.binanceAccountUpdateCallback);
    this.binanceApiWs.getAccountBalance();

    // 等待 WebSocket 連線完成，兩秒後再開始執行
    await sleep(2000);

    log("已等待兩秒，開始判斷策略方向");

    // 執行 XEMM
    await this.startXemm();

    // 每秒檢查 MAX 掛單成交狀態
    setInterval(this.checkTradesOfMaxOrders, 1000);
  };

  /**
   * 準備執行 XEMM，包括轉換穩定幣、選擇穩定幣、判斷 XEMM 執行方向
   */
  private startXemm = async (): Promise<void> => {
    // 判斷 XEMM 執行方向
    this.determineDirection();

    log(`目前策略方向：在 ${this.nowSellingExchange} 出售 BTC`);

    // 決定幣安要使用哪一種穩定幣
    await this.selectStableCoin();

    if (!this.binanceStableCoin) {
      throw new Error("尚未選擇穩定幣");
    }

    this.binanceStreamWs = new BinanceStreamWs(this.binanceStableCoin);
    this.binanceStreamWs.connect();

    // 等待幣安 Stream WebSocket 連線完成，一秒後再開始執行
    await sleep(1000);

    // 將幣安所有穩定幣轉為指定的穩定幣
    this.transferStableCoin();

    // 等待穩定幣轉換完成，1 秒後再開始執行
    await sleep(1000);

    // 監聽幣安最新價格，並在取得價格後呼叫 binanceLatestPriceCallback
    this.binanceStreamWs.listenToLatestPrices(this.binanceLatestPriceCallback);
  };

  /**
   * 檢查 MAX 掛單成交狀態
   */
  private checkTradesOfMaxOrders = async (): Promise<void> => {
    if (!this.maxActiveOrders.length) {
      return;
    }

    for (const order of this.maxActiveOrders) {
      const tradesOfOrder = await this.maxRestApi.getTradesOfOrder(order.id);

      // 已有成交紀錄，檢查是否有新成交，如果沒有紀錄就是空陣列
      const lastTradesOfOrder = this.maxTradesOfOrderMap.get(order.id) || [];

      const newTrades = tradesOfOrder.slice(lastTradesOfOrder.length);

      // 更新成交紀錄
      this.maxTradesOfOrderMap.set(order.id, tradesOfOrder);

      if (!newTrades.length) {
        // 沒有新成交
        continue;
      }

      log(`訂單 ${order.id} 有新的成交紀錄，成交量 ${newTrades[0].volume}`);

      // 在幣安 hedge
      const direction = this.nowSellingExchange === "MAX" ? "BUY" : "SELL";

      for (const trade of newTrades) {
        this.binanceApiWs.placeMarketOrder(
          `BTC${this.binanceStableCoin}`,
          trade.volume,
          direction
        );
      }

      // 修改本地的掛單紀錄
      const remainingVolume = +order.remainingVolume - +newTrades[0].volume;

      if (remainingVolume) {
        order.remainingVolume = remainingVolume.toString();
        log(`訂單 ${order.id} 部分成交，剩餘掛單量 ${order.remainingVolume}`);
        continue;
      }

      log(`訂單已全部成交，訂單編號 ${order.id}`);

      const orderIndex = this.maxActiveOrders.findIndex(
        (order) => order.id === order.id
      );

      if (orderIndex === -1) {
        log(`找不到訂單編號 ${order.id} 的掛單紀錄`);
        continue;
      }

      this.maxActiveOrders.splice(orderIndex, 1);

      if (!this.cancellingOrderSet.size && this.maxState !== MaxState.SLEEP) {
        // 如果沒有要撤的單，就將 maxState 改為預設以便掛新單
        this.maxState = MaxState.DEFAULT;
      }
    }
  };

  /**
   * 接到 MAX 最新成交訊息後的 callback
   * @param tradeMessage MAX 最新成交訊息
   */
  public maxTradeUpdateCallback = (tradeMessage: MaxTradeMessage): void => {
    log(`收到 MAX 掛單成交訊息`);

    for (const trade of tradeMessage.t) {
      const side = trade.sd === "bid" ? "買入" : "賣出";

      log(
        `MAX ${side}訂單編號 ${trade.oi}，成交價 ${trade.p}，成交量 ${trade.v}`
      );

      // 根據 MAX 成交方向決定幣安下單方向
      const direction = trade.sd === "bid" ? "SELL" : "BUY";

      // 在幣安下單 hedge
      this.binanceApiWs.placeMarketOrder(
        `BTC${this.binanceStableCoin}`,
        trade.v,
        direction
      );

      // 修改本地的掛單紀錄
      const orderIndex = this.maxActiveOrders.findIndex(
        (order) => order.id === trade.oi
      );

      if (orderIndex === -1) {
        log(`找不到訂單編號 ${trade.oi} 的掛單紀錄`);
        continue;
      }

      const order = this.maxActiveOrders[orderIndex];

      const remainingVolume = +order.remainingVolume - +trade.v;

      if (remainingVolume === 0) {
        log(`訂單已全部成交，訂單編號 ${order.id}`);

        this.maxActiveOrders.splice(orderIndex, 1);

        if (!this.cancellingOrderSet.size && this.maxState !== MaxState.SLEEP) {
          // 如果沒有要撤的單，就將 maxState 改為預設以便掛新單
          this.maxState = MaxState.DEFAULT;
        }

        continue;
      }

      order.remainingVolume = remainingVolume.toString();
    }
  };

  /**
   * 將幣安帳戶的穩定幣轉成指定的穩定幣
   */
  private transferStableCoin = async (): Promise<void> => {
    const stableCoins = ["USDT", "USDC", "FDUSD"];

    for (const coin of stableCoins) {
      if (coin === this.binanceStableCoin) {
        continue;
      }

      const balance = this.binanceBalance[coin];

      // 最少要 5 個穩定幣才能下單
      if (!balance || Math.floor(balance.free) < 5) {
        log(`${coin} 餘額不足，無法轉換`);
        continue;
      }

      if (coin === "USDT") {
        // 將 USDT 轉為指定穩定幣
        // 由於幣安交易對下單限制，下單量最小是 0.0001 單位
        const price = await this.binanceRestApi.getRecentTradePrice(
          `${this.binanceStableCoin}USDT`
        );

        const volume = Math.floor(balance.free / price);

        this.binanceApiWs.placeMarketOrder(
          `${this.binanceStableCoin}USDT`,
          `${volume}`,
          "BUY"
        );

        continue;
      }

      if (coin === "USDC") {
        if (this.binanceStableCoin === "USDT") {
          // 將 USDC 轉為 USDT
          const volume = Math.floor(balance.free);

          this.binanceApiWs.placeMarketOrder(`USDCUSDT`, `${volume}`, "SELL");

          continue;
        }

        // 將 USDC 轉為 FDUSD
        // 由於幣安沒有 USDC/FDUSD 交易對，所以先轉換成 USDT 再轉成 FDUSD
        const volume = Math.floor(balance.free);

        this.binanceApiWs.placeMarketOrder(`USDCUSDT`, `${volume}`, "SELL");

        const price = await this.binanceRestApi.getRecentTradePrice(
          `FDUSDUSDT`
        );
        const fdusdVolume = Math.floor(volume / price);

        this.binanceApiWs.placeMarketOrder(
          `FDUSDUSDT`,
          `${fdusdVolume}`,
          "BUY"
        );

        continue;
      }

      // coin 是 FDUSD
      if (this.binanceStableCoin === "USDT") {
        // 將 FDUSD 轉為 USDT
        const volume = Math.floor(balance.free);

        this.binanceApiWs.placeMarketOrder(`FDUSDUSDT`, `${volume}`, "SELL");

        continue;
      }

      // 將 FDUSD 轉為 USDC
      // 由於幣安沒有 FDUSD/USDC 交易對，所以先轉換成 USDT 再轉成 USDC
      const volume = Math.floor(balance.free);

      this.binanceApiWs.placeMarketOrder(`FDUSDUSDT`, `${volume}`, "SELL");

      const price = await this.binanceRestApi.getRecentTradePrice(`USDCUSDT`);
      const usdcVolume = Math.floor(volume / price);

      this.binanceApiWs.placeMarketOrder(`USDCUSDT`, `${usdcVolume}`, "BUY");
    }
  };

  /**
   * 選擇幣安要使用的穩定幣
   */
  private selectStableCoin = async (): Promise<void> => {
    // 幣安的穩定幣
    const stableCoins = ["USDT", "USDC", "FDUSD"];

    let maxStableCoin = "";
    let maxPrice = 0;
    let minStableCoin = "";
    let minPrice = 1e10;

    for (const coin of stableCoins) {
      const price = await this.binanceRestApi.getRecentTradePrice(`BTC${coin}`);

      if (price > maxPrice) {
        maxPrice = price;
        maxStableCoin = coin;
      }

      if (price < minPrice) {
        minPrice = price;
        minStableCoin = coin;
      }
    }

    if (this.nowSellingExchange === "MAX") {
      log(`選擇 ${minStableCoin} 穩定幣`);
      this.binanceStableCoin = minStableCoin;
      return;
    }

    log(`選擇 ${maxStableCoin} 穩定幣`);
    this.binanceStableCoin = maxStableCoin;
  };

  /**
   * 更新幣安帳戶餘額後呼叫的 callback
   * @param response 幣安帳戶餘額訊息
   */
  public binanceAccountUpdateCallback = (
    response: BinanceAccountResponse
  ): void => {
    for (const balance of response.result.balances) {
      this.binanceBalance[balance.asset] = {
        free: parseFloat(balance.free),
        locked: parseFloat(balance.locked),
      };
    }
  };

  /**
   * 在 MAX 帳戶餘額更新時呼叫的 callback
   * @param accountMessage 更新掛單狀態的訊息
   */
  public maxAccountUpdateCallback = (
    accountMessage: MaxAccountMessage
  ): void => {
    for (const balance of accountMessage.B) {
      this.maxBalance[balance.cu] = {
        available: parseFloat(balance.av),
        locked: parseFloat(balance.l),
      };
    }
  };

  /**
   * 根據 MAX 餘額決定 XEMM 執行方向
   * 如果 MAX 的 BTC 總值大於 USDT 總值，就從 MAX 賣出；反之則從 Binance 賣出
   */
  private determineDirection = (): void => {
    const btcBalance = this.maxBalance["btc"];
    const usdtBalance = this.maxBalance["usdt"];

    if (!btcBalance || !usdtBalance) {
      log("MAX 餘額無效，因此無法判斷 XEMM 執行方向");
      process.exit(1);
    }

    const maxBtcValue = btcBalance.available + btcBalance.locked;
    const maxUsdtValue = usdtBalance.available + usdtBalance.locked;

    const maxBestBid = this.maxWs.getBestBid();
    const maxBestAsk = this.maxWs.getBestAsk();
    const maxMidPrice = (maxBestBid + maxBestAsk) / 2;

    if (maxBtcValue * maxMidPrice >= maxUsdtValue) {
      this.nowSellingExchange = "MAX";
    } else {
      this.nowSellingExchange = "Binance";
    }
  };

  /**
   * Frederick goes to bed. 撤掉所有掛單。
   */
  public goToBed = async (): Promise<void> => {
    log("準備重啟程式，第一次撤回所有掛單");

    this.maxState = MaxState.SLEEP;

    const direction = this.nowSellingExchange === "MAX" ? "sell" : "buy";

    await this.maxRestApi.clearOrders(direction);

    await sleep(5000);

    log("第一次撤回後等待五秒，再次撤回所有掛單");

    await this.maxRestApi.clearOrders(direction);
  };

  /**
   * 在 MAX 掛單狀態更新時呼叫的 callback
   * @param orderMessage 更新掛單狀態的訊息
   */
  public maxOrderUpdateCallback = (orderMessage: MaxOrderMessage): void => {
    // 如果不是掛單相關訊息，就不在這裡處理
    if (!orderMessage.e.includes("order")) {
      return;
    }

    for (const order of orderMessage.o) {
      // 收到撤單訊息，將已撤銷的掛單從有效掛單紀錄中移除
      if (order.S === "cancel") {
        const id = order.i;

        const orderIndex = this.maxActiveOrders.findIndex(
          (order) => order.id === id
        );

        if (orderIndex === -1 || !this.cancellingOrderSet.has(id)) {
          // 表示是反向 XEMM 的撤單訊息或是已 timeout，不需處理
          continue;
        }

        log(`撤單成功，訂單編號 ${id}`);

        this.maxActiveOrders.splice(orderIndex, 1);

        // 從正在撤銷的掛單編號集合中移除
        this.cancellingOrderSet.delete(id);

        if (!this.cancellingOrderSet.size && this.maxState !== MaxState.SLEEP) {
          // 如果沒有要撤的單，就將 maxState 改為預設以便掛新單
          this.maxState = MaxState.DEFAULT;
        }

        continue;
      }

      if (order.S === "wait" && +order.v === +order.rv) {
        // 如果已有掛單紀錄或是掛單價格與最新價格紀錄不符就不需處理
        if (
          this.orderIdSet.has(order.i) ||
          parseFloat(order.p) !== this.maxLatestOrderPrice
        ) {
          continue;
        }

        // 新掛單訊息，將新掛單加入有效掛單紀錄
        this.maxActiveOrders.push({
          id: order.i,
          price: order.p,
          state: order.S,
          volume: order.v,
          remainingVolume: order.rv,
          timestamp: Date.now(),
        });

        this.orderIdSet.add(order.i);

        log(`掛單成功，訂單編號 ${order.i}`);

        if (this.maxState !== MaxState.SLEEP) {
          // 將 maxState 改為預設
          this.maxState = MaxState.DEFAULT;
        }
      }
    }
  };

  /**
   * 取得幣安最新價格後呼叫的 callback
   * @param price 幣安最新價格
   */
  public binanceLatestPriceCallback = async (price: number): Promise<void> => {
    if (this.maxState !== MaxState.DEFAULT) {
      return;
    }

    // 處理 MAX 訂單簿上的掛單，撤銷價格超出套利區間的單子
    await this.processActiveOrders(price);

    // 只有在 MAX 沒有有效掛單且尚未開始掛單時才掛新單，如果不滿足條件就直接 return
    if (this.maxActiveOrders.length || this.maxState !== MaxState.DEFAULT) {
      return;
    }

    // 取得幣安帳戶餘額
    this.binanceApiWs.getAccountBalance();

    // 將狀態改為等待掛單，避免幣安價格變化時重複掛單
    this.maxState = MaxState.PENDING_PLACE_ORDER;

    // MAX 理想掛單價格，根據當前策略方向有不同算法
    let maxIdealPrice: number = 0;

    if (this.nowSellingExchange === "MAX") {
      // 計算 MAX 理想掛單價格，也就是幣安最新價格上方 0.13%
      maxIdealPrice = parseFloat((price * 1.0013).toFixed(2));

      // 取得 MAX 最佳買價
      const maxBestBid = this.maxWs.getBestBid();

      // 如果最佳買價比理想掛單價格還高，則將理想掛單價格設為最佳買價 + 0.01
      if (maxBestBid >= maxIdealPrice) {
        log("MAX best bid 比理想掛單價格還高，調整掛單價格");
        maxIdealPrice = maxBestBid + 0.01;
      }
    } else {
      // 計算 MAX 理想掛單價格，也就是幣安最新價格下方 0.13%
      maxIdealPrice = parseFloat((price * 0.9987).toFixed(2));

      // 取得 MAX 最佳買價
      const maxBestAsk = this.maxWs.getBestAsk();

      // 如果最佳賣價比理想掛單價格還低，則將理想掛單價格設為最佳賣價 - 0.01
      if (maxBestAsk <= maxIdealPrice) {
        log("MAX best ask 比理想掛單價格還低，調整掛單價格");
        maxIdealPrice = maxBestAsk - 0.01;
      }
    }

    this.maxLatestOrderPrice = maxIdealPrice;

    if (!this.binanceStableCoin) {
      throw new Error("下單時尚未選擇穩定幣");
    }

    // 計算最大的掛單量，取 MAX BTC 餘額與幣安穩定幣餘額可購買 BTC 的最小值
    const btcBalance = this.maxBalance["btc"].available;
    const stableCoinBalance = this.binanceBalance[this.binanceStableCoin].free;

    const maxVolume = Math.min(btcBalance, stableCoinBalance / price);

    if (maxVolume < 0.0002) {
      log("BTC 餘額或穩定幣餘額不足，無法掛單");
      await this.changeDirection();
      return;
    }

    // 將掛單量無條件捨去到小數點後第四位
    const adjustedVolume = (Math.floor(maxVolume * 10000) / 10000).toString();

    // 掛單
    try {
      const direction = this.nowSellingExchange === "MAX" ? "sell" : "buy";

      const order = await this.maxRestApi.placeOrder(
        `${maxIdealPrice}`,
        direction,
        adjustedVolume
      );

      // 由於 MAX 偶爾會忘記回傳掛單成功的訊息，所以三秒後仍未收到掛單訊息就認定掛單成功
      setTimeout(() => {
        if (
          this.maxState === MaxState.PENDING_PLACE_ORDER &&
          !this.orderIdSet.has(order.id)
        ) {
          this.maxActiveOrders.push(order);
          this.orderIdSet.add(order.id);

          log(`三秒後仍未收到掛單訊息，系統認定掛單成功，訂單編號 ${order.id}`);

          this.maxState = MaxState.DEFAULT;
        }
      }, 3000);
    } catch (error: any) {
      log(`掛單失敗, 錯誤訊息: ${error.message}`);
      await this.changeDirection();
    }
  };

  /**
   * 改變 XEMM 執行方向
   */
  private changeDirection = async (): Promise<void> => {
    this.maxState = MaxState.SLEEP;

    const direction = this.nowSellingExchange === "MAX" ? "sell" : "buy";

    log("第一次撤回所有掛單");

    await this.maxRestApi.clearOrders(direction);

    await sleep(5000);

    log("已等待五秒，再次撤回所有掛單");

    await this.maxRestApi.clearOrders(direction);

    log("撤回掛單完成。由於餘額不足，開始改變策略方向");

    await this.startXemm();

    log("繼續執行 XEMM");

    this.maxState = MaxState.DEFAULT;
  };

  /**
   * 處理 MAX 訂單簿上的掛單，撤銷價格和當前價差小於 0.11% 的單子
   * @param price 幣安最新價格
   */
  private processActiveOrders = async (price: number): Promise<void> => {
    if (!this.maxActiveOrders.length) {
      return;
    }

    // 套利區間邊界價格
    const borderPrice =
      this.nowSellingExchange === "MAX" ? price * 1.0011 : price * 0.9989;

    const maxInvalidOrders = [];

    for (const order of this.maxActiveOrders) {
      // 如果此訂單正在撤銷，無需判斷撤單條件
      if (this.cancellingOrderSet.has(order.id)) {
        continue;
      }

      // 如果掛單時間已超過十秒，就需撤單
      if (Date.now() - order.timestamp >= 10000) {
        maxInvalidOrders.push(order);
        continue;
      }

      // 如果價格超出套利區間邊界，就需撤單
      if (
        (this.nowSellingExchange === "MAX" &&
          parseFloat(order.price) < borderPrice) ||
        (this.nowSellingExchange === "Binance" &&
          parseFloat(order.price) > borderPrice)
      ) {
        maxInvalidOrders.push(order);
      }
    }

    if (maxInvalidOrders.length) {
      this.maxState = MaxState.PENDING_CANCEL_ORDER;

      for (const order of maxInvalidOrders) {
        log(
          `現有掛單價格 ${order.price} 超越套利區間邊界 ${borderPrice.toFixed(
            3
          )} 或掛單時間超過十秒，撤銷掛單`
        );
        this.cancellingOrderSet.add(order.id);
        const direction = this.nowSellingExchange === "MAX" ? "sell" : "buy";
        this.maxRestApi.cancelOrder(order.id, direction);

        setTimeout(() => {
          if (this.cancellingOrderSet.has(order.id)) {
            log(
              `120 秒後仍未收到撤單訊息，系統認定撤單成功，訂單編號 ${order.id}`
            );
            this.cancellingOrderSet.delete(order.id);

            const orderIndex = this.maxActiveOrders.findIndex(
              (activeOrder) => activeOrder.id === order.id
            );

            this.maxActiveOrders.splice(orderIndex, 1);

            if (!this.cancellingOrderSet.size) {
              // 如果沒有要撤的單，就將 maxState 改為預設以便掛新單
              this.maxState = MaxState.DEFAULT;
            }
          }
        }, 120000);
      }
    }
  };
}

const executeOnce = async () => {
  const frederick = new Frederick();
  frederick.kicksOff();

  // After 23 hours and 58 minutes, Frederick goes to bed.
  setTimeout(async () => {
    await frederick.goToBed();
    log("Frederick goes to bed.");
    log("----------------------------------------");
    log("");
  }, 23 * 60 * 60 * 1000 + 58 * 60 * 1000);
};

const main = () => {
  // Execute Frederick every 24 hours.
  executeOnce();
  setInterval(executeOnce, 24 * 60 * 60 * 1000);
};

main();
