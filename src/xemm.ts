import dotenv from "dotenv";
import { log } from "./utils/log";
import { GateioWs } from "./websockets/gateio-ws";
import { MaxWs } from "./websockets/max-ws";
import { MaxRestApi } from "./restapis/max-restapi";
import { sleep } from "./utils/sleep";
import { MaxState } from "./enums/max-state";
import { MaxOrder } from "./interfaces/max-order";
import { GateioRestApi } from "./restapis/gateio-restapi";
import { MaxBalance } from "./interfaces/max-balance";
import { MaxAccountMessage } from "./interfaces/max-account-message";
import { MaxOrderMessage } from "./interfaces/max-order-message";
import { MaxTradeMessage } from "./interfaces/max-trade-message";
import { MaxSocketMessage } from "./interfaces/max-socket-message";
import { BinanceStreamWs } from "./websockets/binance-stream-ws";

/**
 * Whether the program should restart now
 */
let shouldRestart = true;

/**
 * Whether the program should restart after cancelling orders
 */
let suggestedRestart = false;

/**
 * The ID of placed orders on MAX
 */
let placedOrderIds = new Set<number>();

/**
 * The ID of cancelled orders
 */
let cancelledOrderIds = new Set<number>();

/**
 * Execute XEMM strategy on Gate.io and MAX
 */
export class Xemm {
  /**
   * Gate.io WebSocket instance
   */
  private gateioWs: GateioWs;

  /**
   * Gate.io Rest API instance
   */
  private gateioRestApi: GateioRestApi;

  /**
   * MAX WebSocket instance
   */
  private maxWs: MaxWs;

  /**
   * Binance WebSocket instance
   */
  private binanceWs: BinanceStreamWs;

  /**
   * MAX Rest API instance
   */
  private maxRestApi: MaxRestApi;

  /**
   * Balances on Gate.io.
   * Key: currency name, value: balance
   */
  private gateioBalances: Record<string, number> = {};

  /**
   * Current state on MAX
   */
  private maxState: MaxState = MaxState.DEFAULT;

  /**
   * Active orders on MAX
   */
  private maxActiveOrders: MaxOrder[] = [];

  /**
   * MAX 各幣種餘額，以幣種為 key，餘額為 value
   */
  private maxBalances: Record<string, MaxBalance> = {};

  /**
   * The exchange that is currently selling crypto,
   * determines the direction of XEMM execution.
   * "null" means the program has just started running
   * and has not yet decided on the direction of XEMM execution.
   */
  private nowSellingExchange: "MAX" | "Gate.io" | null = null;

  /**
   * The price of the last order placed on MAX
   */
  private lastOrderPrice: number | null = null;

  /**
   * The latest price on Binance
   */
  private binanceLatestPrice: number | null = null;

  /**
   * The base crypto for XEMM
   */
  private crypto = {
    uppercase: "DOGE",
    lowercase: "doge",
  };

  /**
   * The tick of prices
   */
  private tick = 0.0001;

  constructor() {
    dotenv.config();

    this.maxWs = new MaxWs(this.crypto);

    this.maxRestApi = new MaxRestApi(this.crypto);

    this.gateioWs = new GateioWs(this.crypto);

    this.binanceWs = new BinanceStreamWs(this.crypto);

    this.gateioRestApi = new GateioRestApi();
    this.gateioRestApi.getBalances(this.updateGateioBalances);
  }

  /**
   * Start XEMM strategy
   */
  public kicksOff = async (): Promise<void> => {
    log("Kickoff");

    if (await this.maxRestApi.checkIfOpenOrdersExist()) {
      log("Open orders exist, clear them");
      await this.maxRestApi.clearOrders("sell");
      await this.maxRestApi.clearOrders("buy");
      await sleep(3000);
      log("After clearing orders, restart again");
      this.maxWs.close();
      this.gateioWs.close();
      this.binanceWs.close();
      shouldRestart = true;
      return;
    }

    this.maxWs.listenToAccountUpdate(this.maxAccountUpdateCb);
    this.maxWs.listenToOrderUpdate(this.maxOrderUpdateCb);
    this.maxWs.listenToTradeUpdate(this.maxTradeUpdateCb);
    this.maxWs.listenToGeneralTradeUpdate(this.maxGeneralTradeUpdateCb);

    await sleep(3000);

    this.maxWs.authenticate();
    this.maxWs.subscribeOrderBook();

    // Whenever a trade is filled on Gate.io, renew the balances.
    this.gateioWs.listenToPlacedOrderUpdate(() => {
      this.gateioRestApi.getBalances(this.updateGateioBalances);
      setTimeout(() => {
        this.maxState = MaxState.DEFAULT;
      }, 1000);
    });

    this.binanceWs.connect();

    // Wait 3 seconds for establishing connections
    await sleep(3000);

    log("After waiting for 3 seconds, start XEMM strategy");

    this.determineDirection();
    this.gateioWs.listenToOrderBookUpdate(this.gateioPriceUpdateCb);
    this.binanceWs.listenToLatestPrices(this.binanceTradeUpdateCb);
  };

