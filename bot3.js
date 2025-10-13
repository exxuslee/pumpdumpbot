require("dotenv").config();
const Binance = require('binance-api-node');
const dayjs = require("dayjs");
const telegram = require('./telegram');
const {writeFile} = require("node:fs/promises");

// Constants
const TOKENS_FILE = './tokens3.json';
const STAT_FILE = './stat3.json';

class ExtremumTradingBot {
    constructor() {
        this.tokens = require(TOKENS_FILE);
        this.count = require(STAT_FILE).count;
        this.client = Binance.default({
            apiKey: process.env.BINANCE_PUBLIC_KEY, apiSecret: process.env.BINANCE_PRIVATE_KEY,
        });
        this.tgToken = process.env.TELEGRAM_TOKEN5;
        this.wsConnection = null;
        this.exitTimeoutMs = 3600_000;
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
                symbol: pair, interval: "15m", limit: 26
            });

            if (!candles || candles.length === 0) {
                this.log(`⚠️ No hourly candles received for ${tokenSymbol}`);
                return {};
            }

            let sumVolume = 0.0;
            let min = 1_000_000.0;
            let max = 0.0;
            for (let i = 0; i < candles.length - 6; i++) {
                min = Math.min(min, parseFloat(candles[i].low))
                max = Math.max(max, parseFloat(candles[i].high))
                sumVolume = sumVolume + parseFloat(candles[i].quoteVolume)
            }
            let overLow = 1_000_000.0;
            let overHigh = 0.0;
            for (let i = candles.length - 6; i < candles.length; i++) {
                overLow = Math.min(overLow, parseFloat(candles[i].low))
                overHigh = Math.max(overHigh, parseFloat(candles[i].high))
            }
            let triggerVolume = (sumVolume / 15).toFixed(0);

            return {triggerVolume: triggerVolume, max: max, min: min, overHigh: overHigh, overLow: overLow};
        } catch (error) {
            console.error(`❌ Error getting hourly volume for ${tokenSymbol}:`, error.message);
            return {};
        }
    }

    async updateAllHourly() {
        const updatePromises = Object.keys(this.tokens).map(async (tokenSymbol) => {
            const token = this.tokens[tokenSymbol];
            token.extremums = await this.getHourlyCandes(tokenSymbol);
        });

        await Promise.all(updatePromises);

        const tokensArray = Object.entries(this.tokens).map(([key, value]) => ({key, ...value,}));
        const counts = tokensArray.reduce(
            (acc, token) => {
                if (token.extremums.overHigh > token.extremums.max) acc.overHigh += 1;
                if (token.extremums.overLow < token.extremums.min) acc.overLow += 1;
                return acc;
            },
            {overHigh: 0, overLow: 0}
        );

        tokensArray.forEach(r => {
            const {key: tokenSymbol, cap, extremums} = r;
            if (
                (((counts.overHigh > counts.overLow) && (extremums.overLow < extremums.min)) ||
                    ((counts.overHigh < counts.overLow) && (extremums.overHigh > extremums.max))) &&
                !this.tokens[tokenSymbol].isSeen
            ) {
                this.log(
                    `${tokenSymbol.padEnd(8)} ${String(cap).padEnd(5)} ` +
                    `min:${extremums.min.toFixed(6).padEnd(12)} ` +
                    `max:${extremums.max.toFixed(6).padEnd(12)} ` +
                    `overHL:${(+(extremums.overHigh > extremums.max)).toString()}${(+(extremums.overLow < extremums.min)).toString()}`
                );
                this.tokens[tokenSymbol].isSeen = true
            }
            if ((extremums.overLow > extremums.min) && (extremums.overHigh < extremums.max)) {
                delete this.tokens[tokenSymbol].isSeen
            }

        });

        await this.writeTokensFile();
        this.log(`✅ OverHigh: ${counts.overHigh} OverLow: ${counts.overLow}`);
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

        const message = `${tokenSymbol} ${token.cap} ${side}: ${(+candle.close).toFixed(3)}`;

        this.log(`🎯 ${message}`);
        await this.sendTelegramAlert(message, false);
        await this.writeTokensFile();
    }

    async exitTrade(candle) {
        const tokenSymbol = candle.symbol.slice(0, -4); // Remove 'USDT'
        const token = this.tokens[tokenSymbol];
        try {
            const isLong = token.side === '📈';
            const pnlPercent = isLong ? (candle.close - token.price) / token.price * 100 : (token.price - candle.close) / token.price * 100;

            this.count = this.count + pnlPercent - 0.1;
            const ico = pnlPercent > 0 ? "🚀" : "🔻";
            const message = `${tokenSymbol} ${token.side}${ico}: ${(+token.price).toFixed(4)} → ${(+candle.close).toFixed(4)} = ${pnlPercent.toFixed(2)}% | Total: ${(+this.count).toFixed(2)}%`;
            delete token.side;
            delete token.price;
            await this.sendTelegramAlert(message, true);
            await this.writeTokensFile();
            await this.writeStatFile();
        } catch (error) {
            console.error(`❌ Error exiting trade for ${tokenSymbol}:`, error.message);
            await this.sendTelegramAlert(`❌ Failed to exit trade for ${tokenSymbol}: ${error.message}`, true);
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

        const start1 = !token.side
        const start2 = ext.triggerVolume
        const start3 = candle.quoteVolume > ext.triggerVolume
        const start4 = Date.now() - (token.startTime || 0) > 20 * 60_000;

        const startBuy1 = candle.close > ext.max
        const startBuy2 = ext.min > ext.overLow

        const startSell1 = candle.close < ext.min
        const startSell2 = ext.max < ext.overHigh

        if (start1 && start2 && start3 && start4 && startBuy1 && startBuy2) {
            this.enterTrade(tokenSymbol, '📈', candle).then(r => true);
        }

        if (start1 && start2 && start3 && start4 && startSell1 && startSell2) {
            this.enterTrade(tokenSymbol, '📉', candle).then(r => true);
        }

        const stopBuy1 = token.side === '📈'
        const stopBuy2 = ext.max * 0.99 > candle.close
        const stopBuy3 = 2 * ext.max - ext.min < candle.close


        const stopSell1 = token.side === '📉'
        const stopSell2 = ext.min * 1.01 < candle.close
        const stopSell3 = ext.max - 2 * ext.min > candle.close

        const stop = Date.now() - token.startTime > 960_000;

        if (stopBuy1 && (stopBuy2 || stopBuy3 || stop)) {
            this.exitTrade(candle).then(r => true);
        }

        if (stopSell1 && (stopSell2 || stopSell3 || stop)) {
            this.exitTrade(candle).then(r => true);
        }
    }

    startWebSocketMonitoring() {
        const pairs = Object.keys(this.tokens).map(key => `${key}USDT`);
        this.log(`👁️ Starting WebSocket monitoring for ${pairs.length} pairs on 5-minute candles`);
        try {
            this.wsConnection = this.client.ws.candles(pairs, '5m', candle => {
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
            await this.startHourlyUpdates();
            this.startWebSocketMonitoring();
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