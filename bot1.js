require("dotenv").config();
const Binance = require('binance-api-node');
const dayjs = require("dayjs");
const telegram = require('./telegram');
const {writeFile} = require("node:fs");

tokens = require('./tokens1.json');
count = require('./stat1.json').count;

const client = Binance.default({apiKey: process.env.BINANCE_PUBLIC_KEY, apiSecret: process.env.BINANCE_PRIVATE_KEY,})
const tgToken = process.env.TELEGRAM_TOKEN
let timeLog

timeLog = dayjs(Date.now()).format('HH:mm:ss');
console.log(timeLog + ' == 💵 pump/dump BOT 💵 ==')

async function avgVolume() {
    for (const token of Object.keys(tokens)) {
        try {
            const ticks = await client.candles({symbol: `${token}USDT`, interval: "1d", limit: 14})
            tokens[token].avgQuoteVolume = ticks.reduce((sum, candle) => {
                return sum + parseFloat(candle.quoteVolume);
            }, 0) / ticks.length / 24;
            await new Promise(resolve => setTimeout(resolve, 200));
        } catch (e) {
            console.error(pair, e)
        }
    }
    console.log("Write tokens ...")
    await writeFile('tokens1.json', JSON.stringify(tokens, null, 2), (err) => {
        if (err !== null) console.error(err)
    });
}

avgVolume().then(() => {
    let sec = Number(dayjs(Date.now()).format('ss'));
    setTimeout(() => setInterval(avgVolume, 7_200_000), (60 - sec) * 1000)
})

let pairs = Object.keys(tokens).map(key => `${key}USDT`);
client.ws.candles(pairs, '1m', candle => {
    if (candle.quoteVolume > tokens[candle.symbol.slice(0, -4)].avgQuoteVolume && tokens[candle.symbol.slice(0, -4)].isStarted) {
        tokens[candle.symbol.slice(0, -4)].isStarted = true
        let direction = (candle.volume / 2) < candle.buyVolume
        telegram.sendMessage(`${direction ? 'pump' : 'dump'} ${tokens[candle.symbol.slice(0, -4)]}`, tgToken)
    }
})