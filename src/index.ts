import { Xemm } from "./xemm";
import cron from "node-cron";

const main = () => {
  // If now is between 11:00 - 19:00, execute XEMM.
  const now = new Date();
  const hour = now.getHours();
  let xemm: Xemm | null = null;

  if (hour >= 11 && hour < 19) {
    // Execute moving bricks arbitrage.
  } else {
    xemm = new Xemm();
    xemm.kicksOff();
  }

  // At 19:00, stop moving bricks arbitrage and start XEMM.
  cron.schedule("0 19 * * *", () => {
    // TODO: Stop moving bricks arbitrage.

    xemm = new Xemm();
    xemm.kicksOff();
  });

  // At 11:00, stop XEMM and start moving bricks arbitrage.
  cron.schedule("0 11 * * *", () => {
    if (!xemm) {
      throw new Error("At 11:00, XEMM is not running.");
    }

    xemm.stop();

    // TODO: Start moving bricks arbitrage.
  });
};

main();
