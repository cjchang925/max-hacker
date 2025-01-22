import WebSocket from "ws";
import { websocketUrl } from "./environments/websocket-url";
import * as parquet from "parquetjs";

interface MaxOrderBook {
  /**
   * Asks
   */
  a: Array<Array<string>>;

  /**
   * Bids
   */
  b: Array<Array<string>>;
}

interface MaxOrderBookMessage {
  /**
   * Channel
   */
  c: string;

  /**
   * Market
   */
  M: string;

  /**
   * Event
   */
  e: "subscribed" | "snapshot" | "update" | "error";

  /**
   * Asks
   */
  a: Array<Array<string>>;

  /**
   * Bids
   */
  b: Array<Array<string>>;

  /**
   * Timestamp
   */
  T: number;
}

interface OrderBookRecord {
  time: String;
  sym: String;
  timestamp: number;
  datetime: String;
  bid0: number;
  bid1: number;
  bid2: number;
  bid3: number;
  bid4: number;
  bid5: number;
  bid6: number;
  bid7: number;
  bid8: number;
  bid9: number;
  bidSize0: number;
  bidSize1: number;
  bidSize2: number;
  bidSize3: number;
  bidSize4: number;
  bidSize5: number;
  bidSize6: number;
  bidSize7: number;
  bidSize8: number;
  bidSize9: number;
  ask0: number;
  ask1: number;
  ask2: number;
  ask3: number;
  ask4: number;
  ask5: number;
  ask6: number;
  ask7: number;
  ask8: number;
  ask9: number;
  askSize0: number;
  askSize1: number;
  askSize2: number;
  askSize3: number;
  askSize4: number;
  askSize5: number;
  askSize6: number;
  askSize7: number;
  askSize8: number;
  askSize9: number;
  systimestamp: String;
}

