/**
 * 各交易所的 WebSocket URL
 */
export const websocketUrl = {
  binance: {
    stream: {
      btcusdtTrade: "wss://stream.binance.com:443/ws/btcusdt@aggTrade",
      btcfdusdTrade: "wss://stream.binance.com:443/ws/btcfdusd@trade",
      btcusdcTrade: "wss://stream.binance.com:443/ws/btcusdc@trade",
      bnbusdcTrade: "wss://stream.binance.com:443/ws/bnbusdc@trade",
    },
    api: "wss://ws-api.binance.com:443/ws-api/v3",
  },
  gateio: "wss://api.gateio.ws/ws/v4/",
  max: "wss://max-stream.maicoin.com/ws",
};
