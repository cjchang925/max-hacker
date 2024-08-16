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
   * 記錄掛單是否在掛單時就已經受掛單簿影響而使價格超出套利區間
   */
  private ordersInitialOutOfRangeMap: Map<number, boolean> = new Map();

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

    // 監聽幣安最新價格，並在取得價格後呼叫 binanceLatestPriceCallback
    this.binanceStreamWs.listenToLatestPrices(this.binanceLatestPriceCallback);
  };

  /**
   * Frederick goes to bed. 撤掉所有掛單。
   */
  public goToBed = async (): Promise<void> => {
    log("準備重啟程式，第一次撤回所有掛單");

    this.maxState = MaxState.SLEEP;

    await this.maxRestApi.clearOrders("buy");

    await sleep(5000);

    log("第一次撤回後等待五秒，再次撤回所有掛單");

    await this.maxRestApi.clearOrders("buy");
  };

  /**
   * 在 MAX 掛單狀態更新時呼叫的 callback
   * @param orderMessage 更新掛單狀態的訊息
   */
  public maxOrderUpdateCallback = (orderMessage: MaxOrderMessage): void => {
    for (const order of orderMessage.o) {
      if (order.S === "cancel") {
        const id = order.i;

        const orderIndex = this.maxActiveOrders.findIndex(
          (order) => order.id === id
        );

        if (orderIndex === -1) {
          // 表示是正向 XEMM 的撤單訊息，不需處理
          continue;
        }

        // 收到撤單訊息，將已撤銷的掛單從有效掛單紀錄中移除
        log(`撤單成功，訂單編號 ${id}`);

        this.maxActiveOrders.splice(orderIndex, 1);

        // 從正在撤銷的掛單編號集合中移除
        this.cancellingOrderSet.delete(id);

        // 從掛單初始範圍記錄中移除
        this.ordersInitialOutOfRangeMap.delete(id);

        if (!this.cancellingOrderSet.size && this.maxState !== MaxState.SLEEP) {
          // 如果沒有要撤的單，就將 maxState 改為預設以便掛新單
          this.maxState = MaxState.DEFAULT;
        }

        continue;
      }

      if (order.S === "wait") {
        if (order.v === order.rv) {
          // 如果已有掛單紀錄就不再重複加入
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

          continue;
        }

        log(`收到訂單部分成交訊息，訂單編號 ${order.i}`);

        // 掛單部分成交，更新有效掛單紀錄
        const id = order.i;

        const orderIndex = this.maxActiveOrders.findIndex(
          (order) => order.id === id
        );

        if (orderIndex === -1) {
          // 表示是正向 XEMM 的撤單訊息，不需處理
          continue;
        }

        this.maxActiveOrders[orderIndex].remainingVolume = order.rv;

        // MAX 已成交數量
        const executedVolume = (
          parseFloat(order.v) - parseFloat(order.rv)
        ).toString();

        this.binanceApiWs.placeMarketOrder(executedVolume, "SELL");
      }

      if (order.S === "done") {
        log(`收到訂單全部成交訊息，訂單編號 ${order.i}`);

        // 訂單已成交，在有效掛單紀錄中移除
        const id = order.i;

        const orderIndex = this.maxActiveOrders.findIndex(
          (order) => order.id === id
        );

        if (orderIndex === -1) {
          // 表示是正向 XEMM 的撤單訊息，不需處理
          continue;
        }

        const volume = order.v;
        this.binanceApiWs.placeMarketOrder(volume, "SELL");

        if (this.cancellingOrderSet.has(id)) {
          this.cancellingOrderSet.delete(id);
        }

        if (this.ordersInitialOutOfRangeMap.has(id)) {
          this.ordersInitialOutOfRangeMap.delete(id);
        }

        this.maxActiveOrders.splice(orderIndex, 1);

        if (!this.cancellingOrderSet.size && this.maxState !== MaxState.SLEEP) {
          // 如果沒有要撤的單，就將 maxState 改為預設以便掛新單
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

    // 將狀態改為等待掛單，避免幣安價格變化時重複掛單
    this.maxState = MaxState.PENDING_PLACE_ORDER;

    // 計算 MAX 理想掛單價格，也就是幣安最新價格下方 0.16%
    let maxIdealBuyPrice = parseFloat((price * 0.9984).toFixed(2));

    // 取得 MAX 最佳買價
    const maxBestAsk = this.maxWs.getBestAsk();

    // 是否在掛單時就已經受掛單簿影響而使價格超出套利區間
    let isInitialOutOfRange = false;

    // 如果最佳賣價比理想掛單價格還低，則將理想掛單價格設為最佳賣價 - 0.01
    if (maxBestAsk <= maxIdealBuyPrice) {
      log("MAX best ask 比理想掛單價格還低，調整掛單價格");
      maxIdealBuyPrice = maxBestAsk - 0.01;
      isInitialOutOfRange = true;
    }

    this.maxLatestOrderPrice = maxIdealBuyPrice;

    // 掛單
    try {
      const order = await this.maxRestApi.placeOrder(
        maxIdealBuyPrice.toString(),
        "buy"
      );

      // 紀錄訂單是否在掛單時就已經受掛單簿影響而使價格超出套利區間
      this.ordersInitialOutOfRangeMap.set(order.id, isInitialOutOfRange);

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
      await this.maxRestApi.clearOrders("buy");
      log("餘額不足掛單，停止 XEMM 策略，已撤回所有掛單");
      process.exit(1);
    }
  };

  /**
   * 處理 MAX 訂單簿上的掛單，撤銷價格超出套利區間的單子
   * 套利區間：幣安價格下方 0.16% ~ 0.18%
   * @param price 幣安最新價格
   */
  private processActiveOrders = async (price: number): Promise<void> => {
    if (!this.maxActiveOrders.length) {
      return;
    }

    const maxPrice = price * 0.9986;

    const maxInvalidOrders = [];

    for (const order of this.maxActiveOrders) {
      // 如果此訂單正在撤銷，無需判斷撤單條件
      if (this.cancellingOrderSet.has(order.id)) {
        continue;
      }

      // 如果一開始掛單是在套利區間內且現在價格超出套利區間，或是掛單時間已超過十秒，就需撤單
      if (
        (+order.price > maxPrice &&
          !this.ordersInitialOutOfRangeMap.get(order.id)) ||
        Date.now() - order.timestamp > 10000
      ) {
        maxInvalidOrders.push(order);
        continue;
      }

      // 如果一開始掛單是在套利區間內，表示現在依然如此，不需撤單
      if (!this.ordersInitialOutOfRangeMap.get(order.id)) {
        continue;
      }

      // 如果一開始掛單是在套利區間外且現在 best ask 比掛單價格還高超過 0.01，就需撤單
      const maxBestAsk = this.maxWs.getBestAsk();

      if (maxBestAsk > +order.price + 0.01) {
        maxInvalidOrders.push(order);
      }
    }

    if (maxInvalidOrders.length) {
      this.maxState = MaxState.PENDING_CANCEL_ORDER;

      for (const order of maxInvalidOrders) {
        log(
          `現有掛單價格 ${order.price} 高於套利區間邊界 ${maxPrice.toFixed(
            3
          )} 或掛單時間超過十秒，撤銷掛單`
        );
        this.cancellingOrderSet.add(order.id);
        this.maxRestApi.cancelOrder(order.id, "buy");

        setTimeout(() => {
          if (this.cancellingOrderSet.has(order.id)) {
            log(
              `120 秒後仍未收到撤單訊息，系統認定撤單成功，訂單編號 ${order.id}`
            );
            this.cancellingOrderSet.delete(order.id);
            this.ordersInitialOutOfRangeMap.delete(order.id);

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

const executeXemm = async () => {
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
  // Execute XEMM every 24 hours.
  executeXemm();
  setInterval(executeXemm, 24 * 60 * 60 * 1000);
};

main();
