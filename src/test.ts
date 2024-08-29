import moment from "moment";
import { BinanceStreamWs } from "./websockets/binance-stream-ws";
import { MaxWs } from "./websockets/max-ws";

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

    const time = moment().format("YYYY-MM-DD HH:mm:ss");

    if (maxBestAskDiff > 0.0011625) {
      console.log(`[${time}] MAX 賣出，幣安買入：${maxBestAskDiff * 100}%`);
      console.log("-----");
    }

    if (maxBestBidDiff > 0.0011625) {
      console.log(`[${time}] MAX 買入，幣安賣出：${maxBestBidDiff * 100}%`);
      console.log("-----");
    }
  });
};

main();
