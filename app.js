require("dotenv").config();
console.log("CLIENT EMAIL:", process.env.GOOGLE_CLIENT_EMAIL);
console.log("SHEET ID:", process.env.GOOGLE_SHEET_ID);
console.log("PRIVATE KEY EXISTS:", !!process.env.GOOGLE_PRIVATE_KEY);

const { App } = require("@slack/bolt");
const cron = require("node-cron");

const { google } = require("googleapis");
const path = require("path");

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({
  version: "v4",
  auth,
});

async function saveTimeIn(name, time) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: "Sheet1!A:E",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        new Date().toLocaleDateString("en-PH", {
          timeZone: "Asia/Manila"
        }),
        name,
        time,
        "",
        ""
      ]]
    }
  });
}

// Create Slack app
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

// Send attendance message
async function sendAttendanceMessage() {
  await app.client.chat.postMessage({
    channel: "#attendance",
    text: "Attendance",
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*☀️ Good Morning!*\n\nPlease record your attendance."
        }
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "🟢 Time In"
            },
            style: "primary",
            action_id: "time_in"
          }
        ]
      }
    ]
  });
}
// =========================
// TIME IN BUTTON
// =========================
app.action("time_in", async ({ ack, body, client }) => {
  // KAILANGANG unang-una ito
  await ack();

  const user = body.user;
  const now = new Date();

  const time = now.toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
    timeStyle: "medium",
  });

  // Reply only to the user who clicked
await client.chat.postEphemeral({
  channel: body.channel.id,
  user: user.id,
  text: `✅ *Time In Recorded*\n\n👤 ${user.name}\n🕒 ${time}`,
});

// Public announcement sa channel
try {
  await client.chat.postMessage({
    channel: body.channel.id,
    text: `🟢 <@${user.id}> timed in at *${time}*`,
  });

  console.log("✅ Public announcement sent");
} catch (err) {
  console.error("❌ postMessage failed:", err.data || err);
}

// Save to Google Sheets
try {
  await saveTimeIn(user.name, time);
  console.log("✅ Saved to Google Sheets");
} catch (err) {
  console.error(err);
}

console.log(`${user.name} timed in at ${time}`);
});

// =========================
// DAILY SCHEDULE
// Weekdays - 8:00 AM Manila
// =========================
cron.schedule(
  "0 8 * * 1-5",
  async () => {
    console.log("📅 Sending scheduled attendance...");

    try {
      await sendAttendanceMessage();
    } catch (err) {
      console.error(err);
    }
  },
  {
    timezone: "Asia/Manila",
  }
);

// =========================
// START SERVER
// =========================
(async () => {
  try {
    const result = await sheets.spreadsheets.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
    });

    console.log("✅ Connected to:", result.data.properties.title);
  } catch (err) {
    console.error(err);
  }
})();

// =========================
// START SERVER
// =========================
(async () => {
  try {
    await app.start(process.env.PORT || 3000);
    console.log("⚡ Attendance Bot is running!");
  } catch (error) {
    console.error(error);
  }
})();