  /**
   * Determine the direction of XEMM execution.
   * If the total value of crypto on MAX is greater than that of USDT, sell on MAX;
   * otherwise, sell on Gate.io
   */
  private determineDirection = (): void => {
    const cryptoBalance = this.maxBalances[this.crypto.lowercase];
    const usdtBalance = this.maxBalances["usdt"];

    if (!cryptoBalance || !usdtBalance) {
      throw new Error(`${this.crypto.uppercase} or USDT balance is not found`);
    }

    const maxCryptoValue = cryptoBalance.available + cryptoBalance.locked;
    const maxUsdtValue = usdtBalance.available + usdtBalance.locked;

    const maxBestBid = this.maxWs.getBestBid();
    const maxBestAsk = this.maxWs.getBestAsk();
    const maxMidPrice = (maxBestBid + maxBestAsk) / 2;

    if (maxCryptoValue * maxMidPrice >= maxUsdtValue) {
      this.nowSellingExchange = "MAX";
    } else {
      this.nowSellingExchange = "Gate.io";
    }
  };

  /**
   * Executed after receiving the price update from Gate.io
   * @param fairPrice Gate.io current price
   * @param price Gate.io best bid price
   */
  private gateioPriceUpdateCb = async (
    fairPrice: number,
    price: number
  ): Promise<void> => {
    if (this.maxState !== MaxState.DEFAULT) {
      return;
    }

    this.processActiveOrders(fairPrice, price);

    if (this.maxActiveOrders.length || this.maxState !== MaxState.DEFAULT) {
      return;
    }

    // Ideal price to place an order on MAX
    let maxIdealPrice: number = 0;

    const maxBestBid = this.maxWs.getBestBid();
    const maxBestAsk = this.maxWs.getBestAsk();

    if (!this.binanceLatestPrice) {
      return;
    }

    // Check whether placing order at the best price on MAX is profitable.
    if (this.nowSellingExchange === "MAX") {
      for (let i = 0; i < 4; ++i) {
        if (
          (maxBestAsk - this.tick + i * this.tick - price) / price >= 0.0004 &&
          maxBestAsk - this.tick + i * this.tick - this.binanceLatestPrice >= 0
        ) {
          maxIdealPrice = maxBestAsk - this.tick + i * this.tick;
          break;
        }
      }
    } else {
      for (let i = 0; i < 4; ++i) {
        if (
          (price - (maxBestBid + this.tick - i * this.tick)) /
            (maxBestBid + this.tick - i * this.tick) >=
            0.0004 &&
          this.binanceLatestPrice - (maxBestBid + this.tick - i * this.tick) >= 0
        ) {
          maxIdealPrice = maxBestBid + this.tick - i * this.tick;
          break;
        }
      }
    }

    if (maxIdealPrice === 0) {
      return;
    }

    maxIdealPrice = Math.floor(maxIdealPrice * 10000) / 10000;

    // Change the state to prevent multiple executions
    this.maxState = MaxState.PLACING_ORDER;

    // Calculate the maximum amount for the placed order,
    // which is the minimum of the two exchanges' balances.
    let amount: number | null = null;

    if (this.nowSellingExchange === "MAX") {
      const maxCryptoBalance =
        this.maxBalances[this.crypto.lowercase].available;
      const gateioUSDTBalance = this.gateioBalances.USDT;

      amount = Math.min(maxCryptoBalance, gateioUSDTBalance / price);
    } else {
      const maxUSDTBalance = this.maxBalances["usdt"].available;
      const gateioCryptoBalance = this.gateioBalances[this.crypto.uppercase];

      amount = Math.min(maxUSDTBalance / maxIdealPrice, gateioCryptoBalance);
    }

    if (amount < 28) {
      log(`${this.crypto.uppercase} balance is not enough to place an order`);
      await this.restart();
      return;
    }

    // Adjust the amount to the third decimal place
    const adjustedAmount = Math.floor(amount).toString();

    try {
      const direction = this.nowSellingExchange === "MAX" ? "sell" : "buy";

      // In case the program has to restart.
      if (this.maxState !== MaxState.PLACING_ORDER) {
        return;
      }

      const order = await this.maxRestApi.placeOrder(
        "post_only",
        `${maxIdealPrice}`,
        direction,
        adjustedAmount
      );

      setTimeout(() => {
        // Check if the order has been placed
        if (!placedOrderIds.has(order.id)) {
          log(
            `Did not receive the response of placing order ${order.id}, restart XEMM strategy`
          );
          this.restart();
        }
      }, 5000);
    } catch (error: any) {
      log(`Failed to place new order, error message: ${error.message}`);
      await this.restart();
    }
  };

