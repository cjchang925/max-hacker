/**
 * 各交易所的 WebSocket URL
 */
export const websocketUrl = {
  max: "wss://max-stream.maicoin.com/ws",
  binance: {
    stream: {
      btcusdtTrade: "wss://stream.binance.com:443/ws/btcusdt@aggTrade",
      btcfdusdTrade: "wss://stream.binance.com:443/ws/btcfdusd@trade",
      solfdusdTrade: "wss://stream.binance.com:443/ws/solfdusd@trade",
    },
    api: "wss://ws-api.binance.com:443/ws-api/v3",
  },
};
