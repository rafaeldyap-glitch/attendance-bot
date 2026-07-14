require("dotenv").config();

const { App } = require("@slack/bolt");
const cron = require("node-cron");
const { google } = require("googleapis");

const TIME_ZONE = "Asia/Manila";
const SHEET_NAME = "Sheet1";
const ATTENDANCE_CHANNEL = process.env.SLACK_ATTENDANCE_CHANNEL || "#attendance";

if (!process.env.GOOGLE_PRIVATE_KEY) {
  throw new Error("GOOGLE_PRIVATE_KEY is required.");
}

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });
const employeeLocks = new Map();

function attendanceDate(now = new Date()) {
  return now.toLocaleDateString("en-PH", { timeZone: TIME_ZONE });
}

function attendanceTime(now = new Date()) {
  return now.toLocaleTimeString("en-PH", {
    timeZone: TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function employeeName(user) {
  return user.real_name || user.name;
}

// Serializes rapid repeat clicks by the same employee in this bot instance.
// Google Sheets remains the source of truth for every attendance decision.
async function withEmployeeLock(name, operation) {
  const previous = employeeLocks.get(name) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  const queueTail = previous.then(() => current);
  employeeLocks.set(name, queueTail);

  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (employeeLocks.get(name) === queueTail) {
      employeeLocks.delete(name);
    }
  }
}

async function getOpenAttendanceRow(userId) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `${SHEET_NAME}!A:F`,
  });

  const rows = response.data.values || [];

  // Row 1 is the header. Search backwards so the latest open record is used.
  for (let index = rows.length - 1; index >= 1; index -= 1) {
    const row = rows[index];
    if (row[1] === userId && !row[4]) {
      return index + 1; // Sheets row numbers are one-based.
    }
  }

  return null;
}

async function saveTimeIn(userId, name, date, time) {
  if (await getOpenAttendanceRow(userId)) {
    return false;
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `${SHEET_NAME}!A:F`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[date, userId, name, time, "", ""]],
    },
  });

  return true;
}

async function saveTimeOut(userId, time) {
  const rowNumber = await getOpenAttendanceRow(userId);

  if (!rowNumber) {
    return false;
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `${SHEET_NAME}!E${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[time]],
    },
  });

  return true;
}

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

async function postPrivate(client, channel, user, text) {
  await client.chat.postEphemeral({ channel, user, text });
}

async function postAttendanceConfirmation(client, channel, userId, type, name, time) {
  const isTimeIn = type === "Time In";
  await client.chat.postEphemeral({
    channel,
    user: userId,
    text: `${type} Recorded: ${name} at ${time}`,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `${isTimeIn ? "🟢" : "🔴"} ${type} Recorded`,
          emoji: true,
        },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Employee*\n${name}` },
          { type: "mrkdwn", text: `*Time*\n${time}` },
        ],
      },
    ],
  });
}

async function sendAttendanceMessage() {
  await app.client.chat.postMessage({
    channel: ATTENDANCE_CHANNEL,
    text: "Attendance: use Time In or Time Out.",
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*☀️ Good Morning!*\n\nPlease record your attendance.",
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "🟢 Time In" },
            style: "primary",
            action_id: "time_in",
          },
          {
            type: "button",
            text: { type: "plain_text", text: "🔴 Time Out" },
            style: "danger",
            action_id: "time_out",
          },
        ],
      },
    ],
  });
}

app.action("time_in", async ({ ack, body, client, logger }) => {
  await ack();

  const channel = body.channel?.id;
  const user = body.user;
  const name = employeeName(user);
  const userId = user.id;
  const now = new Date();
  const date = attendanceDate(now);
  const time = attendanceTime(now);

  if (!channel) {
    logger.error("Time In action did not include a channel.");
    return;
  }

  try {
    const saved = await withEmployeeLock(userId, () => saveTimeIn(userId, name, date, time));

    if (!saved) {
      await postPrivate(client, channel, user.id, "❌ You're already timed in.\nPlease Time Out first.");
      return;
    }

    await client.chat.postMessage({
      channel,
      text: `🟢 <@${user.id}> timed in at *${time}*`,
    });
    await postAttendanceConfirmation(client, channel, userId, "Time In", name, time);
  } catch (error) {
    logger.error(error);
    await postPrivate(client, channel, user.id, "❌ Unable to record your Time In. Please try again.");
  }
});

app.action("time_out", async ({ ack, body, client, logger }) => {
  await ack();

  const channel = body.channel?.id;
  const user = body.user;
  const name = employeeName(user);
  const userId = user.id;
  const now = new Date();
  const time = attendanceTime(now);

  if (!channel) {
    logger.error("Time Out action did not include a channel.");
    return;
  }

  try {
    const saved = await withEmployeeLock(userId, () => saveTimeOut(userId, time));

    if (!saved) {
      await postPrivate(client, channel, user.id, "❌ You haven't timed in yet.");
      return;
    }

    await client.chat.postMessage({
      channel,
      text: `🔴 <@${user.id}> timed out at *${time}*`,
    });
    await postAttendanceConfirmation(client, channel, userId, "Time Out", name, time);
  } catch (error) {
    logger.error(error);
    await postPrivate(client, channel, user.id, "❌ Unable to record your Time Out. Please try again.");
  }
});

// This remains unchanged; Render Free may sleep before this schedule fires.
cron.schedule(
  "0 8 * * 1-5",
  async () => {
    try {
      await sendAttendanceMessage();
    } catch (error) {
      console.error("Unable to send scheduled attendance message:", error);
    }
  },
  { timezone: TIME_ZONE },
);

(async () => {
  try {
    const result = await sheets.spreadsheets.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
    });
    console.log(`Connected to: ${result.data.properties.title}`);

    await app.start(process.env.PORT || 3000);
    console.log("Attendance Bot is running.");

    // Temporary deployment test: send one launcher whenever the app starts.
    try {
      await sendAttendanceMessage();
      console.log("Startup attendance message sent.");
    } catch (error) {
      console.error("Unable to send startup attendance message:", error);
    }
  } catch (error) {
    console.error("Unable to start Attendance Bot:", error);
    process.exitCode = 1;
  }
})();
