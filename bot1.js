require("dotenv").config();
const Binance = require('binance-api-node');
const dayjs = require("dayjs");
const {getPairs} = require("./getTokens");

class ExtremumTradingBot {
    constructor() {
        this.tokens = {};
        this.client = Binance.default({
            apiKey: process.env.BINANCE_PUBLIC_KEY, apiSecret: process.env.BINANCE_PRIVATE_KEY,
        });
    }

    log(message) {
        const timeLog = dayjs().format('HH:mm:ss');
        console.log(`${timeLog} ${message}`);
    }

    async logTop10Diff() {
        const diffs = Object.entries(this.tokens)
            .map(([symbol, token]) => {
                const {spot, futures, price, cap} = token;
                if (!spot || !futures) return null;
                const diffPS = ((futures - price) / price) * 100;
                const diffSF = ((futures - spot) / spot) * 100;
                return {symbol, cap, price, spot, futures, diffPS, diffSF};
            })
            .filter(Boolean)
            .filter(r =>  !['STRAX', 'GLMR', 'RAD', 'IDEX', 'SNT', 'AERGO', 'WAVES', 'OMG', 'BAL', 'BADGER'].includes(r.symbol))
            .sort((a, b) => Math.abs(b.diffPS) - Math.abs(a.diffPS))
            .slice(0, 10);

        diffs.forEach(({symbol, cap, price, spot, futures, diffPS, diffSF}, i) => {
            this.log(
                `${symbol.padEnd(8)} ` +
                `${cap}\t` +
                `cmc: ${+price.toFixed(6)}\t` +
                `  f: ${futures.toFixed(6)}\t` +
                `  s: ${spot.toFixed(6)}\t` +
                `p/f: ${diffPS.toFixed(2)}%\t` +
                `s/f: ${diffSF.toFixed(2)}% `
            );
        });
        this.log('----------------------------------------');
    }

    async updateAllHourly() {
        this.tokens = await getPairs()
        let spot = await this.client.prices()
        let futures = await this.client.futuresPrices()
        const updatePromises = Object.keys(this.tokens).map(async (tokenSymbol) => {
            const token = this.tokens[tokenSymbol];
            token.spot = parseFloat(spot[`${tokenSymbol}USDT`])
            token.futures = parseFloat(futures[`${tokenSymbol}USDT`])
        });

        await Promise.all(updatePromises);
        await this.logTop10Diff()
    }


    startHourlyUpdates() {
        this.updateAllHourly().catch(error => {
            console.error("❌ Error in initial hourly volume update:", error);
        });
        this.hourlyUpdateInterval = setInterval(() => {
            this.updateAllHourly().catch(error => {
                console.error("❌ Error in periodic hourly volume update:", error);
            });
        }, 300_000);
    }

    async start() {
        this.log("📊 == EXTREMUM TRADING BOT STARTING == 📊");
        try {
            if (!process.env.BINANCE_PUBLIC_KEY || !process.env.BINANCE_PRIVATE_KEY) {
                throw new Error("Missing Binance API credentials");
            }
            if (!process.env.TELEGRAM_TOKEN3) {
                throw new Error("Missing Telegram token");
            }
            await this.startHourlyUpdates();
            this.log("🚀 Bot is now running with extremum tracking and hourly volume API updates!");
        } catch (error) {
            console.error("❌ Bot startup failed:", error);
            process.exit(1);
        }
    }

    stop() {
        this.log("🛑 Shutting down bot...");
        if (this.hourlyUpdateInterval) {
            clearInterval(this.hourlyUpdateInterval);
            this.log("✅ Hourly update interval cleared");
        }
        this.log("👋 Bot stopped");
    }
}

process.on('SIGINT', () => {
    console.log('\n🛑 Received SIGINT, shutting down gracefully...');
    if (global.bot) {
        global.bot.stop();
    }
    process.exit(0);
});

const bot = new ExtremumTradingBot();
global.bot = bot;
bot.start().catch(error => {
    console.error("💥 Unhandled error:", error);
    process.exit(1);
});