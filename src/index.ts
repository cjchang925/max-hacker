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
/**
 * 目前賣出 BTC 的交易所，決定 XEMM 執行方向
 * 預設先從 MAX 賣出，完成一次 XEMM 後再改由 Binance 賣出，來回切換
 */
let nowSellingExchange: "MAX" | "Binance" = "MAX";

/**
 * Frederick, the agent.
 */
class Frederick {
  /**
   * 幣安 WebSocket Stream
   */
  private binanceStreamWs: BinanceStreamWs;

  /**
   * 幣安 WebSocket API
   */
  private binanceApiWs: BinanceApiWs;

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
   * MAX 最新掛單價格
   */
  private maxLatestOrderPrice: number | null = null;

  constructor() {
    dotenv.config();

    this.binanceStreamWs = new BinanceStreamWs();
    this.binanceStreamWs.connect();

    this.binanceApiWs = new BinanceApiWs();
    this.binanceApiWs.connect();
    this.binanceApiWs.listenToOrderUpdate();

    this.maxWs = new MaxWs();
    this.maxWs.connectAndAuthenticate();

    this.maxRestApi = new MaxRestApi();
  }

  /**
   * Frederick kicks off!!!
   */
  public kicksOff = async (): Promise<void> => {
    log("Frederick kicks off!!!");

    await sleep(2000);

    this.maxWs.listenToRecentTrade(this.maxOrderUpdateCallback);

    // 等待 WebSocket 連線完成，兩秒後再開始執行
    await sleep(2000);

    log("已等待完成，開始執行");

    log(`目前策略方向：在 ${nowSellingExchange} 出售 BTC`);

    // 監聽幣安最新價格，並在取得價格後呼叫 binanceLatestPriceCallback
    this.binanceStreamWs.listenToLatestPrices(this.binanceLatestPriceCallback);
  };

  /**
   * Frederick goes to bed. 撤掉所有掛單。
   */
  public goToBed = async (): Promise<void> => {
    log("準備重啟程式，第一次撤回所有掛單");

    this.maxState = MaxState.SLEEP;

    const direction = nowSellingExchange === "MAX" ? "sell" : "buy";

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

      if (order.S === "wait" || order.S === "done") {
        if (+order.v === +order.rv) {
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
            timestamp: Date.now(),
          });

          this.orderIdSet.add(order.i);

          log(`掛單成功，訂單編號 ${order.i}`);

          if (this.maxState !== MaxState.SLEEP) {
            // 將 maxState 改為預設
            this.maxState = MaxState.DEFAULT;
          }

          continue;
        }

        log(`收到訂單成交訊息，訂單編號 ${order.i}`);

        // MAX 已成交數量
        const executedVolume = order.ev;

        // 如果現在是在 MAX 賣出，就在幣安買入；反之則在幣安賣出
        const direction = nowSellingExchange === "MAX" ? "BUY" : "SELL";

        this.binanceApiWs.placeMarketOrder(executedVolume, direction);

        if (+order.ev === +order.v) {
          log(`訂單已全部成交，訂單編號 ${order.i}`);
          const orderIndex = this.maxActiveOrders.findIndex(
            (order_) => order_.id === order.i
          );

          // 訂單已全部成交，從有效掛單紀錄中移除
          if (this.cancellingOrderSet.has(order.i)) {
            this.cancellingOrderSet.delete(order.i);
          }

          this.maxActiveOrders.splice(orderIndex, 1);

          if (
            !this.cancellingOrderSet.size &&
            this.maxState !== MaxState.SLEEP
          ) {
            // 如果沒有要撤的單，就將 maxState 改為預設以便掛新單
            this.maxState = MaxState.DEFAULT;
          }
        } else {
          log(`訂單僅部分成交，訂單編號 ${order.i}`);
        }

        continue;
      }

      log(`未知訂單狀態，訂單編號 ${order.i}，內容如下：`);
      console.log(order);
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

    // 將狀態改為等待掛單，避免幣安價格變化時重複掛單
    this.maxState = MaxState.PENDING_PLACE_ORDER;

    // MAX 理想掛單價格，根據當前策略方向有不同算法
    let maxIdealPrice: number = 0;

    if (nowSellingExchange === "MAX") {
      // 計算 MAX 理想掛單價格，也就是幣安最新價格上方 0.12%
      maxIdealPrice = parseFloat((price * 1.0012).toFixed(2));

      // 取得 MAX 最佳買價
      const maxBestBid = this.maxWs.getBestBid();

      // 如果最佳買價比理想掛單價格還高，則將理想掛單價格設為最佳買價 + 0.01
      if (maxBestBid >= maxIdealPrice) {
        log("MAX best bid 比理想掛單價格還高，調整掛單價格");
        maxIdealPrice = maxBestBid + 0.01;
      }
    } else {
      // 計算 MAX 理想掛單價格，也就是幣安最新價格下方 0.12%
      maxIdealPrice = parseFloat((price * 0.9988).toFixed(2));

      // 取得 MAX 最佳買價
      const maxBestAsk = this.maxWs.getBestAsk();

      // 如果最佳賣價比理想掛單價格還低，則將理想掛單價格設為最佳賣價 - 0.01
      if (maxBestAsk <= maxIdealPrice) {
        log("MAX best ask 比理想掛單價格還低，調整掛單價格");
        maxIdealPrice = maxBestAsk - 0.01;
      }
    }

    this.maxLatestOrderPrice = maxIdealPrice;

    // 掛單
    try {
      const direction = nowSellingExchange === "MAX" ? "sell" : "buy";

      const order = await this.maxRestApi.placeOrder(
        `${maxIdealPrice}`,
        direction
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

      this.maxState = MaxState.SLEEP;

      const direction = nowSellingExchange === "MAX" ? "sell" : "buy";

      log("第一次撤回所有掛單");

      await this.maxRestApi.clearOrders(direction);

      await sleep(5000);

      log("已等待五秒，再次撤回所有掛單");

      await this.maxRestApi.clearOrders(direction);

      log("撤回掛單完成。由於餘額不足，開始改變策略方向");

      nowSellingExchange = nowSellingExchange === "MAX" ? "Binance" : "MAX";

      log(`新策略方向：在 ${nowSellingExchange} 出售 BTC`);

      log("繼續執行 XEMM");

      this.maxState = MaxState.DEFAULT;
    }
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
      nowSellingExchange === "MAX" ? price * 1.0011 : price * 0.9989;

    const maxInvalidOrders = [];

    for (const order of this.maxActiveOrders) {
      // 如果此訂單正在撤銷，無需判斷撤單條件
      if (this.cancellingOrderSet.has(order.id)) {
        continue;
      }

      // 如果掛單時間已超過五秒，就需撤單
      if (Date.now() - order.timestamp >= 5000) {
        maxInvalidOrders.push(order);
        continue;
      }

      // 如果價格超出套利區間邊界，就需撤單
      if (
        (nowSellingExchange === "MAX" &&
          parseFloat(order.price) < borderPrice) ||
        (nowSellingExchange === "Binance" &&
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
          )} 或掛單時間超過五秒，撤銷掛單`
        );
        this.cancellingOrderSet.add(order.id);
        const direction = nowSellingExchange === "MAX" ? "sell" : "buy";
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
