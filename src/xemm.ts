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
   * The price of the last order placed on MAX
   */
  private lastOrderPrice: number | null = null;

  /**
   * The ID of cancelled orders
   */
  private cancelledOrderIds = new Set<number>();

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

    this.gateioRestApi = new GateioRestApi();
    this.gateioRestApi.getBalances(this.updateGateioBalances);
  }

  /**
   * Start XEMM strategy
   */
  public kicksOff = async (): Promise<void> => {
    log("Kickoff");

    this.maxWs.listenToAccountUpdate(this.maxAccountUpdateCb);
    this.maxWs.listenToOrderUpdate(this.maxOrderUpdateCb);
    this.maxWs.listenToTradeUpdate(this.maxTradeUpdateCb);
    this.maxWs.listenToGeneralTradeUpdate(this.maxGeneralTradeUpdateCb);

    // Whenever a trade is filled on Gate.io, renew the balances.
    this.gateioWs.listenToPlacedOrderUpdate(() => {
      this.gateioRestApi.getBalances(this.updateGateioBalances);
    });

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

    // Ideal price to place an order on MAX
    let maxIdealPrice: number = 0;

    const maxBestBid = this.maxWs.getBestBid();
    const maxBestAsk = this.maxWs.getBestAsk();

    // Check whether placing order at the best price on MAX is profitable.
    if (this.nowSellingExchange === "MAX") {
      for (let i = 0; i < 4; ++i) {
        if (maxBestAsk - this.tick + i * this.tick - price >= 0.0009) {
          maxIdealPrice = maxBestAsk - this.tick + i * this.tick;
          break;
        }
      }
    } else {
      for (let i = 0; i < 4; ++i) {
        if (price - (maxBestBid + this.tick - i * this.tick) >= 0.0009) {
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
      await this.restart(true);
      return;
    }

    // Adjust the amount to the third decimal place
    const adjustedAmount = Math.floor(amount).toString();

    try {
      const direction = this.nowSellingExchange === "MAX" ? "sell" : "buy";

      const order = await this.maxRestApi.placeOrder(
        "post_only",
        `${maxIdealPrice}`,
        direction,
        adjustedAmount
      );

      setTimeout(() => {
        // Check if the order has been placed
        if (this.maxState === MaxState.PLACING_ORDER) {
          log(
            `Did not receive the response of placing order ${order.id}, restart XEMM strategy`
          );
          this.restart(false);
        }
      }, 5000);
    } catch (error: any) {
      log(`Failed to place new order, error message: ${error.message}`);
      await this.restart(false);
    }
  };

  /**
   * Process active orders on MAX,
   * cancel orders with price difference less than 0.07%
   * or has been far from the best price on order book.
   * @param price Gate.io current price
   */
  private processActiveOrders = async (price: number) => {
    if (!this.maxActiveOrders.length) {
      return;
    }

    // The price border to cancel orders
    const borderPrice =
      this.nowSellingExchange === "MAX" ? price * 1.0006 : price * 0.9994;

    const maxBestBid = this.maxWs.getBestBid();
    const maxBestAsk = this.maxWs.getBestAsk();

    const order = this.maxActiveOrders[0];

    // Cancel orders with risky price difference
    if (
      this.nowSellingExchange === "MAX"
        ? +order.price < borderPrice || +order.price - maxBestAsk > 0.0003
        : +order.price > borderPrice || maxBestBid - +order.price > 0.0003
    ) {
      this.maxState = MaxState.CANCELLING_ORDER;
      this.cancelledOrderIds.add(order.id);

      try {
        this.maxRestApi.cancelOrder(order.id);
      } catch (error: any) {
        log(`Failed to cancel orders, error message: ${error.message}`);
        await this.restart(false);
        return;
      }

      this.maxActiveOrders.length = 0;

      setTimeout(async () => {
        if (this.cancelledOrderIds.has(order.id)) {
          log(
            "Did not receive the response of cancelling orders, restart XEMM strategy"
          );
          await this.restart(false);
        }
      }, 5000);
    }
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
   * @param reverse Whether to reverse the direction
   */
  public restart = async (reverse: boolean): Promise<void> => {
    log("Get restart signal, closing...");

    this.maxState = MaxState.SLEEP;
    const direction = this.nowSellingExchange === "MAX" ? "sell" : "buy";

    try {
      await this.maxRestApi.clearOrders(direction);
    } catch (error: any) {
      for (const order of this.maxActiveOrders) {
        this.maxRestApi.cancelOrder(order.id);
      }
    }

    this.maxActiveOrders.length = 0;
    this.cancelledOrderIds.clear();
    this.lastOrderPrice = null;
    this.maxWs.close();
    this.gateioWs.close();

    log("Finish closing, waiting 3 seconds...");
    await sleep(3000);
    log("Restarting...");

    this.maxWs = new MaxWs(this.crypto);
    this.gateioWs = new GateioWs(this.crypto);

    if (reverse) {
      this.nowSellingExchange =
        this.nowSellingExchange === "MAX" ? "Gate.io" : "MAX";
    }

    this.maxState = MaxState.DEFAULT;
    this.kicksOff();
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
        this.lastOrderPrice = null;

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

      this.lastOrderPrice = null;

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
    const direction = this.nowSellingExchange === "MAX" ? "sell" : "buy";
    await this.maxRestApi.clearOrders(direction);
    this.maxWs.close();
    this.gateioWs.close();
  };
}

const main = () => {
  let xemm = new Xemm();
  const twoHours = 2 * 60 * 60 * 1000;

  try {
    xemm.kicksOff();

    const interval = setInterval(() => {
      log("2 hours limit hit, restart XEMM strategy");
      xemm.restart(false);
    }, twoHours);

    // Listen for the SIGINT signal (Ctrl+C)
    process.on("SIGINT", () => {
      log("Gracefully shutting down...");
      clearInterval(interval);
      xemm.stop(); // Perform any necessary cleanup
      process.exit(0); // Exit the process
    });
  } catch (error: any) {
    xemm.stop();
  }
};

main();
