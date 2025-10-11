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
        .map(pair => pair.replace('PAXG', ''))
        .filter(pair => !pair.includes('_'))

    let futurePrices = await client.futuresPrices()
    let futureNoUSDT = Object.keys(futurePrices)
        .map(pair => pair.replace('USDT', ''))
        .map(pair => pair.replace('USDC', ''))
        .map(pair => pair.replace('PAXG', ''))
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
                    price: Math.round(entries[0].quote.USD.price * 1000) / 1000,
                    extremums: {
                        "triggerVolume": 0,
                        "min": 0.0,
                        "max": 0.0,
                        "overHigh": false,
                        "overLow": false
                    }
                };
            }
        }
    }
    const sortedCMCap = Object.fromEntries(Object.entries(cmcRanks)
        .filter(([, token]) => token.price > 0.01)
        .filter(([, token]) => token.cap > 50 && token.cap < 1000 )
        .sort(([, a], [, b]) => a.cap - b.cap)
    )

    fs.writeFileSync(`tokens.json`, JSON.stringify(sortedCMCap, null, 2), 'utf8');
    return sortedCMCap
}

getPairs().then(result => {
    console.log(result, result.length);
})