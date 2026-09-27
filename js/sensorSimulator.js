/**
 * Local sensor stream simulator.
 * Keeps independent readings per machine and exposes a small data-source API
 * that the dashboard can later replace with a real telemetry provider.
 */
const SensorSimulator = (() => {
  const UPDATE_INTERVAL_MS = 2000;
  const profiles = {
    "M-A-001": {
      temperature: { value: 66.2, min: 55, max: 78, step: 0.7, unit: "°C", range: "Simulated range: 55–78 °C" },
      vibration: { value: 2.1, min: 0.8, max: 3.8, step: 0.12, unit: "mm/s", range: "Simulated range: 0.8–3.8 mm/s" },
      current: { value: 31.7, min: 24, max: 40, step: 0.6, unit: "A", range: "Simulated range: 24–40 A" },
      pressure: { value: 4.8, min: 3.5, max: 6.2, step: 0.08, unit: "bar", range: "Simulated range: 3.5–6.2 bar" },
    },
    "M-B-002": {
      temperature: { value: 72.8, min: 60, max: 82, step: 0.65, unit: "°C", range: "Simulated range: 60–82 °C" },
      vibration: { value: 3.0, min: 1.2, max: 4.2, step: 0.11, unit: "mm/s", range: "Simulated range: 1.2–4.2 mm/s" },
      current: { value: 35.2, min: 27, max: 43, step: 0.55, unit: "A", range: "Simulated range: 27–43 A" },
      pressure: { value: 5.1, min: 3.8, max: 6.5, step: 0.07, unit: "bar", range: "Simulated range: 3.8–6.5 bar" },
    },
  };
  const readingsByMachine = {};
  const demoAnomalyUntil = {};
  const demoRestoreValues = {};

  Object.entries(profiles).forEach(([machineId, sensors]) => {
    readingsByMachine[machineId] = Object.fromEntries(
      Object.entries(sensors).map(([key, sensor]) => [key, { ...sensor }]),
    );
  });

  function getReadings(machineId) {
    return readingsByMachine[machineId];
  }

  function advance(sensor) {
    const direction = Math.random() * 2 - 1;
    const nextValue = sensor.value + direction * sensor.step;
    // Reflect at the bounds so values stay in range without sudden resets.
    sensor.value = nextValue < sensor.min
      ? sensor.min + (sensor.min - nextValue)
      : nextValue > sensor.max
        ? sensor.max - (nextValue - sensor.max)
        : nextValue;
    sensor.value = Math.max(sensor.min, Math.min(sensor.max, sensor.value));
  }

  function triggerDemoAnomaly(machineId, durationMs = 14000) {
    const sensors = readingsByMachine[machineId];
    if (!sensors || machineId !== "M-B-002") return false;
    demoRestoreValues[machineId] = {
      temperature: sensors.temperature.value,
      vibration: sensors.vibration.value,
    };
    sensors.temperature.value = 93.2;
    sensors.vibration.value = 6.4;
    demoAnomalyUntil[machineId] = Date.now() + durationMs;
    return true;
  }

  function start(onUpdate) {
    window.setInterval(() => {
      Object.entries(readingsByMachine).forEach(([machineId, sensors]) => {
        if (demoAnomalyUntil[machineId] && Date.now() < demoAnomalyUntil[machineId]) return;
        if (demoAnomalyUntil[machineId]) {
          Object.entries(demoRestoreValues[machineId] || {}).forEach(([key, value]) => {
            sensors[key].value = value;
          });
          delete demoAnomalyUntil[machineId];
          delete demoRestoreValues[machineId];
        }
        Object.values(sensors).forEach(advance);
      });
      onUpdate();
    }, UPDATE_INTERVAL_MS);
  }

  return { getReadings, start, triggerDemoAnomaly };
})();