  /**
   * After receiving the price update from Binance, update the active orders on MAX
   * @param price Binance current price
   */
  private binanceTradeUpdateCb = async (price: number): Promise<void> => {
    this.binanceLatestPrice = price;

    if (!this.maxActiveOrders.length || this.maxState !== MaxState.DEFAULT) {
      return;
    }

    const order = this.maxActiveOrders[0];

    // Cancel orders with risky price difference
    if (
      this.nowSellingExchange === "MAX"
        ? (+order.price - price) / price < 0
        : (price - +order.price) / +order.price < 0
    ) {
      await this.cancelAnOrder(order);
    }
  };

  /**
   * Process active orders on MAX,
   * cancel orders with price difference less than 0.07%
   * or has been far from the best price on order book.
   * @param fairPrice Gate.io fair price
   * @param actualPrice Gate.io current price
   */
  private processActiveOrders = async (
    fairPrice: number,
    actualPrice: number
  ) => {
    if (!this.maxActiveOrders.length) {
      return;
    }

    const maxBestBid = this.maxWs.getBestBid();
    const maxBestAsk = this.maxWs.getBestAsk();

    const order = this.maxActiveOrders[0];

    // Cancel orders with risky price difference
    if (
      this.nowSellingExchange === "MAX"
        ? (+order.price - fairPrice) / fairPrice < 0.0002 ||
          (+order.price - actualPrice) / actualPrice < 0.0002 ||
          +order.price - maxBestAsk > 0.0004
        : (fairPrice - +order.price) / +order.price < 0.0002 ||
          (actualPrice - +order.price) / +order.price < 0.0002 ||
          maxBestBid - +order.price > 0.0004
    ) {
      await this.cancelAnOrder(order);
    }
  };

  /**
   * Try to cancel an order on MAX
   * @param order the order to be cancelled
   */
  private cancelAnOrder = async (order: MaxOrder) => {
    this.maxState = MaxState.CANCELLING_ORDER;

    try {
      this.maxRestApi.cancelOrder(order.id);
    } catch (error: any) {
      log(`Failed to cancel orders, error message: ${error.message}`);
      await this.restart();
      return;
    }

    this.maxActiveOrders.length = 0;

    if (suggestedRestart) {
      suggestedRestart = false;
      await this.restart();
    }

    setTimeout(async () => {
      if (!cancelledOrderIds.has(order.id)) {
        log(
          "Did not receive the response of cancelling orders, restart XEMM strategy"
        );
        await this.restart();
      }
    }, 5000);
  };

  /**
   * Check if the order on MAX has possibly been filled
   * @param message MAX general trade message
   */
  private maxGeneralTradeUpdateCb = (message: MaxSocketMessage): void => {
    const price = parseFloat(message.t[0].p);

    if (!this.lastOrderPrice || price !== this.lastOrderPrice) {
      return;
    }

    const gateioPrice =
      this.nowSellingExchange === "MAX"
        ? this.gateioWs.getBestAsk()
        : this.gateioWs.getBestBid();

    const volume = message.t[0].v;

    log(
      `MAX's order has probably been filled at ${price} with volume ${volume}. The ideal Gate.io hedge price is ${gateioPrice}`
    );
  };

  /**
   * Update the balances on Gate.io
   * @param balances Balances on Gate.io
   */
  private updateGateioBalances = (
    balances: { currency: string; available: string }[]
  ) => {
    for (const balance of balances) {
      this.gateioBalances[balance.currency] = parseFloat(balance.available);
    }
  };

