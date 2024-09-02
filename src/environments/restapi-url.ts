/**
 * 各交易所的 API URL
 */
export const restapiUrl = {
  max: {
    baseUrl: "https://max-api.maicoin.com",
    placeOrder: "/api/v3/wallet/spot/order",
    cancelOrder: "/api/v3/order",
    clearOrders: "/api/v3/wallet/spot/orders",
    tradesOfOrder: "/api/v2/trades/my/of_order",
  },
  binance: {
    baseUrl: "https://api.binance.com",
    recentTrades: "/api/v3/trades",
  },
  gateio: {
    baseUrl: "https://api.gateio.ws",
    balances: "/api/v4/spot/accounts",
  },
};
