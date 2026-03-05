require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const axios = require('axios');

const app = express();

const config = {
  channelSecret: process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
};

const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: config.channelAccessToken,
});

// Webhook endpoint
app.post('/webhook', line.middleware(config), async (req, res) => {
  try {
    const events = req.body.events;
    await Promise.all(events.map(handleEvent));
    res.status(200).json({ status: 'ok' });
  } catch (err) {
    console.error(err);
    res.status(500).end();
  }
});

async function handleEvent(event) {
  if (event.type !== 'message' && event.type !== 'postback') return;

  const userId = event.source.userId;
  const now = new Date();

  // ดึงข้อมูล Profile
  const profile = await client.getProfile(userId);
  const userName = profile.displayName;

  // จัดรูปแบบวันที่/เวลา (ไทย)
  const dateStr = now.toLocaleDateString('th-TH', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  });
  const timeStr = now.toLocaleTimeString('th-TH', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });

  let action = null;

  // รับ postback จาก Rich Menu
  if (event.type === 'postback') {
    action = event.postback.data; // "checkin" หรือ "checkout"
  }

  // รับข้อความ (สำหรับทดสอบ)
  if (event.type === 'message' && event.message.type === 'text') {
    const text = event.message.text.toLowerCase();
    if (text.includes('เข้างาน') || text === 'checkin') action = 'checkin';
    if (text.includes('ออกงาน') || text === 'checkout') action = 'checkout';
  }

  if (!action) {
    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: 'กรุณากด "เข้างาน" หรือ "ออกงาน" จาก Rich Menu ด้านล่างนะครับ 😊' }],
    });
  }

  // บันทึกไปยัง Google Sheets
  try {
    await axios.post(process.env.GOOGLE_SCRIPT_URL, {
      userId, userName, action, date: dateStr, time: timeStr,
    });
  } catch (e) {
    console.error('Google Sheets error:', e.message);
  }

  // ข้อความตอบกลับ
  const emoji = action === 'checkin' ? '🟢' : '🔴';
  const actionText = action === 'checkin' ? 'เข้างาน' : 'ออกงาน';

  const replyMessage = {
    type: 'flex',
    altText: `บันทึก${actionText}สำเร็จ`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: action === 'checkin' ? '#00B900' : '#FF334B',
        contents: [{
          type: 'text', text: `${emoji} ${actionText}`, color: '#ffffff',
          weight: 'bold', size: 'xl', align: 'center',
        }],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'md',
        contents: [
          { type: 'text', text: `สวัสดี ${userName}`, weight: 'bold', size: 'lg' },
          { type: 'separator' },
          {
            type: 'box', layout: 'horizontal',
            contents: [
              { type: 'text', text: '📅 วันที่', size: 'sm', color: '#888888', flex: 2 },
              { type: 'text', text: dateStr, size: 'sm', flex: 4, wrap: true },
            ],
          },
          {
            type: 'box', layout: 'horizontal',
            contents: [
              { type: 'text', text: '🕐 เวลา', size: 'sm', color: '#888888', flex: 2 },
              { type: 'text', text: timeStr, size: 'sm', flex: 4, weight: 'bold' },
            ],
          },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical',
        contents: [{
          type: 'text', text: 'บันทึกข้อมูลสำเร็จแล้ว ✅',
          color: '#888888', size: 'xs', align: 'center',
        }],
      },
    },
  };

  return client.replyMessage({ replyToken: event.replyToken, messages: [replyMessage] });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot running on port ${PORT}`));