import { createHmac } from "crypto";
import qs from "qs";
import dotenv from "dotenv";

const main = async () => {
  dotenv.config();

  const nonce = Date.now();

  const request = {
    currency: "usdt",
    nonce,
  };

  const paramsToBeSigned = {
    ...request,
    path: "/api/v3/withdraw_addresses",
  };

  const payload = Buffer.from(JSON.stringify(paramsToBeSigned)).toString(
    "base64"
  );

  const signature = createHmac("sha256", process.env.MAX_SECRET_KEY!)
    .update(payload)
    .digest("hex");

  const response = await fetch(
    `https://max-api.maicoin.com/api/v3/withdraw_addresses?${qs.stringify(
      request,
      {
        arrayFormat: "brackets",
      }
    )}`,
    {
      method: "POST",
      headers: {
        "X-MAX-ACCESSKEY": process.env.MAX_ACCESS_KEY!,
        "X-MAX-PAYLOAD": payload,
        "X-MAX-SIGNATURE": signature,
      },
    }
  ).then((res) => res.json());

  if (response.success === false) {
    throw new Error(response.error?.message);
  }

  console.log(response);
};

main();
