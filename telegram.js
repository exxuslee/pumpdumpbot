const axios = require("axios");

async function sendMessage(message, token) {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    try {
        await axios.post(url, {
            chat_id: process.env.TELEGRAM_CHAT_ID,
            text: message,
        });
    } catch (error) {
        console.error("Ошибка при отправке сообщения:", error.response?.data || error.message);
    }
}

module.exports = {
    sendMessage: (message, token) => sendMessage(message, token)
};