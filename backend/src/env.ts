import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

export const env = {
  PORT: process.env.PORT || 3000,
  YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY ?? "",
};
