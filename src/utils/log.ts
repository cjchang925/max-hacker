import moment from "moment";
import "moment-timezone";

/**
 * 輸出時間與訊息
 * @param message 訊息
 */
export const log = (message: string) => {
  const now = moment().tz("Asia/Taipei").format("YYYY-MM-DD HH:mm:ss.SSS");
  console.log(`[${now}] INFO ${message}`);
};
