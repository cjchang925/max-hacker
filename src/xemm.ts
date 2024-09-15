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
import cron from "node-cron";

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
   * The number of times the order has been cancelled,
   * used to determine which method to call when cancelling orders.
   */
  private cancelOrderCount = 0;

  /**
   * The price of the last order placed on MAX
   */
  private lastOrderPrice = 0;

  /**
   * The ID of cancelled orders
   */
  private cancelledOrderIds = new Set<number>();

  /**
   * The base crypto for XEMM
   */
  private crypto = {
    uppercase: "SOL",
    lowercase: "sol",
  };

  constructor() {
    dotenv.config();

    this.maxWs = new MaxWs(this.crypto);
    this.maxWs.listenToAccountUpdate(this.maxAccountUpdateCb);
    this.maxWs.listenToOrderUpdate(this.maxOrderUpdateCb);
    this.maxWs.listenToTradeUpdate(this.maxTradeUpdateCb);
    this.maxWs.listenToGeneralTradeUpdate(this.maxGeneralTradeUpdateCb);

    this.maxRestApi = new MaxRestApi(this.crypto);

    this.gateioWs = new GateioWs(this.crypto);

    this.gateioRestApi = new GateioRestApi();
    this.gateioRestApi.getBalances(this.updateGateioBalances);

    // Whenever a trade is filled on Gate.io, renew the balances.
    this.gateioWs.listenToPlacedOrderUpdate(() => {
      this.gateioRestApi.getBalances(this.updateGateioBalances);
    });
  }

  /**
   * Start XEMM strategy
   */
  public kicksOff = async (): Promise<void> => {
    // Wait 3 seconds for establishing connections
    await sleep(3000);

    log("After waiting for 3 seconds, start XEMM strategy");

    this.determineDirection();
    this.gateioWs.listenToOrderBookUpdate(this.gateioPriceUpdateCb);
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
   * @param price Gate.io current price
   */
  private gateioPriceUpdateCb = async (price: number): Promise<void> => {
    if (this.maxState !== MaxState.DEFAULT) {
      return;
    }

    this.processActiveOrders(price);

    if (this.maxActiveOrders.length || this.maxState !== MaxState.DEFAULT) {
      return;
    }

    // Change the state to prevent multiple executions
    this.maxState = MaxState.PLACING_ORDER;

    // Ideal price to place an order on MAX
    let maxIdealPrice: number = 0;

    if (this.nowSellingExchange === "MAX") {
      // 0.08% higher than Gate.io current price
      maxIdealPrice = parseFloat((price * 1.001).toFixed(2));

      const maxBestBid = this.maxWs.getBestBid();

      if (maxBestBid >= maxIdealPrice) {
        log("MAX best bid is higher than order price, add 0.01 to it");
        maxIdealPrice = maxBestBid + 0.01;
      }
    } else {
      // 0.08% lower than Gate.io current price
      maxIdealPrice = parseFloat((price * 0.999).toFixed(2));

      const maxBestAsk = this.maxWs.getBestAsk();

      if (maxBestAsk <= maxIdealPrice) {
        log("MAX best ask is lower than order price, subtract 0.01 from it");
        maxIdealPrice = maxBestAsk - 0.01;
      }
    }

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

      amount = Math.min(maxUSDTBalance / price, gateioCryptoBalance);
    }

    if (amount < 0.016) {
      log(`${this.crypto.uppercase} balance is not enough to place an order`);
      await this.reverseDirection();
      return;
    }

    // Adjust the amount to the third decimal place
    const adjustedAmount = (Math.floor(amount * 1000) / 1000).toString();

    try {
      const direction = this.nowSellingExchange === "MAX" ? "sell" : "buy";

      await this.maxRestApi.placeOrder(
        "post_only",
        `${maxIdealPrice}`,
        direction,
        adjustedAmount
      );
    } catch (error: any) {
      log(`Failed to place new order, error message: ${error.message}`);
      await this.reverseDirection();
    }
  };

  /**
   * Process active orders on MAX,
   * cancel orders with price difference less than 0.1%
   * or has been placed for more than 5 seconds.
   * @param price Gate.io current price
   */
  private processActiveOrders = (price: number) => {
    if (!this.maxActiveOrders.length) {
      return;
    }

    // The price border to cancel orders
    const borderPrice =
      this.nowSellingExchange === "MAX" ? price * 1.0008 : price * 0.9992;

    // The next possible price to place an order based on current price
    const nextPossiblePrice =
      this.nowSellingExchange === "MAX"
        ? (price * 1.001).toFixed(2)
        : (price * 0.999).toFixed(2);

    const maxInvalidOrders: MaxOrder[] = [];

    for (const order of this.maxActiveOrders) {
      // Cancel orders that have been placed for more than 5 seconds
      if (
        Date.now() - order.timestamp >= 5000 &&
        +order.price !== +nextPossiblePrice
      ) {
        maxInvalidOrders.push(order);
        continue;
      }

      // Cancel orders with price difference less than 0.1%
      if (
        this.nowSellingExchange === "MAX"
          ? +order.price < borderPrice
          : +order.price > borderPrice
      ) {
        maxInvalidOrders.push(order);
      }
    }

    if (!maxInvalidOrders.length) {
      return;
    }

    this.maxState = MaxState.CANCELLING_ORDER;

    const side = this.nowSellingExchange === "MAX" ? "sell" : "buy";

    this.cancelledOrderIds.add(maxInvalidOrders[0].id);

    // Use different methods to cancel orders to avoid frequently sending request to MAX's server.
    if (this.cancelOrderCount % 2) {
      this.maxRestApi.clearOrders(side);
    } else {
      for (const order of maxInvalidOrders) {
        this.maxRestApi.cancelOrder(order.id);
      }
    }

    this.cancelOrderCount++;

    if (this.cancelOrderCount > 999) {
      this.cancelOrderCount === 0;
    }

    this.maxActiveOrders.length = 0;

    setTimeout(async () => {
      if (this.cancelledOrderIds.has(maxInvalidOrders[0].id)) {
        log(
          "Did not receive the response of cancelling orders, restart XEMM strategy"
        );
        await this.reverseDirection();
      }
    }, 5000);
  };

  /**
   * Check if the order on MAX has possibly been filled
   * @param message MAX general trade message
   */
  private maxGeneralTradeUpdateCb = (message: MaxSocketMessage): void => {
    const price = parseFloat(message.t[0].p);

    if (price !== this.lastOrderPrice) {
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

    // this.gateioWs.adjustAndPlaceMarketOrder(
    //   this.nowSellingExchange === "MAX" ? "buy" : "sell",
    //   volume
    // );

    // log(`Hedged on Gate.io with volume ${volume}`);
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
   * Reverse the direction of XEMM
   */
  private reverseDirection = async (): Promise<void> => {
    this.maxState = MaxState.SLEEP;

    const direction = this.nowSellingExchange === "MAX" ? "sell" : "buy";

    log("Cancel all orders on MAX");

    await this.maxRestApi.clearOrders(direction);

    await sleep(5000);

    log("After 5 seconds, cancel all orders on MAX again");

    await this.maxRestApi.clearOrders(direction);

    log("Finished reverse direction, start XEMM again");

    this.nowSellingExchange =
      this.nowSellingExchange === "MAX" ? "Gate.io" : "MAX";

    this.maxState = MaxState.DEFAULT;
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

        this.cancelledOrderIds.delete(id);

        if (this.maxState !== MaxState.SLEEP) {
          this.maxState = MaxState.DEFAULT;
        }

        continue;
      }

      if (order.S === "wait" && +order.v === +order.rv) {
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

    for (const trade of tradeMessage.t) {
      const side = trade.sd === "bid" ? "buy" : "sell";

      log(
        `MAX filled ${side} order ID ${trade.oi} with price ${trade.p} and volume ${trade.v}`
      );

      // 9/14/2024 14:40: Moved hedging to general trade update
      const direction = trade.sd === "bid" ? "sell" : "buy";

      // Hedge on Gate.io with the same volume
      this.gateioWs.adjustAndPlaceMarketOrder(direction, trade.v);

      // Modify the remaining volume of the active order
      const orderIndex = this.maxActiveOrders.findIndex(
        (order) => order.id === trade.oi
      );

      if (orderIndex === -1) {
        log(`Order ${trade.oi} is not found, continue.`);

        if (this.maxState !== MaxState.SLEEP) {
          this.maxState = MaxState.DEFAULT;
        }

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

      if (this.maxState !== MaxState.SLEEP) {
        this.maxState = MaxState.DEFAULT;
      }
    }
  };

  /**
   * Stop XEMM strategy
   */
  public stop = async (): Promise<void> => {
    log("Stop XEMM strategy");
    this.maxState = MaxState.SLEEP;
    log("Cancel all orders on MAX");
    const direction = this.nowSellingExchange === "MAX" ? "sell" : "buy";
    await this.maxRestApi.clearOrders(direction);
    await sleep(5000);
    log("After 5 seconds, cancel all orders on MAX again");
    await this.maxRestApi.clearOrders(direction);
    log("Finished cancelling all orders on MAX");
    this.maxWs.close();
    this.gateioWs.close();
    log("Closed WebSocket connections");
  };
}

const main = () => {
  let xemm = new Xemm();
  xemm.kicksOff();

  cron.schedule("0 0 0 * * *", async () => {
    log("Restart XEMM strategy...");
    await xemm.stop();
    await sleep(5000);
    xemm = new Xemm();
    xemm.kicksOff();
  });
};

main();
