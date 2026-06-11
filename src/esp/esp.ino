// ═══════════════════════════════════════════════════════════════
//  PID Dashboard — ESP32-S3 WebSocket Bridge
//  Board: ESP32-S3 (e.g. ESP32-S3-DevKitC-1)
//
//  Connections:
//    ESP32-S3 GPIO17 (TX1) ──► STM32 RX
//    ESP32-S3 GPIO18 (RX1) ◄── STM32 TX
//    ESP32-S3 GND          ─── STM32 GND  ← MUST share ground
//
//  Libraries (install via Arduino Library Manager):
//    - ESP Async WebServer  by lacamera       (v3.x)
//    - AsyncTCP             by dvarrel        (v1.x)
//    - ArduinoJson          by Benoit Blanchon (v7.x)
//
//  Board setup in Arduino IDE:
//    Tools → Board      → ESP32S3 Dev Module
//    Tools → USB Mode   → Hardware CDC and JTAG
//    Tools → Flash Size → 8MB (adjust to your board)
//    Tools → PSRAM      → OPI PSRAM (if your board has it)
//
//  Matches dashboard packet format in src/types/index.ts
// ═══════════════════════════════════════════════════════════════

#include <ArduinoJson.h>
#include <AsyncTCP.h>
#include <ESPAsyncWebServer.h>
#include <WiFi.h>

// ── WiFi credentials ─────────────────────────────────────────
const char *WIFI_SSID = "Ibrahim";
const char *WIFI_PASSWORD = "12345678A";

// ── UART to STM32 ────────────────────────────────────────────
// ESP32-S3 has 3 hardware UARTs (UART0=USB, UART1=free, UART2=free)
// We use UART1 here — pins are fully remappable on S3
#define STM32_SERIAL Serial1
#define STM32_BAUD 115200
#define STM32_RX_PIN 18 // GPIO18 ← STM32 TX
#define STM32_TX_PIN 17 // GPIO17 → STM32 RX

// ── WebSocket ────────────────────────────────────────────────
// Server on port 80, WebSocket endpoint at /ws
// Dashboard connects to: ws://<ESP32_IP>/ws
// (Your useWebSocket.ts builds: ws://${ip}:81
//  Change port below to 81 OR update useWebSocket.ts to omit the port
//  — we use 81 here to match your dashboard code exactly)
AsyncWebServer server(81);
AsyncWebSocket ws("/ws");

// ── UART receive buffer ──────────────────────────────────────
const size_t UART_BUF_MAX = 1024;
static char uartBuf[UART_BUF_MAX];
static size_t uartIndex = 0;

// ── Stats (optional, printed every 10s) ─────────────────────
static uint32_t statPktReceived = 0; // from STM32
static uint32_t statPktSent = 0;     // to dashboard
static uint32_t statCmdReceived = 0; // from dashboard
static uint32_t statLastPrint = 0;

// ── Watchdog: track last message from dashboard ──────────────
// If nothing arrives for WATCHDOG_MS, send a WARN to all clients
static uint32_t lastDashboardMsg = 0;
const uint32_t WATCHDOG_MS = 5000; // 5 seconds
static bool watchdogFired = false;

// ════════════════════════════════════════════════════════════
//  UART → WebSocket
//  Called whenever a complete '\n'-terminated line arrives
//  from the STM32. Validates JSON and broadcasts to all clients.
// ════════════════════════════════════════════════════════════
void forwardUartToWebSocket(const char *line) {
  if (!line || line[0] == '\0')
    return;

  // Quick sanity check — must start with '{'
  if (line[0] != '{') {
    Serial.printf("[STM32 DBG] %s\n", line);
    return;
  }

  // Fast string scan instead of expensive JSON parsing to minimize latency
  if (strstr(line, "\"TELEMETRY\"") == nullptr &&
      strstr(line, "\"ACK\"") == nullptr &&
      strstr(line, "\"ERROR\"") == nullptr) {
    Serial.printf("[UART] Filtered out: %s\n", line);
    return;
  }

  // Broadcast to all connected WebSocket clients
  size_t count = ws.count();
  if (count > 0) {
    ws.textAll(line);
    statPktSent++;
  }

  statPktReceived++;
}

