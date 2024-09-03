import dotenv from "dotenv";
import { GateioWs } from "./websockets/gateio-ws";
import { GateioRestApi } from "./restapis/gateio-restapi";
import { MaxWs } from "./websockets/max-ws";
import { MaxRestApi } from "./restapis/max-restapi";
import { MaxAccountMessage } from "./interfaces/max-account-message";
import { MaxBalance } from "./interfaces/max-balance";
import { log } from "./utils/log";
import { MaxTradeMessage } from "./interfaces/max-trade-message";
import { sleep } from "./utils/sleep";
import { MaxState } from "./enums/max-state";

export class MoveBrick {
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
   * The base crypto for XEMM
   */
  private crypto = {
    uppercase: "SOL",
    lowercase: "sol",
  };

  /**
   * MAX 各幣種餘額，以幣種為 key，餘額為 value
   */
  private maxBalances: Record<string, MaxBalance> = {};

  /**
   * Balances on Gate.io.
   * Key: currency name, value: balance
   */
  private gateioBalances: Record<string, number> = {};

  /**
   * Current state on MAX
   */
  private maxState: MaxState = MaxState.DEFAULT;

  constructor() {
    dotenv.config();

    this.maxWs = new MaxWs(this.crypto);
    this.maxWs.listenToAccountUpdate(this.maxAccountUpdateCb);
    this.maxWs.listenToTradeUpdate(this.maxTradeUpdateCb);

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

    log("After waiting for 3 seconds, start moving bricks strategy");

    this.gateioWs.listenToOrderBookUpdate(this.gateioPriceUpdateCb);
  };

  /**
   * Executed after receiving the price update from Gate.io
   * @param price Gate.io current price
   */
  private gateioPriceUpdateCb = (price: number): void => {
    if (this.maxState !== MaxState.DEFAULT) {
      return;
    }

    const maxBestAsk = this.maxWs.getBestAsk();
    const maxBestBid = this.maxWs.getBestBid();

    if ((price - maxBestAsk) / maxBestAsk >= 1.0011) {
      log(`Price diff percentage: ${((price - maxBestAsk) / maxBestAsk) * 100}%`);
      this.maxState = MaxState.PLACING_ORDER;
      const volume = this.maxWs.getBestAskVolume();
      const maxUsdtBalance = this.maxBalances["usdt"].available;
      const gateioBaseBalance = this.gateioBalances[this.crypto.uppercase];
      const maxBaseVolume = maxUsdtBalance / maxBestAsk;

      const volumeToPlace = Math.min(
        volume,
        maxBaseVolume,
        gateioBaseBalance
      ).toString();

      if (+volumeToPlace <= 0.06 || +volumeToPlace * maxBestAsk <= 8) {
        throw new Error("Volume to place is too small");
      }

      this.gateioWs.adjustAndPlaceMarketOrder("sell", volumeToPlace);
      this.maxRestApi.placeOrder("market", null, "buy", volumeToPlace);
      return;
    }

    if ((maxBestBid - price) / price >= 1.0011) {
      log(`Price diff percentage: ${((maxBestBid - price) / price) * 100}%`);
      this.maxState = MaxState.PLACING_ORDER;
      const volume = this.maxWs.getBestBidVolume();
      const maxBaseBalance = this.maxBalances[this.crypto.lowercase].available;
      const gateioUsdtBalance = this.gateioBalances["USDT"];
      const gateioBaseVolume = gateioUsdtBalance / price;

      const volumeToPlace = Math.min(
        volume,
        gateioBaseVolume,
        maxBaseBalance
      ).toString();

      if (+volumeToPlace <= 0.06 || +volumeToPlace * maxBestAsk <= 8) {
        throw new Error("Volume to place is too small");
      }

      this.gateioWs.adjustAndPlaceMarketOrder("buy", volumeToPlace);
      this.maxRestApi.placeOrder("market", null, "sell", volumeToPlace);
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
   * Called when the trade update message is received from MAX
   * @param tradeMessage Trade update message
   */
  public maxTradeUpdateCb = (tradeMessage: MaxTradeMessage): void => {
    for (const trade of tradeMessage.t) {
      const side = trade.sd === "bid" ? "buy" : "sell";

      log(
        `MAX filled ${side} order ID ${trade.oi} with price ${trade.p} and volume ${trade.v}`
      );

      this.maxState = MaxState.DEFAULT;
    }
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
   * Stop the strategy
   */
  public stop = (): void => {
    this.maxState = MaxState.SLEEP;
    this.maxWs.close();
    this.gateioWs.close();
  };
}

new MoveBrick().kicksOff();
