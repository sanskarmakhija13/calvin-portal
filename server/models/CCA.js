// server/models/CCA.js
const mongoose = require('mongoose');

const CCASchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  description: { type: String, required: true },
  category: { type: String, enum: ['Committees', 'Clubs', 'AIGs', 'Other'], default: 'Other' },
  icon: { type: String, default: '' },
  logoText: { type: String, default: '' },
  logo: { type: String, default: '' },
  brandColor: { type: String, default: '#f58220' },
  fontFamily: { type: String, default: 'Arial, sans-serif' },
  memberLimit: { type: String, default: 'Not provided' },
  stexLimit: { type: String, default: 'Not provided' },
  majorEvents: { type: [String], default: [] },
  driveUrl: { type: String, default: '' },
  phase1Eligible: { type: Boolean, default: true },
  phase2Eligible: { type: Boolean, default: false },
  selectionStatus: { type: String, default: 'Draft' },
  constitutionalStrength: { type: Number, default: 0 },
  contactPerson: { type: String, default: '' },
  selectionCoordinators: { type: [String], default: [] },
  applicationDeadline: { type: Date, default: null },
  seats: { type: Number, default: 0 },
  verticals: [{
    name: { type: String, required: true },
    seats: { type: Number, min: 1, required: true }
  }],
  rounds: [{
    name: { type: String, required: true },
    type: { type: String, default: 'Individual · Task' },
    maxMarks: { type: Number, default: 20 },
    taskMaxMarks: { type: Number, default: 0 },
    interviewMaxMarks: { type: Number, default: 0 },
    weight: { type: Number, default: 20 },
    deadline: { type: Date, default: null },
    startAt: { type: Date, default: null },
    publishedAt: { type: Date, default: null },
    instructions: { type: String, default: '' },
    criteria: { type: String, default: '' },
    documents: [{ name: { type: String, default: '' }, fileKey: { type: String, default: '' } }],
    policyVersion: { type: Number, default: 1 },
    poolMultiplier: { type: Number, default: 2.5 },
    completedAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    status: { type: String, default: 'Draft' }
  }],
  currentRound: { type: Number, default: 0 },
  resultsPublished: { type: Boolean, default: false },
});

module.exports = mongoose.model('CCA', CCASchema);