// ════════════════════════════════════════════════════════════
//  WebSocket → UART
//  Forwards dashboard commands to STM32.
//  PING is handled here and never reaches STM32.
// ════════════════════════════════════════════════════════════
void handleDashboardMessage(AsyncWebSocketClient *client, const String &data) {
  lastDashboardMsg = millis();
  watchdogFired = false;
  statCmdReceived++;

  // ── Handle custom plain text format ──
  if (data.startsWith("PID TUNING") || data.startsWith("IMU LOCKING") ||
      data.startsWith("ROBOT MOVEMENT") || data.startsWith("PING")) {

    if (data.startsWith("PING")) {
      client->text("{\"type\":\"PONG\"}");
      return;
    }

    // Determine command name for ACK
    String cmdName = "UNKNOWN";
    if (data.startsWith("PID TUNING"))
      cmdName = "PID TUNING";
    else if (data.startsWith("IMU LOCKING"))
      cmdName = "IMU LOCKING";
    else if (data.startsWith("ROBOT MOVEMENT"))
      cmdName = "ROBOT MOVEMENT";

    // ── Forward to STM32 over UART ──
    STM32_SERIAL.println(data); // println appends '\n' delimiter
    Serial.printf("[→STM32] %s\n", data.c_str());

    // ── Send ACK back to dashboard ──
    client->text("{\"type\":\"ACK\",\"command\":\"" + cmdName + "\"}");
    return;
  }

  // If we reach here, it's an unknown command
  Serial.printf("[WS] Unknown command format: %s\n", data.c_str());
  client->text("{\"type\":\"ERROR\",\"message\":\"Unknown command format\"}");
}

// ════════════════════════════════════════════════════════════
//  WebSocket event handler
// ════════════════════════════════════════════════════════════
void onWebSocketEvent(AsyncWebSocket *server, AsyncWebSocketClient *client,
                      AwsEventType type, void *arg, uint8_t *data, size_t len) {
  switch (type) {

  // ── Client connected ──
  case WS_EVT_CONNECT: {
    Serial.printf("[WS] Client #%u connected  IP: %s\n", client->id(),
                  client->remoteIP().toString().c_str());

    // Send ACK so dashboard WS status turns green immediately
    client->text("{\"type\":\"ACK\",\"command\":\"CONNECTED\"}");
    lastDashboardMsg = millis();
    break;
  }

  // ── Client disconnected ──
  case WS_EVT_DISCONNECT: {
    Serial.printf("[WS] Client #%u disconnected\n", client->id());
    break;
  }

  // ── Data received ──
  case WS_EVT_DATA: {
    AwsFrameInfo *info = (AwsFrameInfo *)arg;

    // Only handle complete, single-frame text messages
    // (dashboard sends small JSON — never fragmented)
    if (info->final && info->index == 0 && info->len == len &&
        info->opcode == WS_TEXT) {

      String msg = String((char *)data, len);
      Serial.printf("[WS←] #%u: %s\n", client->id(), msg.c_str());
      handleDashboardMessage(client, msg);
    }
    break;
  }

  // ── Error ──
  case WS_EVT_ERROR: {
    Serial.printf("[WS] Error on client #%u: %u %s\n", client->id(),
                  *((uint16_t *)arg), (char *)data);
    break;
  }

  default:
    break;
  }
}

// ════════════════════════════════════════════════════════════
//  WiFi — connect with retry + auto-reconnect
// ════════════════════════════════════════════════════════════
void connectWiFi() {
  Serial.printf("\n[WiFi] Connecting to \"%s\"", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true); // ESP32-S3 built-in auto-reconnect
  WiFi.persistent(true);       // Saves credentials to flash
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  uint8_t attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 40) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println();
    Serial.printf("IP Address : %-22s\n", WiFi.localIP().toString().c_str());
    Serial.printf("WS URL     : ws://%-17s\n",
                  (WiFi.localIP().toString() + ":81/ws").c_str());
    Serial.printf("Signal     : %d dBm%-17s\n", WiFi.RSSI(), "");
    Serial.println();
    Serial.println("► Type this IP into the dashboard header and press Enter");
  } else {
    Serial.println("\n[WiFi] FAILED to connect — restarting in 5s");
    delay(5000);
    ESP.restart();
  }
}

