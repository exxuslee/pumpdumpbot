require("dotenv").config();
const Binance = require('binance-api-node');
const dayjs = require("dayjs");
const telegram = require('./telegram');
const {writeFile} = require("node:fs/promises");

// Constants
const TOKENS_FILE = './tokens1.json';
const STAT_FILE = './stat1.json';

class ExtremumTradingBot {
    constructor() {
        this.tokens = require(TOKENS_FILE);
        this.count = require(STAT_FILE).count;
        this.client = Binance.default({
            apiKey: process.env.BINANCE_PUBLIC_KEY, apiSecret: process.env.BINANCE_PRIVATE_KEY,
        });
        this.tgToken = process.env.TELEGRAM_TOKEN3;
        this.wsConnection = null;
        this.exitTimeoutMs = 30_000;
        this.retryExitTimeoutMs = 30_000;
        this.hourlyUpdateInterval = null;
    }

    log(message) {
        const timeLog = dayjs().format('HH:mm:ss');
        console.log(`${timeLog} ${message}`);
    }

    async writeTokensFile() {
        try {
            await writeFile(TOKENS_FILE, JSON.stringify(this.tokens, null, 2));
        } catch (error) {
            console.error("❌ Error writing tokens file:", error);
        }
    }

    async writeStatFile() {
        try {
            await writeFile(STAT_FILE, JSON.stringify({count: this.count}, null, 2));
        } catch (error) {
            console.error("❌ Error writing stats file:", error);
        }
    }

    async sendTelegramAlert(message, isSilent) {
        try {
            await telegram.sendMessage(message, this.tgToken, isSilent);
            this.log(`📱 Alert sent: ${message}`);
        } catch (error) {
            console.error("❌ Failed to send Telegram message:", error.message);
        }
    }

    async getCurrentPrice(ticker) {
        try {
            const pair = `${ticker}USDT`;
            const prices = await this.client.prices({symbol: pair});
            return parseFloat(prices[pair]);
        } catch (error) {
            console.error("❌ Error getting current price:", error.message);
            return null;
        }
    }

    async getHourlyCandes(tokenSymbol) {
        try {
            const pair = `${tokenSymbol}USDT`;
            const candles = await this.client.futuresCandles({
                symbol: pair, interval: "15m", limit: 17
            });

            if (!candles || candles.length === 0) {
                this.log(`⚠️ No hourly candles received for ${tokenSymbol}`);
                return {};
            }

            let sumVolume = 0.0;
            let min = 1_000_000.0;
            let max = 0.0;
            for (let i = 0; i < candles.length - 4; i++) {
                min = Math.min(min, parseFloat(candles[i].low))
                max = Math.max(max, parseFloat(candles[i].high))
                sumVolume = sumVolume + (parseFloat(candles[i].quoteVolume) / 120.0)
            }
            let overHigh = false;
            let overLow = false;
            for (let i = candles.length - 4; i < candles.length; i++) {
                overHigh = overHigh || (parseFloat(candles[i].high) > max)
                overLow = overLow || (parseFloat(candles[i].low) < min)
            }

            return {triggerVolume: sumVolume.toFixed(0), min: min, max: max, overHigh: overHigh, overLow: overLow};
        } catch (error) {
            console.error(`❌ Error getting hourly volume for ${tokenSymbol}:`, error.message);
            return {};
        }
    }

    async updateAllHourly() {
        const updatePromises = Object.keys(this.tokens).map(async (tokenSymbol) => {
            const token = this.tokens[tokenSymbol];
            let newExtremums = await this.getHourlyCandes(tokenSymbol);
            if (
                ((newExtremums.overHigh !== token.extremums.overHigh) && newExtremums.overHigh)
                || ((newExtremums.overLow !== token.extremums.overLow) && newExtremums.overLow)
            ) {
                `📊 ${token.key}:   \tvol:${newExtremums.triggerVolume} \tmin:${newExtremums.min} \tmax:${newExtremums.max} \toverHL:${+newExtremums.overHigh}${+newExtremums.overLow}`
            }
            token.extremums = newExtremums;
        });

        await Promise.all(updatePromises);

        const tokensArray = Object.entries(this.tokens).map(([key, value]) => ({key, ...value,}));
        const counts = tokensArray.reduce(
            (acc, token) => {
                if (token.extremums.overHigh) acc.overHigh += 1;
                if (token.extremums.overLow) acc.overLow += 1;
                return acc;
            },
            {overHigh: 0, overLow: 0}
        );

        await this.writeTokensFile();
        this.log(`✅ Updated. OverHigh: ${counts.overHigh} OverLow: ${counts.overLow}. Total: ${Object.keys(this.tokens).length}`);
    }

