require("dotenv").config();
const Binance = require('binance-api-node');
const client = Binance.default({apiKey: process.env.BINANCE_PUBLIC_KEY, apiSecret: process.env.BINANCE_PRIVATE_KEY,})

async function test() {
    const candles = await client.futuresCandles({symbol: `PROVEUSDT`, interval: "15m", limit: 17})
    console.log(candles[0].high);
    console.log(candles[16].high);
}

 test()