/** Static machine identity and operating context used by the dashboard. */
const MESH_DATA = {
  machines: [
    {
      id: "M-A-001",
      name: "Machine A",
      location: "Level 1",
      type: "Conveyor Motor",
      operatingState: "Cutting — Active",
    },
    {
      id: "M-B-002",
      name: "Machine B",
      location: "Level 3",
      type: "Conveyor Motor",
      operatingState: "Idle — Fault Flagged",
    },
    {
      id: "M-C-003",
      name: "Machine C",
      location: "Level 5",
      type: "Conveyor Motor",
      operatingState: "Conveying — Active",
    },
  ],
};
