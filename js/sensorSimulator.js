/**
 * Local sensor stream simulator.
 * Keeps independent readings per machine and exposes a small data-source API
 * for the dashboard only; the readings are not physical measurements.
 */
const SensorSimulator = (() => {
  const UPDATE_INTERVAL_MS = 2000;
  const DEMO_INCIDENT_ID = "meshmind-demo:M-B-002:bearing-anomaly:v1";
  const profiles = {
    "M-A-001": {
      temperature: { value: 66.2, min: 55, max: 78, step: 0.7, unit: "\u00B0C" },
      vibration: { value: 2.1, min: 0.8, max: 3.8, step: 0.12, unit: "mm/s" },
      current: { value: 31.7, min: 24, max: 40, step: 0.6, unit: "A" },
      pressure: { value: 4.8, min: 3.5, max: 6.2, step: 0.08, unit: "bar" },
    },
    "M-B-002": {
      temperature: { value: 72.8, min: 60, max: 82, step: 0.65, unit: "\u00B0C" },
      vibration: { value: 3.0, min: 1.2, max: 4.2, step: 0.11, unit: "mm/s" },
      current: { value: 35.2, min: 27, max: 43, step: 0.55, unit: "A" },
      pressure: { value: 5.1, min: 3.8, max: 6.5, step: 0.07, unit: "bar" },
    },
    "M-C-003": {
      temperature: { value: 65.5, min: 54, max: 77, step: 0.6, unit: "\u00B0C" },
      vibration: { value: 1.9, min: 0.7, max: 3.6, step: 0.1, unit: "mm/s" },
      current: { value: 30.8, min: 23, max: 39, step: 0.5, unit: "A" },
      pressure: { value: 4.6, min: 3.4, max: 6.1, step: 0.06, unit: "bar" },
    },
  };
  const readingsByMachine = {};
  const demoAnomalyUntil = {};
  const demoRestoreValues = {};
  const movementDirections = Object.fromEntries(
    Object.keys(profiles).map((machineId, machineIndex) => [
      machineId,
      Object.fromEntries(Object.keys(profiles[machineId]).map((sensorKey, sensorIndex) => [
        sensorKey,
        (machineIndex + sensorIndex) % 2 === 0 ? 1 : -1,
      ])),
    ]),
  );

  Object.entries(profiles).forEach(([machineId, sensors]) => {
    readingsByMachine[machineId] = Object.fromEntries(
      Object.entries(sensors).map(([key, sensor]) => [key, { ...sensor }]),
    );
  });

  function getReadings(machineId) {
    return readingsByMachine[machineId];
  }

  function restoreNormal(machineId) {
    const profile = profiles[machineId];
    const sensors = readingsByMachine[machineId];
    if (!profile || !sensors) return false;
    delete demoAnomalyUntil[machineId];
    delete demoRestoreValues[machineId];
    Object.entries(profile).forEach(([key, sensor]) => {
      sensors[key].value = sensor.value;
    });
    return true;
  }

  function resetAll() {
    Object.keys(readingsByMachine).forEach(restoreNormal);
  }

  function triggerDemoAnomaly(machineId) {
    const sensors = readingsByMachine[machineId];
    if (!sensors || machineId !== "M-B-002") return false;
    demoRestoreValues[machineId] = {
      temperature: sensors.temperature.value,
      vibration: sensors.vibration.value,
    };
    sensors.temperature.value = 93.2;
    sensors.vibration.value = 6.4;
    // The demonstration incident stays latched until Normal Machine/reset.
    demoAnomalyUntil[machineId] = Number.POSITIVE_INFINITY;
    return true;
  }

  function getIncidentId(machineId) {
    return machineId === "M-B-002" && demoAnomalyUntil[machineId]
      ? DEMO_INCIDENT_ID
      : null;
  }

  function updateNormalReadings(machineId, sensors) {
    const profile = profiles[machineId];
    const directions = movementDirections[machineId];
    Object.entries(sensors).forEach(([key, sensor]) => {
      const baseline = profile[key].value;
      const lowerBound = Math.ceil(Math.max(sensor.min, baseline - sensor.step * 4) * 10) / 10;
      const upperBound = Math.floor(Math.min(sensor.max, baseline + sensor.step * 4) * 10) / 10;
      const current = Math.round(sensor.value * 10) / 10;
      const delta = Math.max(0.11, sensor.step * (0.85 + Math.random() * 0.3));
      let direction = directions[key];
      let next = current + direction * delta;
      if (next < lowerBound || next > upperBound) {
        direction *= -1;
        next = current + direction * delta;
      }
      next = Math.round(next * 10) / 10;
      if (next === current) next = current + direction * 0.1;
      if (next < lowerBound || next > upperBound) {
        direction *= -1;
        next = current + direction * 0.1;
      }
      directions[key] = direction;
      sensor.value = Math.round(next * 10) / 10;
    });
  }

  function start(onUpdate) {
    window.setInterval(() => {
      const now = Date.now();
      Object.entries(readingsByMachine).forEach(([machineId, sensors]) => {
        if (demoAnomalyUntil[machineId] && now < demoAnomalyUntil[machineId]) return;
        if (demoAnomalyUntil[machineId]) {
          Object.entries(demoRestoreValues[machineId] || {}).forEach(([key, value]) => {
            sensors[key].value = value;
          });
          delete demoAnomalyUntil[machineId];
          delete demoRestoreValues[machineId];
        }
        updateNormalReadings(machineId, sensors);
      });
      onUpdate();
    }, UPDATE_INTERVAL_MS);
  }

  return { getReadings, start, triggerDemoAnomaly, getIncidentId, restoreNormal, resetAll };
})();
