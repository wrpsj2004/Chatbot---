require("dotenv").config();
const express = require("express");
const line = require("@line/bot-sdk");
const axios = require("axios");

const app = express();

const config = {
  channelSecret: process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
};

const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: config.channelAccessToken,
});

app.post("/webhook", line.middleware(config), async (req, res) => {
  try {
    const events = req.body.events;
    await Promise.all(events.map(handleEvent));
    res.status(200).json({ status: "ok" });
  } catch (err) {
    console.error(err);
    res.status(500).end();
  }
});

app.get('/ping', (req, res) => {
  res.status(200).send('pong');
});

async function handleEvent(event) {
  if (event.type !== "message" && event.type !== "postback") return;

  const userId = event.source.userId;
  const now = new Date();
  const utc7 = new Date(now.getTime() + 7 * 60 * 60 * 1000);

  const profile = await client.getProfile(userId);
  const userName = profile.displayName;

  const dateStr = utc7.toLocaleDateString("th-TH", { year: "numeric", month: "long", day: "numeric" });
  const timeStr = utc7.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });

  let action = null;

  // 1. รับค่าจาก Postback (แนะนำให้ใช้กับ Rich Menu)
  if (event.type === "postback") {
    action = event.postback.data; 
  }

  // 2. รับค่าจาก Message (พิมพ์มา)
  if (event.type === "message" && event.message.type === "text") {
    const text = event.message.text;
    if (text.includes("เข้างาน")) action = "checkin";
    else if (text.includes("ออกงาน")) action = "checkout";
    else if (text.includes("เช็ควันลา")) action = "check_quota";
    else if (text.includes("ลาป่วย")) action = "leave_sick";
    else if (text.includes("ลากิจ")) action = "leave_private";
  }

  if (!action) return;

  try {
    // ส่งข้อมูลไปที่ Google Sheets (GAS)
    const response = await axios.post(process.env.GOOGLE_SCRIPT_URL, {
      userId,
      userName,
      action, // 'checkin', 'checkout', 'check_quota', 'leave_sick', 'leave_private'
      date: dateStr,
      time: timeStr,
    });

    const dataFromSheet = response.data; // สมมติว่า GAS ส่งค่าคงเหลือกลับมาด้วย
    let replyMessage = {};

    // แยกการตอบกลับตาม Action
    if (action === "checkin" || action === "checkout") {
      replyMessage = createFlexCheckInOut(action, userName, dateStr, timeStr);
    } 
    else if (action === "check_quota") {
      replyMessage = {
        type: "text",
        text: `📊 วันลาคงเหลือของคุณ ${userName}\n🤒 ลาป่วย: ${dataFromSheet.sick || 0} วัน\n💼 ลากิจ: ${dataFromSheet.private || 0} วัน`
      };
    }
    else if (action === "leave_sick" || action === "leave_private") {
      const typeLabel = action === "leave_sick" ? "ลาป่วย" : "ลากิจ";
      replyMessage = {
        type: "text",
        text: `✅ บันทึก${typeLabel}เรียบร้อยแล้ว\n📅 วันที่: ${dateStr}\nคงเหลือ: ${dataFromSheet.remain || 0} วัน`
      };
    }

    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [replyMessage],
    });

  } catch (e) {
    console.error("Error:", e.message);
    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: "text", text: "เกิดข้อผิดพลาดในการเชื่อมต่อระบบครับ ❌" }],
    });
  }
}

// ฟังก์ชันสร้าง Flex Message สำหรับ เข้า-ออก งาน (แยกออกมาเพื่อให้ Code สะอาด)
function createFlexCheckInOut(action, userName, dateStr, timeStr) {
  const isCheckIn = action === "checkin";
  return {
    type: "flex",
    altText: `บันทึก${isCheckIn ? "เข้างาน" : "ออกงาน"}สำเร็จ`,
    contents: {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: isCheckIn ? "#00B900" : "#FF334B",
        contents: [{ type: "text", text: isCheckIn ? "🟢 เข้างาน" : "🔴 ออกงาน", color: "#ffffff", weight: "bold", size: "xl", align: "center" }],
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          { type: "text", text: `สวัสดี ${userName}`, weight: "bold", size: "lg" },
          { type: "separator" },
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "📅 วันที่", size: "sm", color: "#888888", flex: 2 },
              { type: "text", text: dateStr, size: "sm", flex: 4, wrap: true }
            ]
          },
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "🕐 เวลา", size: "sm", color: "#888888", flex: 2 },
              { type: "text", text: `${timeStr} น.`, size: "sm", flex: 4, weight: "bold" }
            ]
          }
        ]
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [{ type: "text", text: "บันทึกข้อมูลสำเร็จแล้ว ✅", color: "#888888", size: "xs", align: "center" }]
      }
    }
  };
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot running on port ${PORT}`));