const { app, BrowserWindow, globalShortcut } = require("electron");
const path = require("path");
const screenshot = require("screenshot-desktop");
const fs = require("fs");
const { OpenAI } = require("openai");

let config;
const token = process.env["GITHUB_TOKEN"];

try {
  const configPath = path.join(__dirname, "config.json");
  const configData = fs.readFileSync(configPath, "utf8");
  config = JSON.parse(configData);

  if (!config.apiKey) {
    throw new Error("API key is missing in config.json");
  }
  if (!token) {
    throw new Error("GITHUB_TOKEN is missing in environment");
  }
  if (!config.model) {
    config.model = "gpt-4o-mini";
    console.log("Model not specified in config, using default:", config.model);
  }
} catch (err) {
  console.error("Error reading config:", err.message);
  app.quit();
}
const openai = new OpenAI({
  apiKey: token,
  baseURL: "https://models.inference.ai.azure.com",
});

let mainWindow;
let screenshots = [];
let multiPageMode = false;

const moveWindow = (direction) => {
  if (!mainWindow) return;
  const bounds = mainWindow.getBounds();
  let x = bounds.x;
  let y = bounds.y;

  const step = 20; // Pixels to move

  switch (direction) {
    case "up":
      y -= step;
      break;
    case "down":
      y += step;
      break;
    case "left":
      x -= step;
      break;
    case "right":
      x += step;
      break;
  }

  mainWindow.setBounds({ x, y, width: bounds.width, height: bounds.height });
};

function updateInstruction(instruction) {
  if (mainWindow?.webContents) {
    mainWindow.webContents.send("update-instruction", instruction);
  }
}

function hideInstruction() {
  if (mainWindow?.webContents) {
    mainWindow.webContents.send("hide-instruction");
  }
}

async function captureScreenshot() {
  try {
    hideInstruction();
    mainWindow.hide();
    await new Promise((res) => setTimeout(res, 200));

    const timestamp = Date.now();
    const imagePath = path.join(
      app.getPath("pictures"),
      `screenshot_${timestamp}.png`
    );
    await screenshot({ filename: imagePath });

    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString("base64");

    mainWindow.show();
    return base64Image;
  } catch (err) {
    mainWindow.show();
    if (mainWindow.webContents) {
      mainWindow.webContents.send("error", err.message);
    }
    throw err;
  }
}

async function processScreenshots() {
  try {
    // Build message with text + each screenshot
    const messages = [
      {
        type: "text",
        text: "Can you solve the question for me and give the final answer/code?",
      },
    ];
    for (const img of screenshots) {
      messages.push({
        type: "image_url",
        image_url: { url: `data:image/png;base64,${img}` },
      });
    }

    // Make the request
    const response = await openai.chat.completions.create({
      model: config.model,
      messages: [{ role: "user", content: messages }],
      max_tokens: 5000,
    });

    // Send the text to the renderer
    mainWindow.webContents.send(
      "analysis-result",
      response.choices[0].message.content
    );
  } catch (err) {
    console.error("Error in processScreenshots:", err);
    if (mainWindow.webContents) {
      mainWindow.webContents.send("error", err.message);
    }
  }
}

// Reset everything
function resetProcess() {
  screenshots = [];
  multiPageMode = false;
  mainWindow.webContents.send("clear-result");
  updateInstruction("Ctrl+Shift+S: Screenshot | Ctrl+Shift+A: Multi-mode");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    paintWhenInitiallyHidden: true,
    contentProtection: true,
    type: "toolbar",
  });

  mainWindow.loadFile("index.html");
  mainWindow.setContentProtection(true);
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setAlwaysOnTop(true, "screen-saver", 1);

  // Ctrl+Shift+S => single or final screenshot
  globalShortcut.register("CommandOrControl+Shift+S", async () => {
    try {
      const img = await captureScreenshot();
      screenshots.push(img);
      await processScreenshots();
    } catch (error) {
      console.error("Ctrl+Shift+S error:", error);
    }
  });

  // Ctrl+Shift+A => multi-page mode
  globalShortcut.register("CommandOrControl+Shift+A", async () => {
    try {
      if (!multiPageMode) {
        multiPageMode = true;
        updateInstruction(
          "Multi-mode: Ctrl+Shift+A to add, Ctrl+Shift+S to finalize"
        );
      }
      const img = await captureScreenshot();
      screenshots.push(img);
      updateInstruction(
        "Multi-mode: Ctrl+Shift+A to add, Ctrl+Shift+S to finalize"
      );
    } catch (error) {
      console.error("Ctrl+Shift+A error:", error);
    }
  });

  // Ctrl+Shift+R => reset
  globalShortcut.register("CommandOrControl+Shift+R", () => {
    resetProcess();
  });

  globalShortcut.register("CommandOrControl+B", () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
    }
  });

  globalShortcut.register("CommandOrControl+Up", () => moveWindow("up"));
  globalShortcut.register("CommandOrControl+Down", () => moveWindow("down"));
  globalShortcut.register("CommandOrControl+Left", () => moveWindow("left"));
  globalShortcut.register("CommandOrControl+Right", () => moveWindow("right"));
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  globalShortcut.unregisterAll();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
