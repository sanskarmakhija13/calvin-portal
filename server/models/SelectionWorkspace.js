const mongoose = require('mongoose');

const SelectionWorkspaceSchema = new mongoose.Schema({
  key: { type: String, unique: true, default: 'default' },
  cycle: { type: String, default: '2026–27' },
  stage: { type: String, enum: ['applications', 'configuration', 'selection', 'completed'], default: 'applications' },
  portalSchedule: { type: mongoose.Schema.Types.Mixed, default: {
    applications: { start: null, end: null, enabled: true },
    configuration: { start: null, end: null, enabled: false },
    selection: { start: null, end: null, enabled: false }
  } },
  ccaControls: { type: mongoose.Schema.Types.Mixed, default: {} },
  revision: { type: Number, default: 0 },
  policy: {
    multiplier: { type: Number, default: 2.5 },
    decimals: { type: Boolean, default: true },
    tieBreaker: { type: String, enum: ['finalRound', 'earliestApplication'], default: 'finalRound' },
    version: { type: Number, default: 1 }
  },
  panels: { type: [mongoose.Schema.Types.Mixed], default: [] },
  panelRuns: { type: [mongoose.Schema.Types.Mixed], default: [] },
  sessions: { type: [mongoose.Schema.Types.Mixed], default: [] },
  submissions: { type: [mongoose.Schema.Types.Mixed], default: [] },
  groups: { type: [mongoose.Schema.Types.Mixed], default: [] },
  evaluations: { type: [mongoose.Schema.Types.Mixed], default: [] },
  screeningDecisions: { type: [mongoose.Schema.Types.Mixed], default: [] },
  markCorrections: { type: [mongoose.Schema.Types.Mixed], default: [] },
  exceptions: { type: [mongoose.Schema.Types.Mixed], default: [] },
  notifications: { type: [mongoose.Schema.Types.Mixed], default: [] },
  audit: { type: [mongoose.Schema.Types.Mixed], default: [] },
  archives: { type: [mongoose.Schema.Types.Mixed], default: [] }
}, { timestamps: true });

module.exports = mongoose.model('SelectionWorkspace', SelectionWorkspaceSchema);
