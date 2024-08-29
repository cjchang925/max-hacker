import { BinanceStreamWs } from "./websockets/binance-stream-ws";
import { MaxWs } from "./websockets/max-ws";
import { log } from "./utils/log";

const main = () => {
  // Get BNB/USDT price on MAX
  const maxWs = new MaxWs();
  maxWs.connectAndAuthenticate();

  // Get BNB/USDT price on Binance
  const binanceStreamWs = new BinanceStreamWs();
  binanceStreamWs.connect();

  binanceStreamWs.listenToLatestPrices((latestTradePrice: number) => {
    const maxBestAsk = maxWs.getBestAsk();
    const maxBestBid = maxWs.getBestBid();

    const maxBestAskDiff = (latestTradePrice - maxBestAsk) / latestTradePrice;
    const maxBestBidDiff = (maxBestBid - latestTradePrice) / latestTradePrice;

    if (maxBestAskDiff > 0.0011625) {
      log(`MAX 賣出，幣安買入：${maxBestAskDiff * 100}%`);
      log("-----");
    }

    if (maxBestBidDiff > 0.0011625) {
      log(`MAX 買入，幣安賣出：${maxBestBidDiff * 100}%`);
      log("-----");
    }
  });
};

main();
