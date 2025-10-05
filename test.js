require("dotenv").config();
const Binance = require('binance-api-node');
const client = Binance.default({apiKey: process.env.BINANCE_PUBLIC_KEY, apiSecret: process.env.BINANCE_PRIVATE_KEY,})

async function test() {
    const candles = await client.futuresCandles({symbol: `ETHUSDT`, interval: "15m", limit: 2})
    console.log(candles[candles.length - 2]);
}

// test()

let a = [1,2,3,4,5,6,7,8,9,0]
for (let i=0; i<a.length-1; i++) {
    console.log(a[i]);
}
console.log("Asd:",a[a.length-1]);