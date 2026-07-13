require("dotenv").config();

const { App } = require("@slack/bolt");
const cron = require("node-cron");

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
    await app.start(process.env.PORT || 3000);
    console.log("⚡ Attendance Bot is running!");
  } catch (error) {
    console.error(error);
  }
})();