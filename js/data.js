/**
 * MeshMind — MOCK DATA MODULE
 * ---------------------------------------------------------------------------
 * Everything in this file is temporary/static and stands in for data that
 * will eventually come from real sources:
 *
 *   MESH_DATA.cloud / MESH_DATA.localNetwork
 *       -> replace with real connectivity checks (Qdrant Cloud ping,
 *          local mesh/peer discovery status)
 *
 *   machine.sensors
 *       -> replace with live sensor telemetry (temperature, vibration,
 *          current, pressure) streamed from the machine's controller
 *
 *   machine.memory
 *       -> replace with a real query against the machine's local
 *          Qdrant Edge collection (incident count, most recent match,
 *          search/index status)
 *
 *   machine.peers
 *       -> replace with real peer-to-peer discovery + query results
 *          over the local mesh network
 *
 *   machine.ai
 *       -> replace with the output of the AI similarity/explanation
 *          model run against retrieved incident memories
 *
 *   machine.sync
 *       -> replace with real Qdrant Cloud sync state once a technician
 *          has validated an incident
 *
 * Nothing here calls a network, database, or model — it's just the shape
 * the UI expects, so app.js can be pointed at a real data source later
 * without changing how it renders.
 * ---------------------------------------------------------------------------
 */

const MESH_DATA = {
  cloud: {
    connected: false,
    label: "Cloud Sync",
    detail: "No uplink — underground",
  },
  localNetwork: {
    connected: true,
    label: "Local Mesh",
    detail: "3 machines reachable",
  },

  machines: [
    {
      id: "M-A-001",
      name: "Machine A",
      location: "Level 1",
      type: "Conveyor Motor",
      operatingStatus: "Running",
      sensorState: "Normal",
      status: "operational", // operational | warning | critical
      operatingState: "Cutting — Active",

      memory: {
        incidentCount: 47,
        recentIncident: {
          title: "Bearing temperature spike",
          outcome: "Resolved",
          timeAgo: "3 days ago",
        },
        searchStatus: "Idle — index ready",
      },

      peers: {
        nearby: ["Machine B", "Machine C"],
        contacted: false,
        contactedPeer: null,
        retrieval: "No query issued",
      },

      ai: {
        diagnosis: "No anomalies detected",
        confidence: 97,
        evidence: [
          "All sensor readings within nominal range",
          "No matching incident patterns in local memory",
        ],
        action: "Continue normal operation",
      },

      verification: {
        status: "not_required", // not_required | pending | confirmed | rejected
      },

      sync: {
        status: "synced", // synced | pending | local_only | syncing
        lastSynced: "12 min ago",
      },
    },

    {
      id: "M-B-002",
      name: "Machine B",
      location: "Level 3",
      type: "Conveyor Motor",
      operatingStatus: "Idle",
      sensorState: "Alert",
      status: "warning",
      operatingState: "Idle — Fault Flagged",

      memory: {
        incidentCount: 63,
        recentIncident: {
          title: "Hydraulic pump overheating",
          outcome: "Logged 1 hour ago",
          timeAgo: "1 hour ago",
        },
        searchStatus: "Match found — 3 similar incidents",
      },

      peers: {
        nearby: ["Machine A", "Machine D"],
        contacted: true,
        contactedPeer: "Machine D",
        retrieval: "3 similar incidents retrieved — hydraulic pump overheating pattern",
      },

      ai: {
        diagnosis: "Hydraulic pump overheating — likely bearing wear",
        confidence: 84,
        evidence: [
          "Temperature trend matches 3 prior local incidents",
          "Vibration signature correlates with known bearing-wear pattern",
          "Machine D reported a similar fault 6 days ago",
        ],
        action: "Schedule hydraulic pump bearing inspection before next shift",
      },

      verification: {
        status: "pending",
      },

      sync: {
        status: "pending",
        lastSynced: "4 hours ago",
      },
    },
  ],
};
