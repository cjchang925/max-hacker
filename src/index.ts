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

        if (orderIndex === -1) {
          // 表示是反向 XEMM 的撤單訊息，不需處理
          continue;
        }

        log(`撤單成功，訂單編號 ${id}`);

        this.maxActiveOrders.splice(orderIndex, 1);

        // 從正在撤銷的掛單編號集合中移除
        this.cancellingOrderSet.delete(id);

        // 從掛單初始範圍記錄中移除
        this.ordersInitialOutOfRangeMap.delete(id);

        // 將 maxState 改為預設以便掛新單
        this.maxState = MaxState.DEFAULT;

        continue;
      }

      if (order.S === "wait") {
        if (order.v === order.rv) {
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
          });

          this.orderIdSet.add(order.i);

          log(`掛單成功，訂單編號 ${order.i}`);

          // 將 maxState 改為預設
          this.maxState = MaxState.DEFAULT;

          continue;
        }

        // 掛單部分成交，更新有效掛單紀錄
        const id = order.i;

        const orderIndex = this.maxActiveOrders.findIndex(
          (order) => order.id === id
        );

        if (orderIndex === -1) {
          // 表示是反向 XEMM 的撤單訊息，不需處理
          continue;
        }

        this.maxActiveOrders[orderIndex].remainingVolume = order.rv;

        // MAX 已成交數量
        const executedVolume = (
          parseFloat(order.v) - parseFloat(order.rv)
        ).toString();

        this.binanceApiWs.placeMarketOrder(executedVolume, "BUY");
      }

      if (order.S === "done") {
        // 訂單已成交，在有效掛單紀錄中移除
        const id = order.i;

        const orderIndex = this.maxActiveOrders.findIndex(
          (order) => order.id === id
        );

        if (orderIndex === -1) {
          // 表示是反向 XEMM 的撤單訊息，不需處理
          continue;
        }

        this.maxActiveOrders.splice(orderIndex, 1);
        const volume = order.v;
        this.binanceApiWs.placeMarketOrder(volume, "BUY");
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

    // 計算 MAX 理想掛單價格，也就是幣安最新價格上方 0.17%
    let maxIdealSellPrice = parseFloat((price * 1.0017).toFixed(2));

    // 取得 MAX 最佳買價
    const maxBestBid = this.maxWs.getBestBid();

    // 是否在掛單時就已經受掛單簿影響而使價格超出套利區間
    let isInitialOutOfRange = false;

    // 如果最佳買價比理想掛單價格還高，則將理想掛單價格設為最佳買價 + 0.01
    if (maxBestBid >= maxIdealSellPrice) {
      log("MAX best bid 比理想掛單價格還高，調整掛單價格");
      maxIdealSellPrice = maxBestBid + 0.01;
      isInitialOutOfRange = true;
    }

    this.maxLatestOrderPrice = maxIdealSellPrice;

    // 掛單
    try {
      const order = await this.maxRestApi.placeOrder(
        maxIdealSellPrice.toString(),
        "sell"
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
    }
  };

  /**
   * 處理 MAX 訂單簿上的掛單，撤銷價格超出套利區間的單子
   * 套利區間：幣安價格上方 0.16% ~ 0.18%
   * @param price 幣安最新價格
   */
  private processActiveOrders = async (price: number): Promise<void> => {
    if (!this.maxActiveOrders.length) {
      return;
    }

    const minPrice = price * 1.0016;
    const maxPrice = price * 1.0018;

    const maxInvalidOrders = [];

    for (const order of this.maxActiveOrders) {
      // 如果此訂單正在撤銷，無需判斷撤單條件
      if (this.cancellingOrderSet.has(order.id)) {
        continue;
      }

      // 如果一開始掛單是在套利區間內且現在價格超出套利區間，就需撤單
      if (
        (+order.price < minPrice || +order.price > maxPrice) &&
        !this.ordersInitialOutOfRangeMap.get(order.id)
      ) {
        maxInvalidOrders.push(order);
        continue;
      }

      // 如果一開始掛單是在套利區間內，表示現在依然如此，不需撤單
      if (!this.ordersInitialOutOfRangeMap.get(order.id)) {
        continue;
      }

      // 如果一開始掛單是在套利區間外且現在 best bid 比掛單價格還低超過 0.01，就需撤單
      const maxBestBid = this.maxWs.getBestBid();

      if (maxBestBid < +order.price - 0.01) {
        maxInvalidOrders.push(order);
      }
    }

    if (maxInvalidOrders.length) {
      this.maxState = MaxState.PENDING_CANCEL_ORDER;

      for (const order of maxInvalidOrders) {
        log(
          `現有掛單價格 ${order.price} 超過套利區間 ${minPrice.toFixed(
            3
          )} ~ ${maxPrice.toFixed(3)}，撤銷掛單`
        );
        this.cancellingOrderSet.add(order.id);
        await this.maxRestApi.cancelOrder(order.id);
      }

      this.maxState = MaxState.DEFAULT;
    }
  };
}

const main = () => {
  const frederick = new Frederick();
  frederick.kicksOff();
};

main();
