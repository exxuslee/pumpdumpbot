require("dotenv").config();
const Binance = require('binance-api-node');
const dayjs = require("dayjs");
const telegram = require('./telegram');
const {writeFile} = require("node:fs/promises");

// Constants
const TOKENS_FILE = './tokens1.json';
const STAT_FILE = './stat1.json';
const INTERVAL_6H = 21_600_000; // 6 hours
const API_DELAY = 200; // ms between API calls
const VOLUME_HISTORY_DAYS = 7;

class PumpDumpBot {
    constructor() {
        this.tokens = require(TOKENS_FILE);
        this.count = require(STAT_FILE).count;
        this.client = Binance.default({
            apiKey: process.env.BINANCE_PUBLIC_KEY,
            apiSecret: process.env.BINANCE_PRIVATE_KEY,
        });
        this.tgToken = process.env.TELEGRAM_TOKEN;
        this.wsConnection = null;
        this.exitTimeoutMs = 1_800_000
    }

    log(message) {
        const timeLog = dayjs().format('HH:mm:ss');
        console.log(`${timeLog} ${message}`);
    }

    async writeTokensFile() {
        try {
            await writeFile(TOKENS_FILE, JSON.stringify(this.tokens, null, 2));
            this.log("✅ Tokens file updated successfully");
        } catch (error) {
            console.error("❌ Error writing tokens file:", error);
        }
    }

    async writeStatFile() {
        try {
            await writeFile(STAT_FILE, JSON.stringify({count: this.count}, null, 2));
            this.log("✅ Stats file updated successfully");
        } catch (error) {
            console.error("❌ Error writing stats file:", error);
        }
    }

    async calculateAverageVolume() {
        this.log("📊 Calculating average volumes...");

        const tokenSymbols = Object.keys(this.tokens);
        let processed = 0;

        for (const token of tokenSymbols) {
            try {
                const symbol = `${token}USDT`;
                const candles = await this.client.candles({
                    symbol,
                    interval: "1d",
                    limit: VOLUME_HISTORY_DAYS
                });

                // Calculate average hourly quote volume
                const totalVolume = candles.reduce((sum, candle) => {
                    return sum + parseFloat(candle.quoteVolume);
                }, 0);

                this.tokens[token].avgQuoteVolume4h = Math.round(totalVolume / candles.length / 6);

                processed++;
                this.log(`📈 ${symbol}: ${(+this.tokens[token].avgQuoteVolume4h).toFixed(2)} USDT/4hour (${processed}/${tokenSymbols.length})`);

                // Rate limiting
                await this.delay(API_DELAY);

            } catch (error) {
                console.error(`❌ Error calculating volume for ${token}:`, error.message);
            }
        }

        await this.writeTokensFile();
        this.log("✅ Average volume calculation completed");
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    setupScheduledTasks() {
        const now = dayjs();
        const secondsToNextMinute = 60 - now.second();
        const msToNextMinute = secondsToNextMinute * 1000;
        this.log(`⏱️ Scheduling tasks to start in ${secondsToNextMinute} seconds`);
        setTimeout(() => {
            setInterval(() => this.calculateAverageVolume(), INTERVAL_6H);
        }, msToNextMinute);
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
            const pair = `${ticker}USDT`
            const prices = await this.client.prices({symbol: pair});
            return parseFloat(prices[pair]);
        } catch (error) {
            console.error("❌ Error getting current price:", error.message);
            return null;
        }
    }

    async exitTrade(ticker) {
        const trade = this.tokens[ticker]
        try {
            const exitPrice = await this.getCurrentPrice(ticker);
            if (!exitPrice) {
                this.log(`⚠️ Cannot get current price for ${ticker}`);
                return;
            }
            const pnlPercent = trade.side === '📈'
                ? (exitPrice - trade.entryPrice) / exitPrice * 100
                : (trade.entryPrice - exitPrice) / trade.entryPrice * 100;

            if (pnlPercent > 0 || ((Date.now() - trade.startTime) > (this.exitTimeoutMs + 60_000))) {
                this.count = this.count + pnlPercent;
                let ico
                if (pnlPercent > 0) ico = "🚀"
                else ico = "🔻"
                const massage = `${ticker} ${ico}: ${(+trade.entryPrice).toFixed(3)} ${exitPrice.toFixed(3)} = ${pnlPercent.toFixed(2)}% | ${this.count.toFixed(2)}%`
                this.log(massage);
                await this.sendTelegramAlert(massage, true);
                delete trade.side;
                delete trade.entryPrice;
                delete trade.startTime;
                await this.writeTokensFile();
                await this.writeStatFile();
            } else {
                setTimeout(() => this.exitTrade(ticker), this.exitTimeoutMs);
            }
        } catch (error) {
            console.error(`❌ Error exiting trade for ${ticker}:`, error.message);
            await this.sendTelegramAlert(`❌ Failed to exit trade for ${ticker}: ${error.message}`, true);
        }
    }

    async detectPumpDump(candle) {
        const tokenSymbol = candle.symbol.slice(0, -4); // Remove 'USDT'
        const token = this.tokens[tokenSymbol];

        if (!token || !token.avgQuoteVolume4h) {
            console.warn(`⚠️ Unknown token: ${tokenSymbol}`);
            return;
        }

        const buyVolume = parseFloat(candle.buyVolume);
        const sellVolume = parseFloat(candle.volume) - buyVolume;
        const volumeRatio = buyVolume / sellVolume;

        let start1 = parseFloat(candle.quoteVolume) > token.avgQuoteVolume4h
        let start2 = candle.eventTime > ((token.startTime ?? 0) + INTERVAL_6H)
        let start3 = (candle.high - candle.low) / candle.high > 0.015
        let start4 = (volumeRatio > 1.3) || (volumeRatio < 0.75);

        if (start1 && start2 && start3 && start4) {
            token.entryPrice = candle.close;
            token.startTime = candle.eventTime
            const direction = buyVolume > sellVolume ? '📈' : '📉';
            token.side = direction;

            const message = `${direction} ${tokenSymbol}: ${(+candle.close).toFixed(3)} (${volumeRatio.toFixed(2)}x ratio) `;
            this.sendTelegramAlert(message, false);
            await this.writeTokensFile();
            setTimeout(() => this.exitTrade(tokenSymbol), this.exitTimeoutMs);
        }
    }

    startWebSocketMonitoring() {
        const pairs = Object.keys(this.tokens).map(key => `${key}USDT`);

        this.log(`👁️ Starting WebSocket monitoring for ${pairs.length} pairs`);

        try {
            this.wsConnection = this.client.ws.candles(pairs, '5m', candle => {
                this.detectPumpDump(candle);
            });
            this.log("✅ WebSocket connection established");
        } catch (error) {
            console.error("❌ WebSocket connection failed:", error);
            setTimeout(() => this.startWebSocketMonitoring(), 5000);
        }
    }

    async start() {
        this.log("💵 == PUMP/DUMP BOT STARTING == 💵");

        try {
            if (!process.env.BINANCE_PUBLIC_KEY || !process.env.BINANCE_PRIVATE_KEY) {
                throw new Error("Missing Binance API credentials");
            }
            if (!process.env.TELEGRAM_TOKEN) {
                throw new Error("Missing Telegram token");
            }
            await this.calculateAverageVolume();
            this.setupScheduledTasks();
            this.startWebSocketMonitoring();
            this.log("🚀 Bot is now running!");
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

const bot = new PumpDumpBot();
global.bot = bot; // Store reference for graceful shutdown
bot.start().catch(error => {
    console.error("💥 Unhandled error:", error);
    process.exit(1);
});