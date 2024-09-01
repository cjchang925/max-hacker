import dotenv from "dotenv";
import crypto from "crypto";
import { restapiUrl } from "../environments/restapi-url";

export class GateioRestApi {
  /**
   * Gateio API access key
   */
  private apiKey: string;

  /**
   * Gateio API secret key
   */
  private secret: string;

  constructor() {
    dotenv.config();

    this.apiKey = process.env.GATE_IO_API_KEY || "";
    this.secret = process.env.GATE_IO_SECRET || "";

    if (!this.apiKey || !this.secret) {
      throw new Error("Gate.io API Key not found");
    }
  }

  /**
   * Get balances in spot account and call the callback function
   * @param callback Called after getting balances
   */
  public getBalances = async (callback: Function): Promise<void> => {
    const headers = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };

    const sign = this.generateSignature("GET", restapiUrl.gateio.balances);

    const response = await fetch(
      `${restapiUrl.gateio.baseUrl}${restapiUrl.gateio.balances}`,
      {
        method: "GET",
        headers: {
          ...headers,
          ...sign,
        },
      }
    );

    if (response.status !== 200) {
      throw new Error(`Failed to get balances on Gate.io`);
    }

    const balances = await response.json();

    if (callback) {
      callback(balances);
    }
  };

  private generateSignature(
    method: string,
    url: string,
    queryString: string | null = null,
    payloadString: string | null = null
  ): Record<string, string> {
    const key = this.apiKey;
    const secret = this.secret;

    const t = Date.now() / 1000;

    const hashedPayload = crypto
      .createHash("sha512")
      .update(payloadString || "", "utf8")
      .digest("hex");

    const s = `${method}\n${url}\n${queryString || ""}\n${hashedPayload}\n${t}`;

    const sign = crypto
      .createHmac("sha512", secret)
      .update(s, "utf8")
      .digest("hex");

    return {
      KEY: key,
      Timestamp: t.toString(),
      SIGN: sign,
    };
  }
}
