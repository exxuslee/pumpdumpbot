require("dotenv").config()
const fs = require('fs');
const Binance = require('binance-api-node')
const client = Binance.default({apiKey: process.env.BINANCE_PUBLIC_KEY, apiSecret: process.env.BINANCE_PRIVATE_KEY,})
const axios = require('axios');
const url = 'https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest';

async function getPairs() {

    let spotPrices = await client.prices()
    let spotNoUSDT = Object.keys(spotPrices)
        .filter(pair => pair.endsWith('USDT'))
        .map(pair => pair.replace('USDT', ''))
        .map(pair => pair.replace('USDC', ''))
        .filter(pair => !pair.includes('_'))

    let futurePrices = await client.futuresPrices()
    let futureNoUSDT = Object.keys(futurePrices)
        .map(pair => pair.replace('USDT', ''))
        .map(pair => pair.replace('USDC', ''))
        .filter(pair => !pair.includes('_'))

    const commonPairs = futureNoUSDT.filter(pair => spotNoUSDT.includes(pair));
    commonPairs.sort();

    const chunkSize = 100;
    const chunks = [];
    const cmcRanks = {};
    for (let i = 0; i < commonPairs.length; i += chunkSize) {
        chunks.push(commonPairs.slice(i, i + chunkSize));
    }
    for (const chunk of chunks) {
        const response = await axios.get(url, {
            headers: {
                'X-CMC_PRO_API_KEY': process.env.CMC_API_KEY,
                'Accept': 'application/json',
            },
            params: {symbol: chunk.join(','),},
        });

        for (const [symbol, entries] of Object.entries(response.data.data)) {
            if (entries.length > 0) {
                cmcRanks[symbol] = {
                    cap: entries[0].cmc_rank,
                    price: entries[0].quote.USD.price
                };
            }
        }
    }
    const sortedCMCap = Object.fromEntries(Object.entries(cmcRanks)
        .filter(([, token]) => token.price > 0.0001)
        .filter(([, token]) => token.cap > 50 && token.cap < 1000 )
        .sort(([, a], [, b]) => a.cap - b.cap)
    )

    let sortedWeek = await Promise.all(
        Object.keys(sortedCMCap).map(async (coin) => {
            try {
                let week = await client.futuresCandles({symbol: `${coin}USDT`, interval: "1w", limit: 500});
                const maxHigh = week.reduce((max, candle) => {
                    const currentHigh = parseFloat(candle.volume);
                    return currentHigh > max ? currentHigh : max;
                }, -Infinity);
                const now = parseFloat(week[0].volume);
                if (maxHigh < now * 50) return coin
                else return null
            } catch (error) {
                return null
            }
        })
    )
    sortedWeek = sortedWeek.filter(Boolean)

    const finData = Object.fromEntries(Object.entries(sortedCMCap)
        .filter(([coin]) => sortedWeek.includes(coin))
    )

    fs.writeFileSync(`tokens1.json`, JSON.stringify(finData, null, 2), 'utf8');
    return sortedWeek
}

getPairs().then(result => {
    console.log(result, result.length);
})