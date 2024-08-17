import { restapiUrl } from "../environments/restapi-url";
import { BinanceRecentTradeResponse } from "../interfaces/binance-recent-trade-response";

export class BinanceRestApi {
  /**
   * 取得幣安特定交易對的最新成交價
   * @param symbol 交易對
   * @returns 最新成交價
   */
  public getRecentTradePrice = async (symbol: string): Promise<number> => {
    const response: BinanceRecentTradeResponse[] = await fetch(
      `${restapiUrl.binance.baseUrl}${restapiUrl.binance.recentTrades}?symbol=${symbol}&limit=1`
    ).then((res) => res.json());

    return parseFloat(response[0].price);
  };
}
