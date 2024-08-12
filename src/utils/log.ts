import moment from "moment";

/**
 * 輸出時間與訊息
 * @param message 訊息
 */
export const log = (message: string) => {
  const now = moment().format("YYYY-MM-DD HH:mm:ss.SSS");
  console.log(`[${now}] INFO ${message}`);
};