const main = () => {
  const max_ws = new WebSocket(websocketUrl.max);

  let orderBook: MaxOrderBook = {
    a: [],
    b: [],
  };

  let records: OrderBookRecord[] = [];

  max_ws.on("open", () => {
    console.log("Connected to MAX WebSocket");

    setInterval(() => {
      max_ws.ping("test");
    }, 60000);

    const request = {
      action: "sub",
      subscriptions: [
        {
          channel: "book",
          market: `dogeusdt`,
          depth: 10,
        },
      ],
      id: `fred`,
    };

    max_ws.send(JSON.stringify(request));
  });

  max_ws.on("message", async (data: WebSocket.Data) => {
    const message: MaxOrderBookMessage = JSON.parse(data.toString());

    if (records.length > 10) {
      return;
    }

    if (message.e === "subscribed") {
      return;
    }

    if (message.e === "snapshot") {
      orderBook.a = message.a;
      orderBook.b = message.b;
    }

    if (message.e === "update") {
      for (const ask of message.a) {
        const index = orderBook.a.findIndex((order) => order[0] === ask[0]);

        if (index === -1 && parseFloat(ask[1]) > 0) {
          orderBook.a.push(ask);
        } else {
          if (parseFloat(ask[1]) === 0) {
            orderBook.a.splice(index, 1);
          } else {
            orderBook.a[index] = ask;
          }
        }
      }

      for (const bid of message.b) {
        const index = orderBook.b.findIndex((order) => order[0] === bid[0]);

        if (index === -1 && parseFloat(bid[1]) > 0) {
          orderBook.b.push(bid);
        } else {
          if (parseFloat(bid[1]) === 0) {
            orderBook.b.splice(index, 1);
          } else {
            orderBook.b[index] = bid;
          }
        }
      }
    }

    // Sort asks and bids
    orderBook.a.sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));
    orderBook.b.sort((a, b) => parseFloat(b[0]) - parseFloat(a[0]));

    // Push into records
    const record: OrderBookRecord = {
      time: new Date(message.T).toISOString(),
      sym: "DOGEUSDT",
      timestamp: message.T,
      datetime: new Date(message.T).toISOString(),
      bid0: parseFloat(orderBook.b[0][0]),
      bid1: parseFloat(orderBook.b[1][0]),
      bid2: parseFloat(orderBook.b[2][0]),
      bid3: parseFloat(orderBook.b[3][0]),
      bid4: parseFloat(orderBook.b[4][0]),
      bid5: parseFloat(orderBook.b[5][0]),
      bid6: parseFloat(orderBook.b[6][0]),
      bid7: parseFloat(orderBook.b[7][0]),
      bid8: parseFloat(orderBook.b[8][0]),
      bid9: parseFloat(orderBook.b[9][0]),
      bidSize0: parseFloat(orderBook.b[0][1]),
      bidSize1: parseFloat(orderBook.b[1][1]),
      bidSize2: parseFloat(orderBook.b[2][1]),
      bidSize3: parseFloat(orderBook.b[3][1]),
      bidSize4: parseFloat(orderBook.b[4][1]),
      bidSize5: parseFloat(orderBook.b[5][1]),
      bidSize6: parseFloat(orderBook.b[6][1]),
      bidSize7: parseFloat(orderBook.b[7][1]),
      bidSize8: parseFloat(orderBook.b[8][1]),
      bidSize9: parseFloat(orderBook.b[9][1]),
      ask0: parseFloat(orderBook.a[0][0]),
      ask1: parseFloat(orderBook.a[1][0]),
      ask2: parseFloat(orderBook.a[2][0]),
      ask3: parseFloat(orderBook.a[3][0]),
      ask4: parseFloat(orderBook.a[4][0]),
      ask5: parseFloat(orderBook.a[5][0]),
      ask6: parseFloat(orderBook.a[6][0]),
      ask7: parseFloat(orderBook.a[7][0]),
      ask8: parseFloat(orderBook.a[8][0]),
      ask9: parseFloat(orderBook.a[9][0]),
      askSize0: parseFloat(orderBook.a[0][1]),
      askSize1: parseFloat(orderBook.a[1][1]),
      askSize2: parseFloat(orderBook.a[2][1]),
      askSize3: parseFloat(orderBook.a[3][1]),
      askSize4: parseFloat(orderBook.a[4][1]),
      askSize5: parseFloat(orderBook.a[5][1]),
      askSize6: parseFloat(orderBook.a[6][1]),
      askSize7: parseFloat(orderBook.a[7][1]),
      askSize8: parseFloat(orderBook.a[8][1]),
      askSize9: parseFloat(orderBook.a[9][1]),
      systimestamp: new Date().toISOString(),
    };

    records.push(record);

    if (records.length === 100000) {
      // Write to parquet
      const schema = new parquet.ParquetSchema({
        time: { type: "UTF8" },
        sym: { type: "UTF8" },
        timestamp: { type: "INT64" },
        datetime: { type: "UTF8" },
        bid0: { type: "DOUBLE" },
        bid1: { type: "DOUBLE" },
        bid2: { type: "DOUBLE" },
        bid3: { type: "DOUBLE" },
        bid4: { type: "DOUBLE" },
        bid5: { type: "DOUBLE" },
        bid6: { type: "DOUBLE" },
        bid7: { type: "DOUBLE" },
        bid8: { type: "DOUBLE" },
        bid9: { type: "DOUBLE" },
        bidSize0: { type: "DOUBLE" },
        bidSize1: { type: "DOUBLE" },
        bidSize2: { type: "DOUBLE" },
        bidSize3: { type: "DOUBLE" },
        bidSize4: { type: "DOUBLE" },
        bidSize5: { type: "DOUBLE" },
        bidSize6: { type: "DOUBLE" },
        bidSize7: { type: "DOUBLE" },
        bidSize8: { type: "DOUBLE" },
        bidSize9: { type: "DOUBLE" },
        ask0: { type: "DOUBLE" },
        ask1: { type: "DOUBLE" },
        ask2: { type: "DOUBLE" },
        ask3: { type: "DOUBLE" },
        ask4: { type: "DOUBLE" },
        ask5: { type: "DOUBLE" },
        ask6: { type: "DOUBLE" },
        ask7: { type: "DOUBLE" },
        ask8: { type: "DOUBLE" },
        ask9: { type: "DOUBLE" },
        askSize0: { type: "DOUBLE" },
        askSize1: { type: "DOUBLE" },
        askSize2: { type: "DOUBLE" },
        askSize3: { type: "DOUBLE" },
        askSize4: { type: "DOUBLE" },
        askSize5: { type: "DOUBLE" },
        askSize6: { type: "DOUBLE" },
        askSize7: { type: "DOUBLE" },
        askSize8: { type: "DOUBLE" },
        askSize9: { type: "DOUBLE" },
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
        `orderbook-${time}.parquet`
      );

      for (const record of records) {
        writer.appendRow(record as any);
      }

      await writer.close();
      records.length = 0;
      console.log(`${time}: Wrote 100000 records to parquet`);
    }
  });
};

main();