// ════════════════════════════════════════════════════════════
//  FreeRTOS Tasks
// ════════════════════════════════════════════════════════════
void uartTask(void *pvParameters) {
  while (true) {
    // ── Read UART from STM32 ──
    while (STM32_SERIAL.available()) {
      char c = (char)STM32_SERIAL.read();

      if (c == '\n') {
        if (uartIndex > 0) {
          uartBuf[uartIndex] = '\0';
          // Trim trailing '\r' if present
          if (uartIndex > 0 && uartBuf[uartIndex - 1] == '\r') {
            uartBuf[uartIndex - 1] = '\0';
          }

          // Forward line
          forwardUartToWebSocket(uartBuf);
          uartIndex = 0;
        }
      } else {
        if (c != '\r') {
          if (uartIndex < UART_BUF_MAX - 1) {
            uartBuf[uartIndex++] = c;
          } else {
            // Buffer overflow, reset index
            Serial.println("[UART] Buffer overflow — discarding line");
            uartIndex = 0;
          }
        }
      }
    }
    // Yield to avoid starving watchdog if spinning fast
    vTaskDelay(pdMS_TO_TICKS(1)); 
  }
}

// ════════════════════════════════════════════════════════════
//  Setup
// ════════════════════════════════════════════════════════════
void setup() {
  // USB Serial for debugging (ESP32-S3 uses CDC over USB)
  Serial.begin(115200);
  delay(1000); // Give USB CDC time to initialise on S3
  Serial.println("\n\n=== ESP32-S3 PID Bridge Booting ===");

  // ── UART1 to STM32 ──
  // ESP32-S3: Serial1 is remappable — set pins explicitly
  // Increase buffer sizes to prevent overflow during high-frequency telemetry
  // streaming
  STM32_SERIAL.setRxBufferSize(2048);
  STM32_SERIAL.setTxBufferSize(1024);
  STM32_SERIAL.begin(STM32_BAUD, SERIAL_8N1, STM32_RX_PIN, STM32_TX_PIN);
  Serial.printf("[UART1] Initialised  RX=GPIO%d  TX=GPIO%d  Baud=%d\n",
                STM32_RX_PIN, STM32_TX_PIN, STM32_BAUD);

  // ── WiFi ──
  connectWiFi();

  // ── WebSocket ──
  ws.onEvent(onWebSocketEvent);
  server.addHandler(&ws);

  // ── HTTP routes ──

  // Root: simple status page — open in browser to verify ESP32 is up
  server.on("/", HTTP_GET, [](AsyncWebServerRequest *req) {
    String html =
        "<!DOCTYPE html><html><head>"
        "<meta name='viewport' content='width=device-width'>"
        "<title>ESP32-S3 PID Bridge</title>"
        "<style>body{background:#0a0a0a;color:#00d4ff;font-family:monospace;"
        "padding:2rem}h1{color:#fff}table{border-collapse:collapse;width:100%}"
        "td{padding:8px 12px;border-bottom:1px solid #222}"
        "td:first-child{color:#888}</style></head><body>"
        "<h1>ESP32-S3 PID Bridge</h1><table>"
        "<tr><td>IP Address</td><td>" +
        WiFi.localIP().toString() +
        "</td></tr>"
        "<tr><td>WebSocket URL</td><td>ws://" +
        WiFi.localIP().toString() +
        ":81/ws</td></tr>"
        "<tr><td>WiFi Signal</td><td>" +
        String(WiFi.RSSI()) +
        " dBm</td></tr>"
        "<tr><td>WS Clients</td><td>" +
        String(ws.count()) +
        "</td></tr>"
        "<tr><td>Uptime</td><td>" +
        String(millis() / 1000) +
        "s</td></tr>"
        "<tr><td>Free Heap</td><td>" +
        String(ESP.getFreeHeap()) +
        " bytes</td></tr>"
        "</table>"
        "<p style='color:#888;margin-top:2rem'>Enter the IP above into your "
        "dashboard header field</p>"
        "</body></html>";
    req->send(200, "text/html", html);
  });

  // Ping endpoint — useful for testing connectivity
  server.on("/ping", HTTP_GET, [](AsyncWebServerRequest *req) {
    JsonDocument doc;
    doc["status"] = "ok";
    doc["ip"] = WiFi.localIP().toString();
    doc["clients"] = ws.count();
    doc["uptime"] = millis() / 1000;
    String out;
    serializeJson(doc, out);
    req->send(200, "application/json", out);
  });

  // CORS headers for browser fetch() calls
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Origin", "*");

  server.begin();
  Serial.println("[HTTP] Server started on port 81");
  Serial.println("=== Boot complete — waiting for connections ===\n");

  // Create UART Task on APP_CPU (Core 1)
  // Stack: 4096 bytes, Priority: 2 (higher than main loop)
  xTaskCreatePinnedToCore(
      uartTask,
      "UART_Task",
      4096,
      NULL,
      2,
      NULL,
      1
  );
}

