import WebSocket from "ws";
import { websocketUrl } from "./environments/websocket-url";
import * as parquet from "parquetjs";

interface MaxTradeMessage {
  /**
   * Event
   */
  e: string;

  /**
   * Trades
   */
  t: {
    /**
     * Price
     */
    p: string;

    /**
     * Volume
     */
    v: string;

    /**
     * Timestamp
     */
    T: number;

    /**
     * Side
     */
    tr: string;
  }[];

  /**
   * Timestamp
   */
  T: number;
}

interface TradeRecord {
  time: String;
  sym: String;
  timestamp: number;
  datetime: String;
  amount: number;
  price: number;
  cost: number;
  id: String;
  side: String;
  takerOrMaker: String;
  systimestamp: String;
}

const main = () => {
  const max_ws = new WebSocket(websocketUrl.max);
  let records: TradeRecord[] = [];

  max_ws.on("open", () => {
    console.log("Connected to MAX WebSocket");

    setInterval(() => {
      max_ws.ping("test");
    }, 60000);

    const request = {
      action: "sub",
      subscriptions: [
        {
          channel: "trade",
          market: `dogeusdt`,
        },
      ],
      id: `fred`,
    };

    max_ws.send(JSON.stringify(request));
  });

  max_ws.on("message", async (data: WebSocket.Data) => {
    const message: MaxTradeMessage = JSON.parse(data.toString());

    if (message.e !== "update" && message.e !== "snapshot") {
      return;
    }

    // Sort trades by timestamp
    message.t.sort((a, b) => a.T - b.T);

    for (const trade of message.t) {
      const record: TradeRecord = {
        time: new Date(trade.T).toISOString(),
        sym: "DOGEUSDT",
        timestamp: trade.T,
        datetime: new Date(trade.T).toISOString(),
        amount: parseFloat(trade.v),
        price: parseFloat(trade.p),
        cost: parseFloat(trade.v) * parseFloat(trade.p),
        id: "",
        side: trade.tr === "up" ? "buy" : "sell",
        takerOrMaker: "taker",
        systimestamp: new Date().toISOString(),
      };

      records.push(record);
    }

    if (records.length >= 1000) {
      const schema = new parquet.ParquetSchema({
        time: { type: "UTF8" },
        sym: { type: "UTF8" },
        timestamp: { type: "INT64" },
        datetime: { type: "UTF8" },
        amount: { type: "DOUBLE" },
        price: { type: "DOUBLE" },
        cost: { type: "DOUBLE" },
        id: { type: "UTF8" },
        side: { type: "UTF8" },
        takerOrMaker: { type: "UTF8" },
        systimestamp: { type: "UTF8" },
      });

      const time = new Date()
        .toISOString()
        .replace(/:/g, "-")
        .replace(/\./g, "-")
        .replace("T", "-")
        .replace("Z", "");

      const writer = await parquet.ParquetWriter.openFile(
        schema,
        `trades-${time}.parquet`
      );

      for (const record of records) {
        writer.appendRow(record as any);
      }

      await writer.close();
      records.length = 0;
      console.log(`${time}: Wrote 1000 records to parquet`);
    }
  });
};

main();
