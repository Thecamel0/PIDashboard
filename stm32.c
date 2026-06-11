#include <stdio.h>
#include <string.h>
#include <stdint.h>
#include <stdbool.h>

// ════════════════════════════════════════════════════════════
//
//  STM32 SIDE — what to send and how to parse
//  (Reference derived from ESP32 Firmware)
//
// ════════════════════════════════════════════════════════════

// ── GLOBAL VARIABLES FOR LAP TIMER ──
bool isMoving = false;
uint32_t movementStartTime = 0;
float currentRunTime = 0.0f;

// ── SEND telemetry at 20Hz (every 50ms) ──

/*
// Example function to send telemetry data to ESP32 over UART
void sendTelemetry() {
  // 1. Calculate the timer value if the robot is moving
  if (isMoving) {
    currentRunTime = (HAL_GetTick() - movementStartTime) / 1000.0f; // Convert ms to seconds
  }

  char txBuf[256];
  snprintf(txBuf, sizeof(txBuf),
    "{\"type\":\"TELEMETRY\",\"payload\":"
    "{\"x\":%.3f,\"y\":%.3f,\"z\":%.3f,"
    "\"heading\":%.1f,\"velocity\":%.3f,"
    "\"pidOutput\":%.3f,\"setpoint\":%.3f,"
    "\"error\":%.3f,\"timer\":%.3f,\"timestamp\":%lu}}\n",
    pos.x, pos.y, pos.z,
    heading_deg,
    velocity_ms,
    pid_output,
    pid_setpoint,
    pid_error,
    currentRunTime,          // <-- Send the lap timer value
    (unsigned long)HAL_GetTick()
  );
  HAL_UART_Transmit(&huart2, (uint8_t*)txBuf, strlen(txBuf), 50);
}
*/

// ── PARSE incoming commands ──

/*
// Example function to parse commands received from ESP32 over UART
void parseCommand(const char* cmd) {
  if (strncmp(cmd, "PID TUNING", 10) == 0) {
    // parse KP, KI, KD
    // e.g. sscanf(cmd, "PID TUNING, KP:%f, KI:%f, KD:%f", &kp, &ki, &kd);
    // apply to PID controller

  } else if (strncmp(cmd, "ROBOT MOVEMENT, STATE:GO", 24) == 0) {
    // parse X, Y, Angle
    // e.g. sscanf(cmd, "ROBOT MOVEMENT, STATE:GO, X:%f, Y:%f, Angle:%f", &x, &y, &z);
    
    // 2. Start the stopwatch
    isMoving = true;
    movementStartTime = HAL_GetTick();
    currentRunTime = 0.0f;
    
    // set movement target

  } else if (strncmp(cmd, "ROBOT MOVEMENT, STATE:STOP", 26) == 0) {
    // 3. Stop the stopwatch
    isMoving = false; // currentRunTime will stop increasing, signaling dashboard the run is over

    // Stop the robot
    // setPWM(0, 0);
    // pid_setpoint = 0;
  }
}
*/

// ── SAFETY WATCHDOG on STM32 ──
// If no valid command received for 500ms → zero the PWM
// This prevents the robot running away if WiFi drops.
// Inside your watchdog timeout logic, you should also set isMoving = false;
