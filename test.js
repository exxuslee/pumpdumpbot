require("dotenv").config();
const Binance = require('binance-api-node');
const client = Binance.default({apiKey: process.env.BINANCE_FUTURE_PUBLIC_KEY, apiSecret: process.env.BINANCE_FUTURE_PRIVATE_KEY,})

async function test() {
    console.log(await client.futuresPrices())
}

// test()

async function createFuturesMarketOrder(symbol, side, quantity) {
    try {
        // 1️⃣ Устанавливаем режим кросс-маржи (1 = Cross, 2 = Isolated)
        // await client.futuresMarginType({
        //     symbol,
        //     marginType: 'CROSSED', // или 'ISOLATED' для изолированной
        // });

        // 2️⃣ Устанавливаем плечо 2x
        await client.futuresLeverage({
            symbol,
            leverage: 2,
        });

        // 3️⃣ Создаём маркет-ордер
        const order = await client.futuresOrder({
            symbol,                 // например 'BTCUSDT'
            side,                   // 'BUY' или 'SELL'
            type: 'MARKET',
            quantity,               // количество в базовой валюте
        });

        console.log('✅ Ордер создан:', order);
    } catch (err) {
        console.error('❌ Ошибка при создании ордера:', err);
    }
}

createFuturesMarketOrder('BNBUSDT', 'BUY', 0.01);