require("dotenv").config();
const Binance = require('binance-api-node');
const dayjs = require("dayjs");
const telegram = require('./telegram');
const {writeFile} = require("node:fs/promises");

// Constants
const TOKENS_FILE = './tokens1.json';
const STAT_FILE = './stat1.json';
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const EXTREMUM_BREAK_TIME = 15 * MINUTE_MS; // 15 minutes
const REVERSAL_CONFIRMATION_TIME = 5 * MINUTE_MS; // 5 minutes for reversal confirmation

class ExtremumTradingBot {
    constructor() {
        this.tokens = require(TOKENS_FILE);
        this.count = require(STAT_FILE).count;
        this.client = Binance.default({
            apiKey: process.env.BINANCE_PUBLIC_KEY,
            apiSecret: process.env.BINANCE_PRIVATE_KEY,
        });
        this.tgToken = process.env.TELEGRAM_TOKEN3;
        this.wsConnection = null;
        this.exitTimeoutMs = 1_200_000;

        // Initialize token data structure
        this.initializeTokenData();
    }

    log(message) {
        const timeLog = dayjs().format('HH:mm:ss');
        console.log(`${timeLog} ${message}`);
    }

    initializeTokenData() {
        Object.keys(this.tokens).forEach(token => {
            if (!this.tokens[token].extremums) {
                this.tokens[token].extremums = {
                    hourlyCandles: [], // Store last 60 1-minute candles
                    localMax: null,
                    localMin: null,
                    maxBreakTime: null,
                    minBreakTime: null,
                    lastExtremumUpdate: Date.now(),
                    pendingTrade: null // {type: 'long'/'short', confirmationTime: timestamp}
                };
            }
        });
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

    updateHourlyCandles(tokenSymbol, candle) {
        const token = this.tokens[tokenSymbol];
        if (!token || !token.extremums) return;

        const candleData = {
            time: candle.eventTime,
            high: parseFloat(candle.high),
            low: parseFloat(candle.low),
            volume: parseFloat(candle.volume),
        };

        // Add new candle
        token.extremums.hourlyCandles.push(candleData);

        // Keep only last 60 minutes of data
        const hourAgo = Date.now() - HOUR_MS;
        token.extremums.hourlyCandles = token.extremums.hourlyCandles
            .filter(c => c.time > hourAgo);

        // Update extremums every 5 minutes or when we have significant data
        if (Date.now() - token.extremums.lastExtremumUpdate > 5 * MINUTE_MS ||
            token.extremums.hourlyCandles.length >= 5) {
            this.updateLocalExtremums(tokenSymbol);
        }
    }

    calculateHourlyTotalVolume(tokenSymbol) {
        const token = this.tokens[tokenSymbol];
        if (!token || !token.extremums) return 0;

        return token.extremums.hourlyCandles.reduce((sum, candle) => {
            return sum + candle.volume;
        }, 0);
    }

    updateLocalExtremums(tokenSymbol) {
        const token = this.tokens[tokenSymbol];
        const candles = token.extremums.hourlyCandles;

        if (candles.length < 10) return; // Need at least 10 candles for reliable extremums

        let maxPrice = -Infinity;
        let minPrice = Infinity;
        let maxTime = 0;
        let minTime = 0;

        // Find local extremums in the last hour
        candles.forEach(candle => {
            if (candle.high > maxPrice) {
                maxPrice = candle.high;
                maxTime = candle.time;
            }
            if (candle.low < minPrice) {
                minPrice = candle.low;
                minTime = candle.time;
            }
        });

        const oldMax = token.extremums.localMax?.price || 0;
        const oldMin = token.extremums.localMin?.price || 1_000_000.0;

        if (Math.abs(maxPrice - oldMax) / oldMax > 0.002) {
            token.extremums.localMax = { price: maxPrice, time: maxTime };
            this.log(`📈 ${tokenSymbol}:\tMax old:${oldMax.toFixed(4)} new:${maxPrice.toFixed(4)}`);
        }

        if (Math.abs(minPrice - oldMin) / oldMin > 0.002) {
            token.extremums.localMin = { price: minPrice, time: minTime };
            this.log(`📉 ${tokenSymbol}:\tMin old:${oldMin.toFixed(4)} new:${minPrice.toFixed(4)}`);
        }

        token.extremums.lastExtremumUpdate = Date.now();
    }

    checkExtremumBreak(tokenSymbol, candle) {
        const token = this.tokens[tokenSymbol];
        const ext = token.extremums;
        const currentPrice = parseFloat(candle.close);
        const currentTime = candle.eventTime;

        if (!ext.localMax || !ext.localMin) return;

        // Check for max break (upward breakout)
        if (currentPrice > ext.localMax.price && !ext.maxBreakTime) {
            ext.maxBreakTime = currentTime;
            this.log(`🔥 ${tokenSymbol}:\tMax broken! ${currentPrice.toFixed(4)} > ${ext.localMax.price.toFixed(4)}`);
        }

        // Check for min break (downward breakout)
        if (currentPrice < ext.localMin.price && !ext.minBreakTime) {
            ext.minBreakTime = currentTime;
            this.log(`🔥 ${tokenSymbol}:\tMin broken! ${currentPrice.toFixed(4)} < ${ext.localMin.price.toFixed(4)}`);
        }

        // Reset break times if price returns within range
        if (currentPrice <= ext.localMax.price && ext.maxBreakTime) {
            if (currentTime - ext.maxBreakTime > REVERSAL_CONFIRMATION_TIME) {
                this.log(`↩️ ${tokenSymbol}: Max break invalidated`);
                ext.maxBreakTime = null;
            }
        }

        if (currentPrice >= ext.localMin.price && ext.minBreakTime) {
            if (currentTime - ext.minBreakTime > REVERSAL_CONFIRMATION_TIME) {
                this.log(`↩️ ${tokenSymbol}: Min break invalidated`);
                ext.minBreakTime = null;
            }
        }

        // Check for trading opportunity
        this.checkTradingOpportunity(tokenSymbol, currentPrice, currentTime, parseFloat(candle.volume));
    }

    checkTradingOpportunity(tokenSymbol, currentPrice, currentTime, currentVolume) {
        const token = this.tokens[tokenSymbol];
        const ext = token.extremums;

        // Skip if already in trade
        if (token.side) return;

        // Check volume condition - current candle volume must be greater than hourly total
        const hourlyTotalVolume = this.calculateHourlyTotalVolume(tokenSymbol);
        if (currentVolume <= hourlyTotalVolume) {
            this.log(`${ticker}: Volume condition not met (${currentVolume.toFixed(2)} <= ${hourlyTotalVolume.toFixed(2)})`);
            return; // Skip if volume condition not met
        }

        const maxBreakAge = ext.maxBreakTime ? (currentTime - ext.maxBreakTime) : null;
        const minBreakAge = ext.minBreakTime ? (currentTime - ext.minBreakTime) : null;

        // Long opportunity: Max broken within 15 min, then min broken (reversal confirmed)
        if (maxBreakAge && maxBreakAge <= EXTREMUM_BREAK_TIME &&
            minBreakAge && minBreakAge <= EXTREMUM_BREAK_TIME &&
            minBreakAge < maxBreakAge) { // Min break happened after max break

            if (currentPrice > ext.localMin.price) { // Price moving up from min
                this.enterTrade(tokenSymbol, 'long', currentPrice, currentTime, currentVolume, hourlyTotalVolume);
            }
        }

        // Short opportunity: Min broken within 15 min, then max broken (reversal confirmed)
        if (minBreakAge && minBreakAge <= EXTREMUM_BREAK_TIME &&
            maxBreakAge && maxBreakAge <= EXTREMUM_BREAK_TIME &&
            maxBreakAge < minBreakAge) { // Max break happened after min break

            if (currentPrice < ext.localMax.price) { // Price moving down from max
                this.enterTrade(tokenSymbol, 'short', currentPrice, currentTime, currentVolume, hourlyTotalVolume);
            }
        }
    }

    async enterTrade(tokenSymbol, side, price, time, currentVolume, hourlyVolume) {
        const token = this.tokens[tokenSymbol];

        token.side = side === 'long' ? '📈' : '📉';
        token.price = price;
        token.startTime = time;

        const direction = side === 'long' ? '🟢 ' : '🔴 ';
        const volumeRatio = (currentVolume / hourlyVolume).toFixed(2);
        const message = `${tokenSymbol} ${direction}: ${price.toFixed(4)} | Vol: ${volumeRatio}x | Max: ${token.extremums.localMax.price.toFixed(4)} | Min: ${token.extremums.localMin.price.toFixed(4)}`;

        this.log(`🎯 ${message}`);
        await this.sendTelegramAlert(message, false);
        await this.writeTokensFile();

        // Reset break times after trade entry
        token.extremums.maxBreakTime = null;
        token.extremums.minBreakTime = null;

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

            const isLong = trade.side === '📈';
            const pnlPercent = isLong
                ? (exitPrice - trade.price) / trade.price * 100
                : (trade.price - exitPrice) / trade.price * 100;

            const timePassed = Date.now() - trade.startTime;

            if (pnlPercent > 0.3 || pnlPercent < -2 || timePassed > 1_800_000) { // 0.3% profit, -2% stop loss, or 30 min timeout
                this.count = this.count + pnlPercent - 0.1;
                const direction = isLong ? '🟢' : '🔴';
                const ico = pnlPercent > 0 ? "🚀" : "🔻";
                const message = `${ticker} ${direction}${ico}: ${trade.price.toFixed(4)} → ${exitPrice.toFixed(4)} = ${pnlPercent.toFixed(2)}% | Total: ${this.count.toFixed(2)}%`;

                this.log(message);
                await this.sendTelegramAlert(message, true);

                delete trade.side;
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

    async processCandle(candle) {
        const tokenSymbol = candle.symbol.slice(0, -4); // Remove 'USDT'
        const token = this.tokens[tokenSymbol];

        if (!token) {
            console.warn(`⚠️ Unknown token: ${tokenSymbol}`);
            return;
        }

        // Update hourly candles data
        this.updateHourlyCandles(tokenSymbol, candle);

        // Check for extremum breaks and trading opportunities
        this.checkExtremumBreak(tokenSymbol, candle);
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

            this.startWebSocketMonitoring();
            this.log("🚀 Bot is now running with extremum tracking!");
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

const bot = new ExtremumTradingBot();
global.bot = bot;
bot.start().catch(error => {
    console.error("💥 Unhandled error:", error);
    process.exit(1);
});