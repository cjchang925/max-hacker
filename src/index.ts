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
   * MAX 掛單與撤單狀態
   */
  private maxState: MaxState = MaxState.DEFAULT;

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
      if (order.S === "cancel") {
        // 收到撤單訊息，將已撤銷的掛單從有效掛單紀錄中移除
        const id = order.i;

        const orderIndex = this.maxActiveOrders.findIndex(
          (order) => order.id === id
        );

        if (orderIndex === -1) {
          throw new Error(`找不到訂單編號 ${id}`);
        }

        this.maxActiveOrders.splice(orderIndex, 1);

        // 將 maxState 改為預設以便掛新單
        this.maxState = MaxState.DEFAULT;

        continue;
      }

      if (order.S === "wait") {
        if (order.v === order.rv) {
          // 新掛單訊息，將新掛單加入有效掛單紀錄
          this.maxActiveOrders.push({
            id: order.i,
            price: order.p,
            state: order.S,
            volume: order.v,
            remainingVolume: order.rv,
          });

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
          throw new Error(`找不到訂單編號 ${id}`);
        }

        this.maxActiveOrders[orderIndex].remainingVolume = order.rv;

        // MAX 已成交數量
        const executedVolume = (
          parseFloat(order.v) - parseFloat(order.rv)
        ).toString();

        this.binanceApiWs.placeMarketOrder(executedVolume);
      }

      if (order.S === "done") {
        // 訂單已成交，在有效掛單紀錄中移除
        const id = order.i;

        const orderIndex = this.maxActiveOrders.findIndex(
          (order) => order.id === id
        );

        if (orderIndex === -1) {
          throw new Error(`找不到訂單編號 ${id}`);
        }

        this.maxActiveOrders.splice(orderIndex, 1);
        const volume = order.v;
        this.binanceApiWs.placeMarketOrder(volume);
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

    // 如果最佳買價比理想掛單價格還高，則將理想掛單價格設為最佳買價 + 0.01
    if (maxBestBid >= maxIdealSellPrice) {
      log("MAX best bid 比理想掛單價格還高，調整掛單價格");
      maxIdealSellPrice = maxBestBid + 0.01;
    }

    // 掛單
    try {
      await this.maxRestApi.placeOrder(maxIdealSellPrice.toString());
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

    const maxInvalidOrders = this.maxActiveOrders.filter(
      (order) => +order.price < minPrice || +order.price > maxPrice
    );

    const maxValidOrders = this.maxActiveOrders.filter(
      (order) => +order.price >= minPrice && +order.price <= maxPrice
    );

    if (maxInvalidOrders.length) {
      this.maxState = MaxState.PENDING_CANCEL_ORDER;

      for (const order of maxInvalidOrders) {
        log(
          `現有掛單價格 ${order.price} 超過套利區間 ${minPrice} ~ ${maxPrice}，撤銷掛單`
        );
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
