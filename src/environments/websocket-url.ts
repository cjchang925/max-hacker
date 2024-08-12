/**
 * 各交易所的 WebSocket URL
 */
export const websocketUrl = {
  max: "wss://max-stream.maicoin.com/ws",
  binance: {
    stream: {
      btcusdtTrade: "wss://stream.binance.com:443/ws/btcusdt@aggTrade",
    },
    api: "wss://ws-api.binance.com:443/ws-api/v3",
  },
};
