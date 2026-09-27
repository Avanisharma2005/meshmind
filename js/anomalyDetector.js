/** Transparent threshold-based anomaly detection for simulated sensor readings. */
const AnomalyDetector = (() => {
  // Thresholds are in the same units returned by SensorSimulator.
  const THRESHOLDS = {
    temperature: { label: "Temperature", warning: 80, critical: 90, unit: "°C" },
    vibration: { label: "Vibration", warning: 4.0, critical: 6.0, unit: "mm/s" },
    current: { label: "Current", warning: 44, critical: 50, unit: "A" },
    pressure: { label: "Pressure", warning: 6.7, critical: 7.5, unit: "bar" },
  };
  const statesByMachine = {};

  function evaluate(machineId, readings) {
    const triggeredSensors = [];
    let state = "NORMAL";

    Object.entries(THRESHOLDS).forEach(([key, thresholds]) => {
      const reading = readings[key];
      if (!reading) return;
      let severity = null;
      let threshold = null;
      if (reading.value >= thresholds.critical) {
        severity = "CRITICAL";
        threshold = thresholds.critical;
      } else if (reading.value >= thresholds.warning) {
        severity = "WARNING";
        threshold = thresholds.warning;
      }
      if (severity) {
        triggeredSensors.push({
          sensor: thresholds.label,
          sensorKey: key,
          value: reading.value,
          threshold,
          unit: thresholds.unit,
          state: severity,
        });
        if (severity === "CRITICAL" || state === "NORMAL") state = severity;
      }
    });

    const previous = statesByMachine[machineId];
    const detected = state !== "NORMAL";
    const timestamp = detected
      ? (previous && previous.detected ? previous.timestamp : new Date().toISOString())
      : null;
    const result = { state, detected, timestamp, triggeredSensors };
    statesByMachine[machineId] = result;
    return result;
  }

  function getState(machineId) {
    return statesByMachine[machineId] || {
      state: "NORMAL", detected: false, timestamp: null, triggeredSensors: [],
    };
  }

  return { evaluate, getState, thresholds: THRESHOLDS };
})();