    startHourlyUpdates() {
        this.updateAllHourly().catch(error => {
            console.error("❌ Error in initial hourly volume update:", error);
        });
        this.hourlyUpdateInterval = setInterval(() => {
            this.updateAllHourly().catch(error => {
                console.error("❌ Error in periodic hourly volume update:", error);
            });
        }, 120_000);
    }

    async enterTrade(tokenSymbol, side, candle) {
        const token = this.tokens[tokenSymbol];

        token.side = side
        token.price = candle.close;
        token.startTime = Date.now();

        const message = `${tokenSymbol} ${side}: ${(+candle.close).toFixed(3)} ${(+candle.quoteVolume).toFixed(0)}`;

        this.log(`🎯 ${message}`);
        await this.sendTelegramAlert(message, false);
        await this.writeTokensFile();

        setTimeout(() => this.exitTrade(tokenSymbol), this.exitTimeoutMs);
    }

    async exitTrade(ticker) {
        const trade = this.tokens[ticker];
        try {
            const exitPrice = await this.getCurrentPrice(ticker);
            if (!exitPrice) {
                this.log(`⚠️ Cannot get current price for ${ticker}`);
                return;
            }

            const isLong = trade.side === '🟢';
            const pnlPercent = isLong ? (exitPrice - trade.price) / trade.price * 100 : (trade.price - exitPrice) / trade.price * 100;
            const timePassed = Date.now() - trade.startTime;

            if (pnlPercent > 0.3 || pnlPercent < -2.0 || timePassed > 300_000) { // 0.3% profit, -2% stop loss, or 5 min timeout
                this.count = this.count + pnlPercent - 0.1;
                const ico = pnlPercent > 0 ? "🚀" : "🔻";
                const message = `${ticker} ${trade.side}${ico}: ${(+trade.price).toFixed(4)} → ${exitPrice.toFixed(4)} = ${pnlPercent.toFixed(2)}% | Total: ${(+this.count).toFixed(2)}%`;
                await this.sendTelegramAlert(message, true);

                delete trade.side;
                await this.writeTokensFile();
                await this.writeStatFile();
            } else {
                setTimeout(() => this.exitTrade(ticker), this.retryExitTimeoutMs);
            }
        } catch (error) {
            console.error(`❌ Error exiting trade for ${ticker}:`, error.message);
            await this.sendTelegramAlert(`❌ Failed to exit trade for ${ticker}: ${error.message}`, true);
        }
    }

    async processCandle(candle) {
        const tokenSymbol = candle.symbol.slice(0, -4); // Remove 'USDT'
        const token = this.tokens[tokenSymbol];
        if (!token) {
            console.warn(`⚠️ Unknown token: ${tokenSymbol}`);
            return;
        }
        const ext = token.extremums;

        if (token.side || !ext.triggerVolume || (candle.quoteVolume < ext.triggerVolume)) return;

        if ((candle.close > ext.max) && ext.overLow) {
            this.enterTrade(tokenSymbol, '🟢', candle).then(r => true);
        }

        if ((candle.close < ext.min) && ext.overHigh) {
            this.enterTrade(tokenSymbol, '🔴', candle).then(r => true);
        }
    }

    startWebSocketMonitoring() {
        const pairs = Object.keys(this.tokens).map(key => `${key}USDT`);
        this.log(`👁️ Starting WebSocket monitoring for ${pairs.length} pairs on 1-minute candles`);
        try {
            this.wsConnection = this.client.ws.candles(pairs, '1m', candle => {
                this.processCandle(candle).catch(error => {
                    console.error("❌ Error processing candle:", error);
                });
            });
            this.log("✅ WebSocket connection established");
        } catch (error) {
            console.error("❌ WebSocket connection failed:", error);
            setTimeout(() => this.startWebSocketMonitoring(), 5000);
        }
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
            this.startHourlyUpdates();
            this.startWebSocketMonitoring();
            this.log("🚀 Bot is now running with extremum tracking and hourly volume API updates!");
        } catch (error) {
            console.error("❌ Bot startup failed:", error);
            process.exit(1);
        }
    }

    stop() {
        this.log("🛑 Shutting down bot...");

        if (this.wsConnection) {
            this.wsConnection();
            this.log("✅ WebSocket connection closed");
        }

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