  /**
   * Called when the account update message is received from MAX
   * @param accountMessage Account update message
   */
  private maxAccountUpdateCb = (accountMessage: MaxAccountMessage): void => {
    for (const balance of accountMessage.B) {
      this.maxBalances[balance.cu] = {
        available: parseFloat(balance.av),
        locked: parseFloat(balance.l),
      };
    }
  };

  /**
   * Restart the strategy
   */
  public restart = async (): Promise<void> => {
    this.maxState = MaxState.SLEEP;

    log("Get restart signal, closing...");

    try {
      await this.maxRestApi.clearOrders("sell");
      await this.maxRestApi.clearOrders("buy");
    } catch (error: any) {
      for (const order of this.maxActiveOrders) {
        this.maxRestApi.cancelOrder(order.id);
      }
    }

    this.maxActiveOrders.length = 0;
    cancelledOrderIds.clear();
    placedOrderIds.clear();
    this.lastOrderPrice = null;
    this.maxWs.close();
    this.gateioWs.close();
    this.binanceWs.close();

    log("Finish closing, waiting 3 seconds...");
    await sleep(3000);
    shouldRestart = true;
  };

  /**
   * Called when the order update message is received from MAX
   * @param orderMessage Order update message
   */
  public maxOrderUpdateCb = (orderMessage: MaxOrderMessage): void => {
    if (!orderMessage.e.includes("order")) {
      return;
    }

    for (const order of orderMessage.o) {
      // If the order is cancelled, remove it from the active orders list
      if (order.S === "cancel") {
        const id = order.i;

        log(`Successfully cancelled order ${id}`);

        cancelledOrderIds.add(id);
        this.lastOrderPrice = null;

        if (this.maxState !== MaxState.SLEEP) {
          this.maxState = MaxState.DEFAULT;
        }

        continue;
      }

      if (order.S === "wait" && +order.v === +order.rv) {
        placedOrderIds.add(order.i);

        // If the order is placed successfully, add it to the active orders list
        this.maxActiveOrders.push({
          id: order.i,
          price: order.p,
          state: order.S,
          volume: order.v,
          remainingVolume: order.rv,
          timestamp: Date.now(),
        });

        this.lastOrderPrice = parseFloat(order.p);

        log(`A new order has been placed with ID ${order.i}`);

        if (this.maxState !== MaxState.SLEEP) {
          this.maxState = MaxState.DEFAULT;
        }
      }
    }
  };

  /**
   * Called when the trade update message is received from MAX
   * @param tradeMessage Trade update message
   */
  public maxTradeUpdateCb = (tradeMessage: MaxTradeMessage): void => {
    log(`Received trade message from MAX`);

    this.maxState = MaxState.PLACING_MARKET_ORDER;

    for (const trade of tradeMessage.t) {
      const side = trade.sd === "bid" ? "buy" : "sell";

      log(
        `MAX filled ${side} order ID ${trade.oi} with price ${trade.p} and volume ${trade.v}`
      );

      // 9/14/2024 14:40: Moved hedging to general trade update
      const direction = trade.sd === "bid" ? "sell" : "buy";

      // Hedge on Gate.io with the same volume
      this.gateioWs.adjustAndPlaceMarketOrder(
        direction,
        trade.v,
        this.gateioBalances
      );

      // Modify the remaining volume of the active order
      const orderIndex = this.maxActiveOrders.findIndex(
        (order) => order.id === trade.oi
      );

      if (orderIndex === -1) {
        log(`Order ${trade.oi} is not found, continue.`);
        continue;
      }

      const order = this.maxActiveOrders[orderIndex];

      const remainingVolume = +order.remainingVolume - +trade.v;

      if (remainingVolume !== 0) {
        order.remainingVolume = remainingVolume.toString();
        continue;
      }

      log(`Order ${order.id} has been fully filled`);

      this.maxActiveOrders.splice(orderIndex, 1);

      this.lastOrderPrice = null;
    }
  };
}

const main = async () => {
  const twoHours = 1000 * 60 * 60 * 2;

  setInterval(() => {
    log("2 hours limit hit, suggest XEMM strategy to restart");
    suggestedRestart = true;
  }, twoHours);

  while (true) {
    if (shouldRestart) {
      log("Main thread receives start signal...");
      shouldRestart = false;
      const xemm = new Xemm();
      xemm.kicksOff();
    } else {
      await sleep(5000);
    }
  }
};

main();