// ════════════════════════════════════════════════════════════
//  Loop — Housekeeping (WebSocket cleanup, watchdogs, stats)
// ════════════════════════════════════════════════════════════
void loop() {
  // ── 1. Clean up stale WebSocket clients ──
  ws.cleanupClients();

  // ── 2. Watchdog — no message from dashboard for WATCHDOG_MS ──
  if (ws.count() > 0 && !watchdogFired &&
      millis() - lastDashboardMsg > WATCHDOG_MS) {

    watchdogFired = true;
    Serial.println("[WATCHDOG] No dashboard message for 5s");

    // Notify all clients
    ws.textAll("{\"type\":\"ERROR\","
               "\"message\":\"ESP32 watchdog: no message from dashboard\"}");
  }

  // ── 3. WiFi watchdog ──
  static uint32_t lastWifiCheck = 0;
  if (millis() - lastWifiCheck > 10000) {
    lastWifiCheck = millis();
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("[WiFi] Connection lost — reconnecting");
      WiFi.reconnect();
    }
  }

  // ── 4. Print stats every 2s ──
  if (millis() - statLastPrint > 2000) {
    statLastPrint = millis();
    Serial.printf("[STATS] Uptime: %lus | WS clients: %u | "
                  "UART→WS: %lu | WS→UART: %lu | Heap: %lu bytes\n",
                  millis() / 1000, ws.count(), statPktSent, statCmdReceived,
                  (unsigned long)ESP.getFreeHeap());
  }

  // Small delay to yield to other tasks
  vTaskDelay(pdMS_TO_TICKS(10));
}

// ════════════════════════════════════════════════════════════
//
//  STM32 SIDE — what to send and how to parse
//  (Copy this into your STM32 firmware as a reference)
//
// ════════════════════════════════════════════════════════════
//
//  ── SEND telemetry at 20Hz (every 50ms) ──
//
//  char txBuf[256];
//  snprintf(txBuf, sizeof(txBuf),
//    "{\"type\":\"TELEMETRY\",\"payload\":"
//    "{\"x\":%.3f,\"y\":%.3f,\"z\":%.3f,"
//    "\"heading\":%.1f,\"velocity\":%.3f,"
//    "\"pidOutput\":%.3f,\"setpoint\":%.3f,"
//    "\"error\":%.3f,\"timestamp\":%lu}}\n",
//    pos.x, pos.y, pos.z,
//    heading_deg,
//    velocity_ms,
//    pid_output,
//    pid_setpoint,
//    pid_error,
//    (unsigned long)HAL_GetTick()
//  );
//  HAL_UART_Transmit(&huart2, (uint8_t*)txBuf, strlen(txBuf), 50);
//
//  ── PARSE incoming commands ──
//
//  void parseCommand(const char* cmd) {
//    if (strncmp(cmd, "PID TUNING", 10) == 0) {
//      // parse KP, KI, KD
//      // e.g. sscanf(cmd, "PID TUNING, KP:%f, KI:%f, KD:%f", &kp, &ki, &kd);
//      // apply to PID controller
//    } else if (strncmp(cmd, "ROBOT MOVEMENT, STATE:GO", 24) == 0) {
//      // parse X, Y, Angle
//      // e.g. sscanf(cmd, "ROBOT MOVEMENT, STATE:GO, X:%f, Y:%f, Angle:%f",
//      &x, &y, &z);
//      // set movement target
//    } else if (strncmp(cmd, "ROBOT MOVEMENT, STATE:STOP", 26) == 0) {
//      setPWM(0, 0);
//      pid_setpoint = 0;
//    }
//  }
//
//  ── SAFETY WATCHDOG on STM32 ──
//  If no valid command received for 500ms → zero the PWM
//  This prevents the robot running away if WiFi drops.
//
// ════════════════════════════════════════════════════════════
