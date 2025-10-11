const axios = require("axios");

async function sendMessage(message, token, isSilent) {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    try {
        const response = await axios.post(url, {
            chat_id: process.env.TELEGRAM_CHAT_ID,
            text: message,
            disable_notification: isSilent,
        });
        return response.data.result.message_id;
    } catch (error) {
        console.error("Ошибка при отправке сообщения:", error.response?.data || error.message);
        return null;
    }
}

async function editMessageAppend(messageId, appendText, token) {
    const urlGet = `https://api.telegram.org/bot${token}/getUpdates`;
    const urlEdit = `https://api.telegram.org/bot${token}/editMessageText`;

    try {
        const updates = await axios.get(urlGet);
        const message = updates.data.result
            .flatMap(u => u.message ? [u.message] : (u.edited_message ? [u.edited_message] : []))
            .find(m => m.message_id === messageId);

        if (!message) {
            console.warn("Сообщение не найдено в обновлениях (возможно, старое).");
            return null;
        }

        const newText = `${message.text}\n${appendText}`;

        const response = await axios.post(urlEdit, {
            chat_id: process.env.TELEGRAM_CHAT_ID,
            message_id: messageId,
            text: newText,
        });

        return response.data.result;
    } catch (error) {
        console.error("Ошибка при редактировании сообщения:", error.response?.data || error.message);
        return null;
    }
}

module.exports = {
    sendMessage: (message, token, isSilent) => sendMessage(message, token, isSilent),
    editMessageAppend: (messageId, appendText, token) => editMessageAppend(messageId, appendText, token),
};