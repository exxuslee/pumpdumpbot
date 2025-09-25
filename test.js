require("dotenv").config();
const Binance = require('binance-api-node');
const client = Binance.default({apiKey: process.env.BINANCE_PUBLIC_KEY, apiSecret: process.env.BINANCE_PRIVATE_KEY,})

async function test() {
    const candles = await client.futuresCandles({symbol: `ETHUSDT`, interval: "15m", limit: 2})
    console.log(candles[candles.length - 2]);
}

test()