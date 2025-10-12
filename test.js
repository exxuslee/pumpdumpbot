require("dotenv").config();
const Binance = require('binance-api-node');
const client = Binance.default({apiKey: process.env.BINANCE_PUBLIC_KEY, apiSecret: process.env.BINANCE_PRIVATE_KEY,})

async function test() {
    console.log(await client.futuresPrices())
}

test()